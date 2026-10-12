import type { LogLine } from "@devdigest/ui";
import type { ContextDocStatus, RunTrace } from "@devdigest/shared";

interface RawEvent {
  t: string;
  kind: string;
  msg: string;
}

/** Map run-bus events to the LiveLogStream LogLine shape. */
export function eventsToLog(events: RawEvent[]): LogLine[] {
  return events.map((e) => ({ t: e.t, k: e.kind as LogLine["k"], m: e.msg }));
}

/** Map a persisted trace's log to the LiveLogStream LogLine shape. */
export function traceLog(trace: RunTrace | undefined): LogLine[] {
  return trace?.log.map((l) => ({ t: l.t, k: l.kind as LogLine["k"], m: l.msg })) ?? [];
}

/** Seconds-formatted duration. */
export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Token in→out summary (e.g. "12k→1.5k"). */
export function formatTokens(tokensIn: number, tokensOut: number): string {
  return `${(tokensIn / 1000).toFixed(0)}k→${(tokensOut / 1000).toFixed(1)}k`;
}

export interface SpecReadRow {
  path: string;
  tokens: number | null;
}

export interface SpecSkippedRow {
  path: string;
  status: ContextDocStatus;
}

/**
 * "Specs read" rows (AC-30): one per document the trace actually injected, with its token
 * count. A trace with no `context_docs` (persisted before this feature, AC-33) falls back
 * to the old `specs_read` path list with no tokens, so it renders exactly as before.
 */
export function specsReadRows(trace: RunTrace): SpecReadRow[] {
  if (trace.context_docs) {
    return trace.context_docs.filter((d) => d.status === "included").map((d) => ({ path: d.path, tokens: d.tokens }));
  }
  return trace.specs_read.map((path) => ({ path, tokens: null }));
}

/** "Specs skipped" rows (AC-31): every resolved document that was NOT injected, with its
 *  status as the skip reason. Empty for a trace with no `context_docs`. */
export function specsSkippedRows(trace: RunTrace): SpecSkippedRow[] {
  if (!trace.context_docs) return [];
  return trace.context_docs.filter((d) => d.status !== "included").map((d) => ({ path: d.path, status: d.status }));
}
