// Ring 0 — domain. Pure rules over runs and reviews: which run a question is about, which
// review belongs to a run, and how a review is cut down to a concise, budgeted answer.
// No I/O; everything here would still be true with no API and no MCP.
import type { FindingRecord, ReviewRecord, RunSummary, Severity } from './contracts.js';

/** Most to least severe — also the sort order of every findings list. */
export const SEVERITIES = ['CRITICAL', 'WARNING', 'SUGGESTION'] as const satisfies readonly Severity[];

export type ResponseFormat = 'concise' | 'detailed';

/** Runtime values for `ResponseFormat`, pinned to the type above (C2). */
export const RESPONSE_FORMATS = ['concise', 'detailed'] as const satisfies readonly ResponseFormat[];

export interface ConciseFinding {
  id: string;
  severity: Severity;
  /** `file:line` or `file:start-end`. */
  location: string;
  title: string;
}

export interface DetailedFinding extends ConciseFinding {
  category: string;
  confidence: number;
  rationale: string;
  suggestion: string | null;
}

export interface ShapedReview {
  verdict: string | null;
  score: number | null;
  /** Visible findings matching the filter, before `limit` and the budget cut. */
  total: number;
  findings: (ConciseFinding | DetailedFinding)[];
}

export interface ShapeOptions {
  minSeverity?: Severity;
  limit: number;
  format: ResponseFormat;
  textMax: number;
}

/** A run addressed by id, else the newest run of an agent, else the newest run. */
export function selectRun(
  runs: RunSummary[],
  by: { runId?: string; agentId?: string },
): RunSummary | undefined {
  if (by.runId) return runs.find((r) => r.run_id === by.runId);
  if (by.agentId) return runs.find((r) => r.agent_id === by.agentId);
  return runs[0];
}

/** The review a run produced. Summary rows share no run semantics and are skipped. */
export function reviewForRun(reviews: ReviewRecord[], runId: string): ReviewRecord | undefined {
  return reviews.find((r) => r.kind === 'review' && r.run_id === runId);
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

/** The `file` part is truncated here too — a long path is still free text (C4). */
function location(f: FindingRecord, textMax: number): string {
  const file = truncate(f.file, textMax);
  return f.end_line > f.start_line ? `${file}:${f.start_line}-${f.end_line}` : `${file}:${f.start_line}`;
}

function shapeFinding(f: FindingRecord, format: ResponseFormat, textMax: number) {
  const concise: ConciseFinding = {
    id: f.id,
    severity: f.severity,
    location: location(f, textMax),
    title: truncate(f.title, textMax),
  };
  if (format === 'concise') return concise;
  const detailed: DetailedFinding = {
    ...concise,
    category: f.category,
    confidence: f.confidence,
    rationale: truncate(f.rationale, textMax),
    suggestion: f.suggestion ? truncate(f.suggestion, textMax) : null,
  };
  return detailed;
}

/**
 * Dismissed findings are dropped first — the user already rejected them in DevDigest —
 * then the rest are filtered by `minSeverity`, sorted most severe first and capped.
 */
export function shapeReview(review: ReviewRecord, opts: ShapeOptions): ShapedReview {
  const rank = (s: Severity) => SEVERITIES.indexOf(s);
  const floor = opts.minSeverity ? rank(opts.minSeverity) : SEVERITIES.length - 1;
  const visible = review.findings
    .filter((f) => f.dismissed_at == null)
    .filter((f) => rank(f.severity) <= floor)
    .sort((a, b) => rank(a.severity) - rank(b.severity));
  const shown = visible.slice(0, opts.limit).map((f) => shapeFinding(f, opts.format, opts.textMax));
  return {
    verdict: review.verdict,
    score: review.score,
    total: visible.length,
    findings: shown,
  };
}

/**
 * Keeps a serialized value under `maxChars` by dropping items from the tail of `value[key]`.
 * Data only: how many were cut, never why or what to do about it — the user-facing wording
 * for that is built at the edge (src/tools/budget.ts), which is the only place that knows
 * tool argument names.
 */
export function fitToBudget<T extends object, K extends keyof T & string>(
  value: T,
  key: K,
  maxChars: number,
): { value: T; cut: number } {
  const list = [...(value[key] as unknown as unknown[])];
  const out = { ...value, [key]: list } as T;
  let cut = 0;
  while (list.length > 0 && JSON.stringify(out).length > maxChars) {
    list.pop();
    cut += 1;
  }
  return { value: out, cut };
}
