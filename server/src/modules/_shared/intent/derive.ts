// RING 1 — orchestration. The intent deriver (D2): gather sources under a
// budget, build the classifier prompt, call the LLM, cap confidence, upsert.
// Imports ONLY port types (`@devdigest/shared`), `platform/errors.ts`,
// `platform/resilience.ts` (ring 0, pure — for `withTimeout`) and
// `@devdigest/reviewer-core` — NEVER the DI container module (that would add a
// `no-circular` dependency-cruiser warning; see `deps.ts`, which is allowed to
// import the container TYPE and builds `IntentDeriverDeps` from it) and NEVER
// the persistence row-type module (C1/A8 — `IntentPull`/`IntentRowData` below
// are structural).
import type { FeatureModelChoice, GitHubClient, IntentSource, LLMProvider, PrIntentRecord } from '@devdigest/shared';
import { NotFoundError } from '../../../platform/errors.js';
import { withTimeout } from '../../../platform/resilience.js';
import {
  extractHunkHeaders,
  extractReferences,
  issueCandidate,
  type ReferenceCandidate,
} from './references.js';
import { buildClassifierPrompt, IntentClassification, type ClassifierFileEntry, type FetchedSourceText } from './prompt.js';
import {
  applyConfidenceCaps,
  isBodySubstantial,
  isReferencedSource,
  toPrIntentRecord,
  type IntentDerivationStats,
  type IntentRowData,
} from './helpers.js';
import {
  CLASSIFIER_MAX_RETRIES,
  CLASSIFIER_MAX_TOKENS,
  CLASSIFIER_TEMPERATURE,
  CLASSIFIER_TIMEOUT_MS,
  FETCH_TIMEOUT_MS,
  MAX_CHANGED_SPECS,
  MAX_DOCS,
  MAX_FETCHED_SOURCES,
  MAX_FILE_BYTES,
  MAX_ISSUES,
  MAX_SOURCE_PROMPT_CHARS,
  TOTAL_SOURCE_PHASE_BUDGET_MS,
} from './constants.js';

export interface Logger {
  info: (msg: string) => void;
}

/** Structural shape of the `pull_requests` row the deriver needs — named here
 *  instead of importing the persistence row-type module's `PullRow` (C1/A8). */
export interface IntentPull {
  id: string;
  number: number;
  title: string;
  body: string | null;
  headSha: string;
}

export type DeriverPull = IntentPull;
export interface DeriverRepo {
  owner: string;
  name: string;
}

export interface IntentDeriverDeps {
  github: () => Promise<GitHubClient>;
  resolveLlm: (workspaceId: string) => Promise<{ choice: FeatureModelChoice; llm: LLMProvider }>;
  tokenizer: { count(text: string): number };
  getPullWithRepo: (
    workspaceId: string,
    prId: string,
  ) => Promise<{ pull: DeriverPull; repo: DeriverRepo } | undefined>;
  getPrFiles: (
    prId: string,
  ) => Promise<{ path: string; additions: number; deletions: number; patch: string | null }[]>;
  getIntentRow: (prId: string) => Promise<IntentRowData | undefined>;
  upsertIntentRow: (
    prId: string,
    values: {
      intent: string;
      inScope: string[];
      outOfScope: string[];
      confidence: 'low' | 'medium' | 'high';
      sources: IntentSource[];
      headSha: string;
      model: string;
      stats: unknown;
    },
  ) => Promise<IntentRowData>;
}

export interface DeriveResult {
  record: PrIntentRecord;
  stats: IntentDerivationStats;
}

export interface ResolveForReviewResult {
  /** Always a real record: either the fresh row, or the just-derived one.
   *  `read()` alone can return `null` (never derived); `resolveForReview`
   *  never does, because a missing row always triggers a derive. */
  record: PrIntentRecord;
  /** True when THIS call derived it (fresh/missing/stale), false when an
   *  already-fresh row was reused with no LLM call (D2). */
  derived: boolean;
}

const CHANGED_SPEC_RE = /(?:^|\/)\.spec\/[^/]+\.spec\.md$|(?:^|\/)docs\/plans\/[^/]+\.plan\.md$/;

function classifyFetchError(err: unknown): string {
  if (err instanceof Error && err.name === 'TimeoutError') return 'timeout';
  const msg = (err as Error).message ?? '';
  if (/404|not found/i.test(msg)) return 'not_found';
  if (/timeout/i.test(msg)) return 'timeout';
  if (/byte-cap|over the .* cap/i.test(msg)) return 'too_large';
  return 'fetch_failed';
}

/**
 * Derives + persists a PR's intent (D2). Owns in-flight dedupe per `prId` so a
 * manual derive and an inline review-start derive never race into two LLM
 * calls for the same PR — safe because ONE instance is shared per `Container`
 * (`deps.ts` `intentDeriverFor`), so every consumer dedupes against the same
 * map.
 */
export class IntentDeriver {
  private inflight = new Map<string, Promise<DeriveResult>>();

  constructor(private deps: IntentDeriverDeps) {}

  /** Pure read — `null` when never derived; 404 when the PR isn't in the
   *  workspace. Makes NO LLM call. */
  async read(workspaceId: string, prId: string): Promise<PrIntentRecord | null> {
    const found = await this.deps.getPullWithRepo(workspaceId, prId);
    if (!found) throw new NotFoundError('Pull request not found');
    const row = await this.deps.getIntentRow(prId);
    if (!row) return null;
    return toPrIntentRecord(row, found.pull.headSha);
  }

  /**
   * AC8 — read the PR's intent; missing or stale → derive inline once. Used
   * by BOTH the intent route (manual on-demand) and the review executor
   * (pre-work), sharing the same in-flight dedupe because both consumers
   * resolve their deriver from the same `intentDeriverFor(container)`.
   */
  async resolveForReview(workspaceId: string, prId: string, log?: Logger): Promise<ResolveForReviewResult> {
    const record = await this.read(workspaceId, prId);
    if (record && !record.stale) return { record, derived: false };
    const { record: derived } = await this.derive(workspaceId, prId, log);
    return { record: derived, derived: true };
  }

  derive(workspaceId: string, prId: string, log?: Logger): Promise<DeriveResult> {
    const existing = this.inflight.get(prId);
    if (existing) return existing;
    const promise = this.doDerive(workspaceId, prId, log).finally(() => this.inflight.delete(prId));
    this.inflight.set(prId, promise);
    return promise;
  }

  private async doDerive(workspaceId: string, prId: string, log?: Logger): Promise<DeriveResult> {
    const start = Date.now();
    const found = await this.deps.getPullWithRepo(workspaceId, prId);
    if (!found) throw new NotFoundError('Pull request not found');
    const { pull, repo } = found;

    const fileRows = await this.deps.getPrFiles(prId);
    const fileEntries: ClassifierFileEntry[] = fileRows.map((f) => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      headers: extractHunkHeaders(f.patch),
    }));

    let github: GitHubClient | undefined;
    try {
      github = await this.deps.github();
    } catch {
      github = undefined;
    }

    // AC6 — the whole source-gathering phase is bounded to 15 s, and every
    // in-flight call is itself bounded to `min(5s, time left in the phase)`,
    // so no single slow call can push the phase past its budget (F4).
    const phaseStart = Date.now();
    const phaseDeadline = phaseStart + TOTAL_SOURCE_PHASE_BUDGET_MS;
    const callBudget = () => Math.max(0, Math.min(FETCH_TIMEOUT_MS, phaseDeadline - Date.now()));

    const candidates: ReferenceCandidate[] = extractReferences(pull.body ?? '', repo);

    // Closing-issue refs (GraphQL) unioned with the body-regex candidates.
    if (github) {
      try {
        const refs = await withTimeout(
          github.listClosingIssueRefs(repo, pull.number, { timeoutMs: callBudget() }),
          callBudget(),
        );
        for (const r of refs) {
          const ref = `${r.owner}/${r.name}#${r.number}`;
          if (!candidates.some((c) => c.kind === 'linked_issue' && c.ref === ref)) {
            candidates.push(issueCandidate(r.owner, r.name, r.number, repo));
          }
        }
      } catch (err) {
        log?.info(`intent: closing-issue lookup failed — ${(err as Error).message}`);
      }
    }

    // Q6: changed *.spec.md / docs/plans/*.plan.md files, max 2, as changed_spec.
    const specFiles = fileRows.filter((f) => CHANGED_SPEC_RE.test(f.path)).slice(0, MAX_CHANGED_SPECS);
    for (const f of specFiles) {
      candidates.push({
        kind: 'changed_spec',
        ref: `${repo.owner}/${repo.name}:${f.path}@${pull.headSha.slice(0, 7)}`,
        fetch: { via: 'repo_doc', path: f.path },
      });
    }

    const issues: FetchedSourceText[] = [];
    const docs: FetchedSourceText[] = [];
    const sourceRecords: IntentSource[] = [];
    let fetchedCount = 0;
    let issuesFetched = 0;
    let docsFetched = 0;

    for (const candidate of candidates) {
      const now = Date.now();
      if (now >= phaseDeadline) {
        sourceRecords.push({ kind: candidate.kind, ref: candidate.ref, status: 'not_fetched', reason: 'phase_timeout' });
        continue;
      }
      if (fetchedCount >= MAX_FETCHED_SOURCES) {
        sourceRecords.push({ kind: candidate.kind, ref: candidate.ref, status: 'not_fetched', reason: 'cap_reached' });
        continue;
      }
      const isDocLike = candidate.kind === 'doc_link' || candidate.kind === 'repo_doc' || candidate.kind === 'changed_spec';
      if (candidate.kind === 'linked_issue' && issuesFetched >= MAX_ISSUES) {
        sourceRecords.push({ kind: candidate.kind, ref: candidate.ref, status: 'not_fetched', reason: 'cap_reached' });
        continue;
      }
      if (isDocLike && docsFetched >= MAX_DOCS) {
        sourceRecords.push({ kind: candidate.kind, ref: candidate.ref, status: 'not_fetched', reason: 'cap_reached' });
        continue;
      }
      if (candidate.fetch.via === 'blocked') {
        sourceRecords.push({ kind: candidate.kind, ref: candidate.ref, status: 'not_fetched', reason: candidate.fetch.reason });
        continue;
      }
      if (!github) {
        sourceRecords.push({ kind: candidate.kind, ref: candidate.ref, status: 'not_fetched', reason: 'no_token' });
        continue;
      }

      const timeoutMs = callBudget();
      try {
        if (candidate.fetch.via === 'issue') {
          const issue = await withTimeout(
            github.getIssue({ owner: candidate.fetch.owner, name: candidate.fetch.name }, candidate.fetch.number),
            timeoutMs,
          );
          const text = `${issue.title}\n\n${issue.body ?? ''}`;
          const capped = text.slice(0, MAX_SOURCE_PROMPT_CHARS);
          issues.push({ kind: candidate.kind, ref: candidate.ref, text: capped });
          sourceRecords.push({
            kind: candidate.kind,
            ref: candidate.ref,
            status: 'used',
            chars: capped.length,
            truncated: capped.length < text.length,
          });
          fetchedCount++;
          issuesFetched++;
        } else if (candidate.fetch.via === 'file') {
          const file = await github.getFileContent(
            { owner: candidate.fetch.owner, name: candidate.fetch.name },
            candidate.fetch.path,
            candidate.fetch.gitRef,
            { maxBytes: MAX_FILE_BYTES, timeoutMs },
          );
          const capped = file.content.slice(0, MAX_SOURCE_PROMPT_CHARS);
          docs.push({ kind: candidate.kind, ref: candidate.ref, text: capped });
          sourceRecords.push({
            kind: candidate.kind,
            ref: candidate.ref,
            status: 'used',
            chars: capped.length,
            truncated: capped.length < file.content.length,
          });
          fetchedCount++;
          docsFetched++;
        } else {
          // repo_doc / changed_spec: fetched from the PR's own repo at its head SHA.
          const file = await github.getFileContent(repo, candidate.fetch.path, pull.headSha, {
            maxBytes: MAX_FILE_BYTES,
            timeoutMs,
          });
          const capped = file.content.slice(0, MAX_SOURCE_PROMPT_CHARS);
          docs.push({ kind: candidate.kind, ref: candidate.ref, text: capped });
          sourceRecords.push({
            kind: candidate.kind,
            ref: candidate.ref,
            status: 'used',
            chars: capped.length,
            truncated: capped.length < file.content.length,
          });
          fetchedCount++;
          docsFetched++;
        }
      } catch (err) {
        sourceRecords.push({ kind: candidate.kind, ref: candidate.ref, status: 'missing', reason: classifyFetchError(err) });
      }
    }

    // pr_title / pr_body / file_list are always "used" (they never fail to fetch —
    // they come from the DB row already in hand). A short/empty body is AC3's
    // case (low confidence), never AC5's `missing_context` (F7).
    sourceRecords.unshift(
      { kind: 'pr_title', ref: `${repo.owner}/${repo.name}#${pull.number}`, status: 'used', chars: pull.title.length },
      { kind: 'pr_body', ref: `${repo.owner}/${repo.name}#${pull.number}`, status: 'used', chars: (pull.body ?? '').length },
      { kind: 'file_list', ref: `${repo.owner}/${repo.name}#${pull.number}`, status: 'used' },
    );

    const built = buildClassifierPrompt({
      title: pull.title,
      body: pull.body,
      files: fileEntries,
      issues,
      docs,
      missing: sourceRecords.filter((s) => s.status !== 'used'),
    });

    // Fold the prompt's own budget cut back into `sources[]` — an issue/doc
    // fetched fine but then trimmed by the section budget must still report
    // its ACTUAL kept chars/truncated flag (D5, F5/F6).
    for (const stat of built.sourceStats) {
      const rec = sourceRecords.find((s) => s.ref === stat.ref);
      if (rec) {
        rec.chars = stat.chars;
        rec.truncated = stat.truncated;
      }
    }

    const { choice, llm } = await this.deps.resolveLlm(workspaceId);
    const result = await llm.completeStructured<IntentClassification>({
      model: choice.model,
      schema: IntentClassification,
      schemaName: 'IntentClassification',
      messages: built.messages,
      temperature: CLASSIFIER_TEMPERATURE,
      maxTokens: CLASSIFIER_MAX_TOKENS,
      timeoutMs: CLASSIFIER_TIMEOUT_MS,
      maxRetries: CLASSIFIER_MAX_RETRIES,
      requireParameters: true,
    });

    const anyOtherSourceUsed = sourceRecords.some((s) => isReferencedSource(s.kind) && s.status === 'used');
    const anyMissing = sourceRecords.some((s) => isReferencedSource(s.kind) && s.status !== 'used');
    const confidence = applyConfidenceCaps(result.data.confidence, {
      bodySubstantial: isBodySubstantial(pull.body),
      anyOtherSourceUsed,
      anyMissing,
    });

    const tokensEstTotal = built.sections.reduce((n, s) => n + this.countTokens(built.sectionTexts[s.name] ?? ''), 0);

    const stats: IntentDerivationStats = {
      provider: choice.provider,
      model: choice.model,
      sections: built.sections.map((s) => ({
        name: s.name,
        chars: s.chars,
        tokens_est: this.countTokens(built.sectionTexts[s.name] ?? ''),
        truncated: s.truncated,
      })),
      tokens_est_total: tokensEstTotal,
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
      cost_usd: result.costUsd,
      attempts: result.attempts,
      duration_ms: Date.now() - start,
      sources: sourceRecords.map((s) => ({
        kind: s.kind,
        ref: s.ref,
        status: s.status,
        reason: s.reason,
        chars: s.chars,
        truncated: s.truncated,
      })),
    };

    this.logLines(log, sourceRecords, built.sections, tokensEstTotal, choice, result, stats.duration_ms);

    const row = await this.deps.upsertIntentRow(prId, {
      intent: result.data.summary,
      inScope: result.data.in_scope,
      outOfScope: result.data.out_of_scope,
      confidence,
      sources: sourceRecords,
      headSha: pull.headSha,
      model: `${choice.provider}/${choice.model}`,
      stats,
    });

    return { record: toPrIntentRecord(row, pull.headSha), stats };
  }

  /** D7 — the content-free line set, emitted through `lineLog` on BOTH paths
   *  (review pre-work via `runLog.info`, route via `IntentService`'s forward
   *  to the request logger). Every line here is counts + normalised refs +
   *  reason codes only — never body/issue/doc text (F3a). */
  private logLines(
    log: Logger | undefined,
    sourceRecords: IntentSource[],
    sections: { name: string; chars: number; truncated: boolean }[],
    tokensEstTotal: number,
    choice: FeatureModelChoice,
    result: { tokensIn: number; tokensOut: number; costUsd: number | null; attempts: number },
    durationMs: number,
  ): void {
    if (!log) return;
    const used = sourceRecords.filter((s) => s.status === 'used').length;
    const missing = sourceRecords.filter((s) => s.status !== 'used').length;
    log.info(`intent: ${used} source(s) used, ${missing} missing`);
    for (const s of sourceRecords) {
      log.info(`intent: source ${s.kind} ${s.ref} ${s.status}${s.reason ? ` (${s.reason})` : ''}`);
    }
    const byName = (name: string) => sections.find((s) => s.name === name)?.chars ?? 0;
    const truncatedNames = sections.filter((s) => s.truncated).map((s) => s.name);
    const truncatedSuffix = truncatedNames.length > 0 ? ` truncated=${truncatedNames.join(',')}` : '';
    log.info(
      `intent: sections system=${byName('system')}c pr=${byName('pr')}c issues=${byName('issues')}c ` +
        `docs=${byName('docs')}c files=${byName('changed_files')}c missing=${byName('missing')}c ` +
        `(~${tokensEstTotal} tokens)${truncatedSuffix}`,
    );
    const cost = result.costUsd == null ? 'n/a' : `$${result.costUsd}`;
    log.info(
      `intent: ${choice.provider}/${choice.model} in=${result.tokensIn} out=${result.tokensOut} ` +
        `cost=${cost} attempts=${result.attempts} duration=${durationMs}ms`,
    );
  }

  private countTokens(text: string): number {
    try {
      return this.deps.tokenizer.count(text);
    } catch {
      return Math.ceil(text.length / 4);
    }
  }
}
