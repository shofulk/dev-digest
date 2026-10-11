import type { EvalSuiteRun } from "@devdigest/shared/contracts/eval-ci";
import { COMPARE_COUNT, START_ERROR_FALLBACK_KEY, START_ERROR_KEYS } from "./constants";

/** Compare needs exactly two selected runs. */
export function canCompare(selected: readonly string[]): boolean {
  return selected.length === COMPARE_COUNT;
}

/** Add the id when absent, remove it when present; never mutates. */
export function toggleSelected(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
}

/** The newest and the second-newest *completed* runs (a newer running run is ignored). */
export function latestTwoCompleted(runs: readonly EvalSuiteRun[]): {
  latest: EvalSuiteRun | null;
  previous: EvalSuiteRun | null;
} {
  const done = runs
    .filter((r) => r.status === "completed")
    .sort((x, y) => Date.parse(y.started_at) - Date.parse(x.started_at));
  return { latest: done[0] ?? null, previous: done[1] ?? null };
}

/** `b - a` for a metric, `undefined` when either side is not computable. */
export function metricDelta(latest: number | null | undefined, previous: number | null | undefined): number | undefined {
  return latest == null || previous == null ? undefined : latest - previous;
}

/** Message key (under `eval`) for a failed start, chosen by the API error code. */
export function startErrorKey(code: string | undefined): string {
  return (START_ERROR_KEYS as Record<string, string>)[code ?? ""] ?? START_ERROR_FALLBACK_KEY;
}

/** A 0..1 metric as a whole percent (`0.82` -> `82%`); `null` -> `null` (the caller shows the dash). */
export function formatPercent(v: number | null | undefined): string | null {
  return v == null ? null : `${Math.round(v * 100)}%`;
}

/** Whole percentage points of a 0..1 delta, signed by `direction`; `undefined` delta -> `undefined`. */
export function pointsDelta(delta: number | undefined): { direction: "up" | "down" | "flat"; points: number } | undefined {
  if (delta === undefined) return undefined;
  const points = Math.round(delta * 100);
  return { direction: points === 0 ? "flat" : points > 0 ? "up" : "down", points: Math.abs(points) };
}

/** Cases whose last result is a pass, and whether any case has run at all. */
export function passingCounts(results: readonly string[]): { passing: number; total: number; anyRun: boolean } {
  return {
    passing: results.filter((r) => r === "pass").length,
    total: results.length,
    anyRun: results.some((r) => r !== "never_run"),
  };
}

/** `file:line` or `file:start-end`. */
export function locationOf(e: { file: string; start_line: number; end_line: number }): string {
  return e.start_line === e.end_line ? `${e.file}:${e.start_line}` : `${e.file}:${e.start_line}-${e.end_line}`;
}
