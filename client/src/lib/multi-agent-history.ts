/* multi-agent-history.ts — pure helpers behind the Recent runs list and the PR-page
   "Open multi-agent review" link. No React, no I/O (SPEC-06). */
import type { MultiAgentRunSummary } from "@devdigest/shared";
import { estimateSeconds } from "./multi-agent-estimates";

/** The Recent runs list never shows more rows than the API returns (H-NFR-3). */
export const RECENT_RUNS_MAX = 20;

/** The rows to render: the first RECENT_RUNS_MAX items in API order ([] while undefined). */
export function recentRuns(items: MultiAgentRunSummary[] | undefined): MultiAgentRunSummary[] {
  return (items ?? []).slice(0, RECENT_RUNS_MAX);
}

/** Whole seconds for a run's total time, or null (shown as "—") when it is 0. */
export function runSeconds(totalMs: number): number | null {
  return totalMs === 0 ? null : estimateSeconds(totalMs);
}

/** Results-page href of the newest multi-run, or null when there is none. */
export function newestRunHref(repoId: string, items: MultiAgentRunSummary[] | undefined): string | null {
  const newest = items?.[0];
  return newest ? `/repos/${repoId}/multi-agent/${newest.id}` : null;
}
