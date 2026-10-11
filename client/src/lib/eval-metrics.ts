/* eval-metrics.ts — pure formatting and ordering helpers shared by the Evals tab, the
   compare modal and the /eval dashboard. No React, no `use` prefix: callable anywhere. */

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
