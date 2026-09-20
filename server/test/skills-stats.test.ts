import { describe, it, expect } from 'vitest';
import {
  EMPTY_AGGREGATE,
  acceptRate,
  pullRate,
  ratio,
  sortCategories,
  statsWindowStart,
  toCardStats,
  toSkillStats,
  type RunAggregate,
} from '../src/modules/skills/stats.js';

const agg = (over: Partial<RunAggregate>): RunAggregate => ({ ...EMPTY_AGGREGATE, ...over });

describe('skill stats arithmetic', () => {
  it('a skill that was never in a run reads zeros, never NaN or null', () => {
    expect(toCardStats(0)).toEqual({ agent_count: 0, pull_rate: 0, accept_rate: 0 });
    expect(toSkillStats([], undefined, [])).toEqual({
      agent_count: 0,
      pull_rate: 0,
      accept_rate: 0,
      findings_30d: 0,
      agents: [],
      by_category: [],
    });
  });

  it('zero runs is a zero pull_rate, not a divide-by-zero', () => {
    expect(pullRate(agg({ runs: 0, runsIncluded: 0 }))).toBe(0);
    expect(Number.isNaN(pullRate(EMPTY_AGGREGATE))).toBe(false);
  });

  it('no accepted and no dismissed finding is accept_rate 0, even with findings', () => {
    expect(acceptRate(agg({ runs: 3, runsIncluded: 3, findings: 5 }))).toBe(0);
  });

  it('pull_rate is included runs over all completed runs, as a 0..1 ratio', () => {
    expect(pullRate(agg({ runs: 4, runsIncluded: 3 }))).toBe(0.75);
    expect(pullRate(agg({ runs: 5, runsIncluded: 5 }))).toBe(1);
    expect(pullRate(agg({ runs: 2, runsIncluded: 0 }))).toBe(0);
  });

  it('accept_rate ignores findings nobody judged: accepted / (accepted + dismissed)', () => {
    expect(acceptRate(agg({ findings: 10, accepted: 1, dismissed: 3 }))).toBe(0.25);
    expect(acceptRate(agg({ findings: 10, accepted: 2, dismissed: 0 }))).toBe(1);
    expect(acceptRate(agg({ findings: 10, accepted: 0, dismissed: 4 }))).toBe(0);
  });

  it('rounds ratios to 4 decimals (2/3 -> 0.6667), so floats never leak into the JSON', () => {
    expect(ratio(2, 3)).toBe(0.6667);
    expect(ratio(1, 3)).toBe(0.3333);
    expect(ratio(1, 7)).toBe(0.1429);
  });

  it('a card carries the link count next to the two rates', () => {
    expect(toCardStats(2, agg({ runs: 4, runsIncluded: 2, accepted: 1, dismissed: 1 }))).toEqual({
      agent_count: 2,
      pull_rate: 0.5,
      accept_rate: 0.5,
    });
  });

  it('by_category is sorted by count desc, ties by name, without mutating the input', () => {
    const input = [
      { category: 'style', count: 1 },
      { category: 'security', count: 4 },
      { category: 'bug', count: 4 },
      { category: 'perf', count: 2 },
    ];
    expect(sortCategories(input).map((c) => c.category)).toEqual(['bug', 'security', 'perf', 'style']);
    expect(input[0]!.category).toBe('style');
  });

  it('the skill stats agent_count is the length of the agents list', () => {
    const agents = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ];
    const stats = toSkillStats(agents, agg({ runs: 2, runsIncluded: 1, findings: 3 }), [
      { category: 'bug', count: 3 },
    ]);
    expect(stats).toMatchObject({ agent_count: 2, pull_rate: 0.5, findings_30d: 3, agents });
  });

  it('the window starts exactly 30 days before now', () => {
    const now = new Date('2026-09-20T12:00:00.000Z');
    expect(statsWindowStart(now).toISOString()).toBe('2026-08-21T12:00:00.000Z');
  });
});
