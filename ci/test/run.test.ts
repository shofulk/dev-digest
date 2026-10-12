import { describe, it, expect, vi } from 'vitest';
import type { GitHubReviewPayload, LLMProvider, Review } from '@devdigest/shared';
import { CiResultArtifact } from '@devdigest/shared/contracts/eval-ci';
import { dropDirFromDiff, makeRedactor, runCi, toOpenRouterModel, type RunnerDeps } from '../src/run.js';

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,3 @@',
  ' const a = 1;',
  '+const b = 2;',
  ' const c = 3;',
  '',
].join('\n');

const KEY = 'sk-or-SECRET-KEY-123';
const TOKEN = 'ghs_SECRET_TOKEN_456';

function manifest(over: Record<string, unknown> = {}): string {
  const m = {
    agent_id: 'a1',
    name: 'Alpha',
    version: 3,
    provider: 'openai',
    model: 'gpt-x',
    strategy: 'single-pass',
    post_as: 'github_review',
    ci_fail_on: 'critical',
    skills: ['rules-12345678'],
    system_prompt: 'You are Alpha.',
    ...over,
  };
  return Object.entries(m)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join('\n');
}

function finding(over: Record<string, unknown> = {}) {
  return {
    id: 'f1',
    severity: 'CRITICAL',
    category: 'bug',
    title: 'Bad thing',
    file: 'src/a.ts',
    start_line: 2,
    end_line: 2,
    rationale: 'because',
    confidence: 0.9,
    ...over,
  };
}

function review(findings: unknown[]): Review {
  return { verdict: 'comment', summary: 's', score: 50, findings } as unknown as Review;
}

function fakeLlm(
  make: (model: string) => Review | Promise<Review>,
  seen: { model: string; content: string }[] = [],
): LLMProvider {
  return {
    id: 'openrouter',
    listModels: async () => [],
    complete: async () => {
      throw new Error('not used');
    },
    embed: async () => [],
    completeStructured: async (req) => {
      seen.push({ model: req.model, content: req.messages.map((m) => m.content).join('\n') });
      const data = await make(req.model);
      return { data, model: req.model, tokensIn: 1, tokensOut: 1, costUsd: 0.01, raw: '{}', attempts: 1 } as never;
    },
  } as LLMProvider;
}

interface Harness {
  deps: RunnerDeps;
  files: Map<string, string>;
  reviews: { n: number; payload: GitHubReviewPayload }[];
  comments: { n: number; body: string }[];
  logs: string[];
  getDiff: ReturnType<typeof vi.fn>;
  llmKeys: string[];
}

function harness(
  files: Record<string, string>,
  llm: LLMProvider,
  over: Partial<RunnerDeps> & { diffFails?: boolean } = {},
): Harness {
  const fs = new Map(Object.entries(files));
  const reviews: Harness['reviews'] = [];
  const comments: Harness['comments'] = [];
  const logs: string[] = [];
  const llmKeys: string[] = [];
  const getDiff = vi.fn(async () => {
    if (over.diffFails) throw new Error(`boom ${KEY}`);
    return DIFF;
  });
  const deps: RunnerDeps = {
    env: { OPENROUTER_API_KEY: KEY, GITHUB_TOKEN: TOKEN, PR_NUMBER: '7', HEAD_SHA: 'abc123' },
    devdigestDir: '.devdigest',
    resultPath: 'devdigest-result.json',
    fs: {
      listDir: (p) =>
        [...fs.keys()].filter((k) => k.startsWith(p + '/')).map((k) => k.slice(p.length + 1)),
      readText: (p) => fs.get(p) ?? null,
      writeText: (p, t) => void fs.set(p, t),
    },
    github: {
      getPullRequest: async () => ({ title: 'PR-TITLE-XYZ', body: 'PR-BODY-XYZ', headSha: 'abc123' }),
      getDiff,
      postReview: async (n, payload) => void reviews.push({ n, payload }),
      postComment: async (n, body) => void comments.push({ n, body }),
    },
    llmFor: (key) => {
      llmKeys.push(key);
      return llm;
    },
    log: (l) => void logs.push(l),
    now: (() => {
      let t = 1000;
      return () => (t += 5);
    })(),
    ...over,
  };
  return { deps, files: fs, reviews, comments, logs, getDiff, llmKeys };
}

const SKILL = { '.devdigest/skills/rules-12345678.md': 'SKILL-BODY-RULES' };
const MEMORY = {
  '.devdigest/memory.jsonl': '{"kind":"rule","content":"MEMORY-LINE-ONE"}\nnot json\n',
};

describe('toOpenRouterModel', () => {
  it('AC-26 maps providers to OpenRouter model ids', () => {
    expect(toOpenRouterModel('openai', 'gpt-x')).toBe('openai/gpt-x');
    expect(toOpenRouterModel('anthropic', 'claude-y')).toBe('anthropic/claude-y');
    expect(toOpenRouterModel('openrouter', 'deepseek/z')).toBe('deepseek/z');
  });
});

describe('runCi', () => {
  it('AC-25 fetches the diff once and reviews once per manifest, in sorted order', async () => {
    const seen: { model: string; content: string }[] = [];
    const h = harness(
      {
        '.devdigest/agents/b-2.yaml': manifest({ agent_id: 'b', name: 'Beta', provider: 'anthropic', model: 'c' }),
        '.devdigest/agents/a-1.yaml': manifest(),
      },
      fakeLlm(() => review([]), seen),
    );
    const out = await runCi(h.deps);
    expect(h.getDiff).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(2);
    expect(out.artifact.results.map((r) => r.agent_id)).toEqual(['a1', 'b']);
  });

  it('AC-26 sends the mapped model and puts skills, memory and PR text in the prompt', async () => {
    const seen: { model: string; content: string }[] = [];
    const h = harness(
      { '.devdigest/agents/a-1.yaml': manifest(), ...SKILL, ...MEMORY },
      fakeLlm(() => review([]), seen),
    );
    await runCi(h.deps);
    expect(seen[0]?.model).toBe('openai/gpt-x');
    const c = seen[0]!.content;
    expect(c).toContain('SKILL-BODY-RULES');
    expect(c).toContain('rule: MEMORY-LINE-ONE');
    expect(c).toContain('Review pull request #7');
    const wrapped = c.match(/<untrusted source="pr-description">[\s\S]*?<\/untrusted>/);
    expect(wrapped?.[0]).toContain('PR-TITLE-XYZ');
    expect(wrapped?.[0]).toContain('PR-BODY-XYZ');
    expect(c.replace(wrapped![0], '')).not.toContain('PR-TITLE-XYZ');
  });

  it('AC-27 keeps only grounded findings and counts blockers with ci_fail_on', async () => {
    const llm = fakeLlm(() =>
      review([
        finding(),
        finding({ id: 'f2', severity: 'WARNING', start_line: 3, end_line: 3 }),
        finding({ id: 'f3', file: 'nope.ts' }),
      ]),
    );
    const crit = await runCi(harness({ '.devdigest/agents/a-1.yaml': manifest() }, llm).deps);
    const r1 = crit.artifact.results[0]!;
    expect(r1).toMatchObject({ findings_count: 2, critical: 1, warning: 1, blockers: 1, verdict: 'blocked' });

    const warn = await runCi(
      harness({ '.devdigest/agents/a-1.yaml': manifest({ ci_fail_on: 'warning' }) }, llm).deps,
    );
    expect(warn.artifact.results[0]?.blockers).toBe(2);

    const never = await runCi(
      harness({ '.devdigest/agents/a-1.yaml': manifest({ ci_fail_on: 'never' }) }, llm).deps,
    );
    expect(never.artifact.results[0]).toMatchObject({ blockers: 0, verdict: 'passed' });
    expect(never.exitCode).toBe(0);
  });

  it('AC-29 exits 1 on a blocker and 0 when clean', async () => {
    const blocked = await runCi(
      harness({ '.devdigest/agents/a-1.yaml': manifest() }, fakeLlm(() => review([finding()]))).deps,
    );
    expect(blocked.exitCode).toBe(1);
    const clean = await runCi(
      harness({ '.devdigest/agents/a-1.yaml': manifest() }, fakeLlm(() => review([]))).deps,
    );
    expect(clean.exitCode).toBe(0);
    expect(clean.artifact.results[0]?.verdict).toBe('no_findings');
  });

  it('AC-30 records invalid_manifest, continues with the other agents and exits 1', async () => {
    const seen: { model: string; content: string }[] = [];
    const h = harness(
      {
        '.devdigest/agents/a-1.yaml': manifest(),
        '.devdigest/agents/z-bad.yaml': 'agent_id: zed\nname: ""\n',
        '.devdigest/agents/y-bad.yaml': ': : not yaml [',
      },
      fakeLlm(() => review([]), seen),
    );
    const out = await runCi(h.deps);
    expect(seen).toHaveLength(1);
    const byId = Object.fromEntries(out.artifact.results.map((r) => [r.agent_id, r]));
    expect(byId['a1']?.verdict).toBe('no_findings');
    expect(byId['zed']).toMatchObject({ verdict: 'failed', error_code: 'invalid_manifest' });
    expect(byId['y-bad']).toMatchObject({ verdict: 'failed', error_code: 'invalid_manifest' });
    expect(out.exitCode).toBe(1);
  });

  it('AC-30 a diff failure fails every agent with diff_fetch_failed', async () => {
    const h = harness(
      { '.devdigest/agents/a-1.yaml': manifest(), '.devdigest/agents/b-2.yaml': manifest({ agent_id: 'b' }) },
      fakeLlm(() => review([])),
      { diffFails: true },
    );
    const out = await runCi(h.deps);
    expect(out.artifact.results.map((r) => r.error_code)).toEqual(['diff_fetch_failed', 'diff_fetch_failed']);
    expect(out.exitCode).toBe(1);
  });

  it('AC-30 an empty OPENROUTER_API_KEY fails every agent with missing_api_key', async () => {
    const llmFor = vi.fn();
    const h = harness({ '.devdigest/agents/a-1.yaml': manifest() }, fakeLlm(() => review([])), {
      env: { OPENROUTER_API_KEY: '', GITHUB_TOKEN: TOKEN, PR_NUMBER: '7', HEAD_SHA: 'abc123' },
      llmFor,
    });
    const out = await runCi(h.deps);
    expect(out.artifact.results[0]).toMatchObject({ verdict: 'failed', error_code: 'missing_api_key' });
    expect(llmFor).not.toHaveBeenCalled();
    expect(out.exitCode).toBe(1);
  });

  it('AC-30 a model throw records model_error and the next agent still runs', async () => {
    let n = 0;
    const llm = fakeLlm(() => {
      if (n++ === 0) throw new Error(`upstream said ${KEY}`);
      return review([]);
    });
    const h = harness(
      { '.devdigest/agents/a-1.yaml': manifest(), '.devdigest/agents/b-2.yaml': manifest({ agent_id: 'b' }) },
      llm,
    );
    const out = await runCi(h.deps);
    expect(out.artifact.results[0]).toMatchObject({ verdict: 'failed', error_code: 'model_error' });
    expect(out.artifact.results[1]?.verdict).toBe('no_findings');
    expect(out.exitCode).toBe(1);
  });

  it('NFR-3 a never-resolving model call records model_timeout', async () => {
    const h = harness(
      { '.devdigest/agents/a-1.yaml': manifest() },
      fakeLlm(() => new Promise<Review>(() => {})),
      { modelTimeoutMs: 50 },
    );
    const out = await runCi(h.deps);
    expect(out.artifact.results[0]).toMatchObject({ verdict: 'failed', error_code: 'model_timeout' });
    expect(out.exitCode).toBe(1);
  });

  it('AC-28 posts one titled review per agent: REQUEST_CHANGES with blockers, COMMENT otherwise, never APPROVE', async () => {
    const llm = fakeLlm((model) =>
      review(
        model.endsWith('/gpt-x')
          ? [finding()]
          : model.endsWith('/other')
            ? [finding({ severity: 'SUGGESTION' })]
            : [],
      ),
    );
    const h = harness(
      {
        '.devdigest/agents/a-1.yaml': manifest(),
        '.devdigest/agents/b-2.yaml': manifest({ agent_id: 'b', name: 'Beta', model: 'other' }),
        '.devdigest/agents/c-3.yaml': manifest({ agent_id: 'c', name: 'Gamma', model: 'quiet' }),
      },
      llm,
    );
    const out = await runCi(h.deps);
    expect(out.exitCode).toBe(1);
    expect(h.reviews).toHaveLength(3);
    expect(h.reviews[0]?.payload.event).toBe('REQUEST_CHANGES');
    expect(h.reviews[0]?.payload.body).toContain('Alpha');
    expect(h.reviews[1]?.payload.event).toBe('COMMENT');
    expect(h.reviews[1]?.payload.body).toContain('Beta');
    expect(h.reviews[2]?.payload.event).toBe('COMMENT');
    expect(h.reviews[2]?.payload.body).toContain('Gamma');
    expect(h.reviews.every((r) => r.n === 7 && r.payload.event !== 'APPROVE')).toBe(true);
  });

  it('AC-28 pr_comment posts one comment starting with the agent name and none posts nothing', async () => {
    const llm = fakeLlm(() => review([finding(), finding({ id: 'g', title: 'Second thing', start_line: 3, end_line: 3 })]));
    const h = harness(
      {
        '.devdigest/agents/a-1.yaml': manifest({ post_as: 'pr_comment' }),
        '.devdigest/agents/b-2.yaml': manifest({ agent_id: 'b', name: 'Beta', post_as: 'none' }),
      },
      llm,
    );
    await runCi(h.deps);
    expect(h.reviews).toHaveLength(0);
    expect(h.comments).toHaveLength(1);
    expect(h.comments[0]?.body.startsWith('Alpha')).toBe(true);
    expect(h.comments[0]?.body).toContain('Bad thing');
    expect(h.comments[0]?.body).toContain('Second thing');
  });

  it('AC-28 a failed post is logged and changes neither verdict nor exit code', async () => {
    const h = harness({ '.devdigest/agents/a-1.yaml': manifest() }, fakeLlm(() => review([])));
    h.deps.github.postReview = async () => {
      throw new Error('422');
    };
    const out = await runCi(h.deps);
    expect(out.exitCode).toBe(0);
    expect(out.artifact.results[0]?.verdict).toBe('no_findings');
    expect(h.logs.join('\n')).toContain('post');
  });

  it('AC-31 writes devdigest-result.json that parses as CiResultArtifact with every field', async () => {
    const h = harness(
      { '.devdigest/agents/a-1.yaml': manifest() },
      fakeLlm(() => review([finding(), finding({ id: 'w', severity: 'WARNING', start_line: 3, end_line: 3 })])),
    );
    await runCi(h.deps);
    const parsed = CiResultArtifact.parse(JSON.parse(h.files.get('devdigest-result.json')!));
    expect(parsed).toMatchObject({ version: 1, pr_number: 7, head_sha: 'abc123' });
    expect(parsed.results[0]).toEqual({
      agent_id: 'a1',
      agent_version: 3,
      verdict: 'blocked',
      critical: 1,
      warning: 1,
      suggestion: 0,
      findings_count: 2,
      blockers: 1,
      cost_usd: 0.01,
      duration_ms: expect.any(Number),
      model: 'openai/gpt-x',
      error_code: null,
    });
  });

  it('AC-26 builds the LLM provider with exactly the OPENROUTER_API_KEY value', async () => {
    const h = harness({ '.devdigest/agents/a-1.yaml': manifest() }, fakeLlm(() => review([])));
    await runCi(h.deps);
    expect(h.llmKeys.length).toBeGreaterThan(0);
    expect(h.llmKeys.every((k) => k === KEY)).toBe(true);
  });

  it('AC-26 skill lookup is by exact stem: the sibling body is ignored, a bare slug gets no body', async () => {
    const files = {
      '.devdigest/skills/foo-12345678.md': 'EXACT-BODY',
      '.devdigest/skills/foo-12345678-old.md': 'OLD-BODY',
    };
    const seen: { model: string; content: string }[] = [];
    await runCi(
      harness(
        { '.devdigest/agents/a-1.yaml': manifest({ skills: ['foo-12345678'] }), ...files },
        fakeLlm(() => review([]), seen),
      ).deps,
    );
    expect(seen[0]?.content).toContain('EXACT-BODY');
    expect(seen[0]?.content).not.toContain('OLD-BODY');

    const seen2: { model: string; content: string }[] = [];
    await runCi(
      harness(
        { '.devdigest/agents/a-1.yaml': manifest({ skills: ['foo'] }), ...files },
        fakeLlm(() => review([]), seen2),
      ).deps,
    );
    expect(seen2[0]?.content).not.toContain('EXACT-BODY');
    expect(seen2[0]?.content).not.toContain('OLD-BODY');
  });

  it('AC-26 finds a skill by exact file stem only, not by a prefixed file name', async () => {
    const seen: { model: string; content: string }[] = [];
    const h = harness(
      {
        '.devdigest/agents/a-1.yaml': manifest(),
        '.devdigest/skills/rules-12345678-extra.md': 'PREFIXED-SKILL-BODY',
      },
      fakeLlm(() => review([]), seen),
    );
    await runCi(h.deps);
    expect(seen[0]?.content).not.toContain('PREFIXED-SKILL-BODY');
  });

  it('AC-29 no manifests logs a line, writes results [] and exits 1', async () => {
    const h = harness({}, fakeLlm(() => review([])));
    const out = await runCi(h.deps);
    expect(out.exitCode).toBe(1);
    expect(out.artifact.results).toEqual([]);
    expect(h.logs.length).toBeGreaterThan(0);
    expect(JSON.parse(h.files.get('devdigest-result.json') ?? '{}').results).toEqual([]);
    expect(h.getDiff).not.toHaveBeenCalled();
  });

  it('NFR-5 makeRedactor masks every secret and ignores empty ones', () => {
    const redact = makeRedactor([KEY, undefined, '', TOKEN]);
    expect(redact(`a ${KEY} b ${TOKEN} c ${KEY}`)).toBe('a *** b *** c ***');
    expect(redact('plain')).toBe('plain');
  });

  it('NFR-5 no log line or result-file byte contains the key or the token', async () => {
    const h = harness(
      { '.devdigest/agents/a-1.yaml': manifest(), '.devdigest/agents/b-2.yaml': manifest({ agent_id: 'b' }) },
      fakeLlm(() => {
        throw new Error(`denied for ${KEY} and ${TOKEN}`);
      }),
    );
    h.deps.github.postReview = async () => {
      throw new Error(`bad credentials ${TOKEN}`);
    };
    await runCi(h.deps);
    const dump = h.logs.join('\n') + (h.files.get('devdigest-result.json') ?? '');
    expect(dump).not.toContain(KEY);
    expect(dump).not.toContain(TOKEN);
    expect(h.logs.length).toBeGreaterThan(0);

    const d = harness({ '.devdigest/agents/a-1.yaml': manifest() }, fakeLlm(() => review([])), { diffFails: true });
    await runCi(d.deps);
    expect(d.logs.join('\n')).not.toContain(KEY);
  });

  it('does not send files under .devdigest/ (the bundled runner) to the model', async () => {
    const runnerDiff = [
      'diff --git a/.devdigest/runner/index.js b/.devdigest/runner/index.js',
      '--- /dev/null',
      '+++ b/.devdigest/runner/index.js',
      '@@ -0,0 +1 @@',
      '+RUNNER-BUNDLE-XYZ',
      '',
    ].join('\n');
    const seen: { model: string; content: string }[] = [];
    const h = harness({ '.devdigest/agents/a-1.yaml': manifest() }, fakeLlm(() => review([]), seen));
    h.getDiff.mockImplementation(async () => runnerDiff + DIFF);
    await runCi(h.deps);
    expect(seen[0]!.content).not.toContain('RUNNER-BUNDLE-XYZ');
    expect(seen[0]!.content).toContain('const b = 2;');
  });
});

describe('dropDirFromDiff', () => {
  const block = (a: string, b: string) => `diff --git a/${a} b/${b}\n+++ b/${b}\n@@ -0,0 +1 @@\n+x\n`;

  it('drops files inside the dir and keeps the rest, including look-alike paths', () => {
    const raw = block('.devdigest/agents/a.yaml', '.devdigest/agents/a.yaml') + block('src/a.ts', 'src/a.ts') + block('.devdigest-x/b.ts', '.devdigest-x/b.ts');
    expect(dropDirFromDiff(raw, '.devdigest')).toBe(block('src/a.ts', 'src/a.ts') + block('.devdigest-x/b.ts', '.devdigest-x/b.ts'));
  });

  it('keeps a rename that leaves or enters the dir', () => {
    const raw = block('.devdigest/a.ts', 'src/a.ts');
    expect(dropDirFromDiff(raw, '.devdigest')).toBe(raw);
  });
});
