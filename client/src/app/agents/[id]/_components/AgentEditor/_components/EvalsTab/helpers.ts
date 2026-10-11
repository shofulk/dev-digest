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
