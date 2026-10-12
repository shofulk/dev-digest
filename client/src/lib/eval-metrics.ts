/* eval-metrics.ts — pure formatting and ordering helpers shared by the Evals tab, the
   compare modal, the /eval dashboard and the per-agent eval page. No React, no `use`
   prefix: callable anywhere. */

import type { EvalSuiteRun } from "@devdigest/shared/contracts/eval-ci";

/** Selecting exactly this many runs enables Compare. */
export const COMPARE_COUNT = 2;

/** `ApiError.code` of a rejected start -> message key under the `eval` namespace. */
export const START_ERROR_KEYS = {
  no_cases: "suite.errors.noCases",
  provider_not_configured: "suite.errors.providerNotConfigured",
  run_in_flight: "suite.errors.runInFlight",
} as const;

export const START_ERROR_FALLBACK_KEY = "suite.errors.generic";

/** `ApiError.code` of a rejected "Turn into eval case" -> message key under `prReview`. */
export const CASE_ERROR_KEYS = {
  finding_has_no_agent: "finding.evalCaseErrors.noAgent",
  finding_not_triaged: "finding.evalCaseErrors.notTriaged",
  no_diff_available: "finding.evalCaseErrors.noDiff",
  frozen_diff_too_large: "finding.evalCaseErrors.diffTooLarge",
  expectation_not_grounded: "finding.evalCaseErrors.notGrounded",
} as const;

export const CASE_ERROR_FALLBACK_KEY = "finding.evalCaseFailed";

/** Own-key lookup, so a code such as `constructor` never resolves to an Object.prototype member. */
function keyFor(keys: Readonly<Record<string, string>>, code: string | undefined, fallback: string): string {
  return code !== undefined && Object.hasOwn(keys, code) ? keys[code]! : fallback;
}

const MINUS = "−";
const DASH = "—";

export type DeltaTone = "up" | "down" | "flat" | "none";

/** A metric in 0..1 as `0.83`; `null` (not computable) as an em dash. */
export function formatMetric(v: number | null | undefined): string {
  return v == null ? DASH : v.toFixed(2);
}

/** Round to the displayed precision so a `0.004` delta reads (and tones) as flat. */
function rounded(v: number): number {
  return Math.round(v * 100) / 100;
}

/** `+0.10` / `−0.20` (true minus sign) / `±0.00`; `null` as an em dash. */
export function signedDelta(v: number | null | undefined): string {
  if (v == null) return DASH;
  const r = rounded(v);
  if (r === 0) return "±0.00";
  return (r > 0 ? "+" : MINUS) + Math.abs(r).toFixed(2);
}

export function deltaTone(v: number | null | undefined): DeltaTone {
  if (v == null) return "none";
  const r = rounded(v);
  return r === 0 ? "flat" : r > 0 ? "up" : "down";
}

/** CSS colour for a tone; neutral tones stay muted. */
export function toneColor(tone: DeltaTone): string {
  if (tone === "up") return "var(--ok)";
  if (tone === "down") return "var(--crit)";
  return "var(--text-muted)";
}

/** Order two selected run ids as `[older, newer]` by `started_at` (compare sends a = older). */
export function orderPair(
  runs: ReadonlyArray<{ run_id: string; started_at: string }>,
  ids: readonly [string, string],
): [string, string] {
  const at = (id: string) => runs.find((r) => r.run_id === id)?.started_at;
  const [x, y] = ids;
  const ax = at(x);
  const ay = at(y);
  if (ax == null || ay == null) return [x, y];
  return Date.parse(ax) <= Date.parse(ay) ? [x, y] : [y, x];
}

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
  return keyFor(START_ERROR_KEYS, code, START_ERROR_FALLBACK_KEY);
}

/** Message key (under `prReview`) for a failed case capture, chosen by the API error code. */
export function caseErrorKey(code: string | undefined): string {
  return keyFor(CASE_ERROR_KEYS, code, CASE_ERROR_FALLBACK_KEY);
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
