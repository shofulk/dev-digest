/* multi-agent-estimates.ts — pure helpers behind the "<time>s · $<cost>" estimates
   on Configure run and the picker. */
import type { RunEstimate } from "@devdigest/shared";

export function estimateSeconds(ms: number): number {
  return Math.round(ms / 1000);
}

/** Both null when there is no estimate or `sample_size` is 0. */
export function estimateFor(e?: RunEstimate): { seconds: number | null; costUsd: number | null } {
  if (!e || e.sample_size <= 0) return { seconds: null, costUsd: null };
  return {
    seconds: e.median_duration_ms == null ? null : estimateSeconds(e.median_duration_ms),
    costUsd: e.median_cost_usd,
  };
}

/** Max seconds, summed cost, and `partial` when a checked agent has no estimate. */
export function estimateTotals(
  list: (RunEstimate | undefined)[],
): { seconds: number | null; costUsd: number | null; partial: boolean } {
  let seconds: number | null = null;
  let costUsd: number | null = null;
  let partial = false;
  for (const e of list) {
    if (!e || e.sample_size <= 0) {
      partial = true;
      continue;
    }
    const f = estimateFor(e);
    if (f.seconds != null) seconds = Math.max(seconds ?? 0, f.seconds);
    if (f.costUsd != null) costUsd = (costUsd ?? 0) + f.costUsd;
  }
  return { seconds, costUsd, partial };
}
