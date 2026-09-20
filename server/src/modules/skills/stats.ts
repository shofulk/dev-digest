import type { SkillStats } from '@devdigest/shared';
import { MS_PER_DAY, RATE_DECIMALS, STATS_WINDOW_DAYS } from './constants.js';

/**
 * Ring 1 — the pure arithmetic behind skill stats (spec criterion F). The SQL lives in
 * `repository/stats.repo.ts` and hands back the raw counts below; nothing here touches a DB.
 *
 * Attribution is at RUN granularity, not finding granularity (criterion 33): a finding is
 * counted for every skill that was in its run's prompt. It says "this skill was in the
 * prompt when this finding was produced", never "this skill caused this finding".
 *
 * All numbers cover the last `STATS_WINDOW_DAYS` days, scoped to one workspace, and only the
 * runs of agents that CURRENTLY link the skill — so `runs_included <= runs` always holds and
 * a rate can never exceed 1. Only COMPLETED runs count (`agent_runs.skills_used IS NOT
 * NULL`): failed, cancelled and still-queued runs never recorded what they included, so
 * counting them in the denominator would drag `pull_rate` down for reasons that say nothing
 * about the skill.
 *
 * Rates are RATIOS in [0, 1], not percentages, rounded to `RATE_DECIMALS` decimals. A zero
 * denominator yields 0 — never NaN, never null.
 */

/** Raw per-skill counts from the runs + reviews + findings query. */
export interface RunAggregate {
  /** Completed runs of the agents that link the skill. */
  runs: number;
  /** Of those, runs whose `skills_used` contains the skill. */
  runsIncluded: number;
  /** Findings of the reviews of the runs that included the skill. */
  findings: number;
  accepted: number;
  dismissed: number;
}

export interface CategoryCount {
  category: string;
  count: number;
}

/** The three numbers on a `GET /skills` card. */
export interface CardStats {
  agent_count: number;
  pull_rate: number;
  accept_rate: number;
}

export const EMPTY_AGGREGATE: RunAggregate = {
  runs: 0,
  runsIncluded: 0,
  findings: 0,
  accepted: 0,
  dismissed: 0,
};

/** `numerator / denominator` as a ratio; 0 when there is nothing to divide by. */
export function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0 || numerator <= 0) return 0;
  const factor = 10 ** RATE_DECIMALS;
  return Math.round((numerator / denominator) * factor) / factor;
}

export function pullRate(agg: RunAggregate): number {
  return ratio(agg.runsIncluded, agg.runs);
}

/** `accepted / (accepted + dismissed)`; findings nobody has judged yet are not in it. */
export function acceptRate(agg: RunAggregate): number {
  return ratio(agg.accepted, agg.accepted + agg.dismissed);
}

export function toCardStats(agentCount: number, agg: RunAggregate = EMPTY_AGGREGATE): CardStats {
  return { agent_count: agentCount, pull_rate: pullRate(agg), accept_rate: acceptRate(agg) };
}

/** Largest bucket first; ties by category name so the donut order is stable. */
export function sortCategories(rows: CategoryCount[]): CategoryCount[] {
  return [...rows].sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}

export function toSkillStats(
  agents: { id: string; name: string }[],
  agg: RunAggregate | undefined,
  categories: CategoryCount[],
): SkillStats {
  const run = agg ?? EMPTY_AGGREGATE;
  return {
    ...toCardStats(agents.length, run),
    findings_30d: run.findings,
    agents,
    by_category: sortCategories(categories),
  };
}

export function statsWindowStart(now: Date = new Date()): Date {
  return new Date(now.getTime() - STATS_WINDOW_DAYS * MS_PER_DAY);
}
