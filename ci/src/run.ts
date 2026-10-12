/**
 * Runner logic — all behaviour with injected dependencies, no process / fs / fetch
 * (those live in index.ts). Reads the exported manifests, reviews the PR diff once
 * per agent through OpenRouter, posts the result and writes devdigest-result.json.
 */
import { parse as parseYaml } from 'yaml';
import type { GitHubReviewPayload, LLMProvider, Finding } from '@devdigest/shared';
import { AgentManifest, CI_RESULT_VERSION } from '@devdigest/shared/contracts/eval-ci';
import type { CiAgentResult, CiResultArtifact } from '@devdigest/shared/contracts/eval-ci';
import { countBlockers, reviewPullRequest, toReviewPayload } from '@devdigest/reviewer-core';
import { parseUnifiedDiff } from '../../server/src/adapters/git/diff-parser.js';

export interface RunnerDeps {
  env: { OPENROUTER_API_KEY?: string; GITHUB_TOKEN?: string; PR_NUMBER?: string; HEAD_SHA?: string };
  /** Directory holding agents/, skills/ and memory.jsonl, e.g. `.devdigest`. */
  devdigestDir: string;
  resultPath: string;
  fs: {
    /** File names (not paths) directly under `p`; empty when `p` does not exist. */
    listDir(p: string): string[];
    /** File text, or null when it cannot be read. */
    readText(p: string): string | null;
    writeText(p: string, text: string): void;
  };
  github: {
    getPullRequest(n: number): Promise<{ title: string; body: string; headSha: string }>;
    getDiff(n: number): Promise<string>;
    postReview(n: number, payload: GitHubReviewPayload): Promise<void>;
    postComment(n: number, body: string): Promise<void>;
  };
  llmFor(key: string): LLMProvider;
  log(line: string): void;
  now(): number;
  /** Per-agent model-call limit; defaults to 120 s (NFR-3). */
  modelTimeoutMs?: number;
}

const DEFAULT_MODEL_TIMEOUT_MS = 120_000;

/** OpenRouter model id for a manifest's provider + model (AC-26). */
export function toOpenRouterModel(provider: string, model: string): string {
  return provider === 'openai' || provider === 'anthropic' ? `${provider}/${model}` : model;
}

/** Masks every non-empty secret in a text; used for logs, the result file and the top-level catch. */
export function makeRedactor(secrets: (string | undefined)[]): (text: string) => string {
  const list = secrets.filter((s): s is string => !!s);
  return (text) => list.reduce((t, s) => t.split(s).join('***'), text);
}

class ModelTimeout extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ModelTimeout()), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Drops every file under `dir/` from a raw unified diff. The export PR (and any later
 * re-export) adds the ~1 MB minified runner there: reviewing it costs tokens and yields
 * noise such as "the runner has no tests".
 */
export function dropDirFromDiff(raw: string, dir: string): string {
  const prefix = dir.replace(/^\.\//, '').replace(/\/$/, '') + '/';
  return raw
    .split(/(?=^diff --git )/m)
    .filter((block) => {
      const m = /^diff --git a\/(\S+) b\/(\S+)/.exec(block);
      return !m || !(m[1]!.startsWith(prefix) && m[2]!.startsWith(prefix));
    })
    .join('');
}

function failedResult(
  agentId: string,
  version: number,
  errorCode: string,
  model: string | null = null,
  durationMs: number | null = null,
): CiAgentResult {
  return {
    agent_id: agentId,
    agent_version: version,
    verdict: 'failed',
    critical: 0,
    warning: 0,
    suggestion: 0,
    findings_count: 0,
    blockers: 0,
    cost_usd: null,
    duration_ms: durationMs,
    model,
    error_code: errorCode,
  };
}

function commentBody(name: string, findings: Finding[]): string {
  if (findings.length === 0) return `${name}\n\nNo findings.`;
  const lines = findings.map(
    (f) => `- **${f.title}** (${f.severity.toLowerCase()}) \`${f.file}:${f.start_line}\`: ${f.rationale}`,
  );
  return `${name}\n\n${lines.join('\n')}`;
}

export async function runCi(
  deps: RunnerDeps,
): Promise<{ exitCode: 0 | 1; artifact: CiResultArtifact }> {
  const { env, fs, github } = deps;
  const redact = makeRedactor([env.OPENROUTER_API_KEY, env.GITHUB_TOKEN]);
  const log = (line: string) => deps.log(redact(line));
  const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

  const prNumber = Number.parseInt(env.PR_NUMBER ?? '', 10);
  let headSha = env.HEAD_SHA ?? '';
  const dir = deps.devdigestDir;

  // Manifests, sorted by file name.
  const manifestFiles = fs
    .listDir(`${dir}/agents`)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort();

  if (manifestFiles.length === 0) {
    log(`no agent manifests found under ${dir}/agents`);
    const artifact: CiResultArtifact = {
      version: CI_RESULT_VERSION,
      pr_number: Number.isInteger(prNumber) && prNumber > 0 ? prNumber : 0,
      head_sha: headSha,
      results: [],
    };
    fs.writeText(deps.resultPath, JSON.stringify(artifact, null, 2));
    return { exitCode: 1, artifact };
  }

  // One PR + diff fetch for the whole run (AC-25).
  let prText = '';
  let diff: ReturnType<typeof parseUnifiedDiff> | null = null;
  try {
    if (!Number.isInteger(prNumber) || prNumber <= 0) throw new Error('PR_NUMBER is not a number');
    const pr = await github.getPullRequest(prNumber);
    headSha = headSha || pr.headSha;
    prText = `${pr.title}\n\n${pr.body ?? ''}`.trim();
    diff = parseUnifiedDiff(dropDirFromDiff(await github.getDiff(prNumber), dir));
  } catch (e) {
    log(`diff fetch failed: ${errText(e)}`);
  }

  const memory = (fs.readText(`${dir}/memory.jsonl`) ?? '')
    .split('\n')
    .flatMap((line) => {
      try {
        const m = JSON.parse(line) as { kind?: unknown; content?: unknown };
        return typeof m.kind === 'string' && typeof m.content === 'string'
          ? [`${m.kind}: ${m.content}`]
          : [];
      } catch {
        return [];
      }
    });
  const skillFiles = fs.listDir(`${dir}/skills`);
  const skillBody = (slug: string): string | null => {
    return skillFiles.includes(`${slug}.md`) ? fs.readText(`${dir}/skills/${slug}.md`) : null;
  };

  const results: CiAgentResult[] = [];
  for (const file of manifestFiles) {
    const stem = file.replace(/\.ya?ml$/, '');
    let raw: unknown = null;
    let manifest: AgentManifest;
    try {
      raw = parseYaml(fs.readText(`${dir}/agents/${file}`) ?? '');
      manifest = AgentManifest.parse(raw);
    } catch (e) {
      const r = (raw ?? {}) as { agent_id?: unknown; version?: unknown };
      log(`${file}: invalid manifest: ${errText(e)}`);
      results.push(
        failedResult(
          typeof r.agent_id === 'string' && r.agent_id ? r.agent_id : stem,
          typeof r.version === 'number' && Number.isInteger(r.version) ? r.version : 0,
          'invalid_manifest',
        ),
      );
      continue;
    }

    const model = toOpenRouterModel(manifest.provider, manifest.model);
    const fail = (code: string, ms: number | null = null) =>
      results.push(failedResult(manifest.agent_id, manifest.version, code, model, ms));
    if (!diff) {
      fail('diff_fetch_failed');
      continue;
    }
    if (!env.OPENROUTER_API_KEY) {
      log(`${manifest.name}: OPENROUTER_API_KEY is empty`);
      fail('missing_api_key');
      continue;
    }

    const started = deps.now();
    let outcome;
    try {
      outcome = await withTimeout(
        reviewPullRequest({
          systemPrompt: manifest.system_prompt,
          model,
          diff,
          llm: deps.llmFor(env.OPENROUTER_API_KEY),
          strategy: manifest.strategy,
          skills: manifest.skills.flatMap((s) => skillBody(s) ?? []),
          memory,
          prDescription: prText,
          task: `Review pull request #${prNumber}`,
        }),
        deps.modelTimeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS,
      );
    } catch (e) {
      const timedOut = e instanceof ModelTimeout;
      log(`${manifest.name}: ${timedOut ? 'model call timed out' : `model call failed: ${errText(e)}`}`);
      fail(timedOut ? 'model_timeout' : 'model_error', deps.now() - started);
      continue;
    }

    const findings = outcome.review.findings;
    const blockers = countBlockers(findings, manifest.ci_fail_on);
    const count = (sev: Finding['severity']) => findings.filter((f) => f.severity === sev).length;
    results.push({
      agent_id: manifest.agent_id,
      agent_version: manifest.version,
      verdict: blockers > 0 ? 'blocked' : findings.length > 0 ? 'passed' : 'no_findings',
      critical: count('CRITICAL'),
      warning: count('WARNING'),
      suggestion: count('SUGGESTION'),
      findings_count: findings.length,
      blockers,
      cost_usd: outcome.costUsd,
      duration_ms: deps.now() - started,
      model,
      error_code: null,
    });
    log(`${manifest.name}: ${findings.length} finding(s), ${blockers} blocker(s)`);

    // A failed post is logged and changes neither the verdict nor the exit code.
    try {
      if (manifest.post_as === 'github_review') {
        const payload = toReviewPayload(outcome.review, {
          title: manifest.name,
          failOn: manifest.ci_fail_on,
          diff,
        });
        await github.postReview(prNumber, {
          ...payload,
          event: blockers > 0 ? 'REQUEST_CHANGES' : 'COMMENT',
        });
      } else if (manifest.post_as === 'pr_comment') {
        await github.postComment(prNumber, commentBody(manifest.name, findings));
      }
    } catch (e) {
      log(`${manifest.name}: post failed: ${errText(e)}`);
    }
  }

  const artifact: CiResultArtifact = {
    version: CI_RESULT_VERSION,
    pr_number: Number.isInteger(prNumber) && prNumber > 0 ? prNumber : 0,
    head_sha: headSha,
    results,
  };
  fs.writeText(deps.resultPath, redact(JSON.stringify(artifact, null, 2)));

  const exitCode = results.some((r) => r.verdict === 'blocked' || r.verdict === 'failed') ? 1 : 0;
  return { exitCode, artifact };
}
