import { describe, it, expect } from 'vitest';
import type { Severity } from '@devdigest/shared';
import {
  buildEstimates,
  computeTotals,
  groupFindings,
  median,
  type GroupInputColumn,
} from '../src/modules/reviews/multi-run-helpers.js';

/**
 * Multi-agent review (SPEC-03) — the pure grouping / totals / estimate helpers.
 * Hermetic: no DB, no LLM, no I/O. Each `it` names the AC it proves.
 */

type F = GroupInputColumn['findings'][number];

let seq = 0;
const f = (file: string, start: number, end: number, severity: Severity, title: string, id?: string): F => ({
  id: id ?? `f-${++seq}`,
  severity,
  title,
  file,
  start_line: start,
  end_line: end,
});

const col = (
  agent_id: string,
  findings: F[] = [],
  status = 'done',
  agent_name = `Agent ${agent_id}`,
): GroupInputColumn => ({ agent_id, agent_name, status, findings });

describe('groupFindings — overlap (AC-36, AC-68)', () => {
  it('AC-36: same-file findings with overlapping inclusive ranges share one group', () => {
    const groups = groupFindings([
      col('a', [f('src/x.ts', 10, 12, 'WARNING', 'A finding')]),
      col('b', [f('src/x.ts', 12, 15, 'WARNING', 'B finding')]),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.file).toBe('src/x.ts');
    expect(groups[0]!.takes.map((t) => t.verdict)).toEqual(['WARNING', 'WARNING']);
  });

  it('AC-36: a shared single line counts as overlap (inclusive ends)', () => {
    const groups = groupFindings([
      col('a', [f('src/x.ts', 7, 7, 'WARNING', 'One line')]),
      col('b', [f('src/x.ts', 7, 7, 'WARNING', 'Same line')]),
    ]);
    expect(groups).toHaveLength(1);
  });

  it('AC-36: touching-but-disjoint ranges ([10,12] and [13,15]) are two groups', () => {
    const groups = groupFindings([
      col('a', [f('src/x.ts', 10, 12, 'WARNING', 'First')]),
      col('b', [f('src/x.ts', 13, 15, 'WARNING', 'Second')]),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.line)).toEqual([10, 13]);
  });

  it('AC-36: the same range in different files is two groups', () => {
    const groups = groupFindings([
      col('a', [f('src/x.ts', 10, 12, 'WARNING', 'In x')]),
      col('b', [f('src/y.ts', 10, 12, 'WARNING', 'In y')]),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.file)).toEqual(['src/x.ts', 'src/y.ts']);
  });

  it('AC-68: a chain A~B, B~C (A does not overlap C) lands in ONE group of three takes', () => {
    const groups = groupFindings([
      col('a', [f('src/x.ts', 1, 5, 'WARNING', 'A')]),
      col('b', [f('src/x.ts', 5, 10, 'WARNING', 'B')]),
      col('c', [f('src/x.ts', 10, 15, 'WARNING', 'C')]),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.line).toBe(1);
    expect(groups[0]!.takes.map((t) => t.agent_id)).toEqual(['a', 'b', 'c']);
    expect(groups[0]!.takes.every((t) => t.verdict === 'WARNING')).toBe(true);
  });

  it('AC-68: a chain is joined whatever order the findings arrive in', () => {
    const cols = [
      col('c', [f('src/x.ts', 10, 15, 'WARNING', 'C')]),
      col('a', [f('src/x.ts', 1, 5, 'WARNING', 'A')]),
      col('b', [f('src/x.ts', 5, 10, 'WARNING', 'B')]),
    ];
    expect(groupFindings(cols)).toHaveLength(1);
  });

  it('AC-36: a wide finding joins two groups that would otherwise stay apart', () => {
    const groups = groupFindings([
      col('a', [f('src/x.ts', 1, 3, 'WARNING', 'Low')]),
      col('b', [f('src/x.ts', 20, 22, 'WARNING', 'High')]),
      col('c', [f('src/x.ts', 2, 21, 'WARNING', 'Wide')]),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.takes).toHaveLength(3);
  });
});

describe('groupFindings — takes (AC-37)', () => {
  it('AC-37: each done agent gets exactly one take; a silent agent is `ignored` with an empty note', () => {
    const [group] = groupFindings([
      col('a', [f('src/x.ts', 10, 12, 'CRITICAL', 'Injection')]),
      col('b', []),
    ]);
    expect(group!.takes).toHaveLength(2);
    const a = group!.takes.find((t) => t.agent_id === 'a')!;
    const b = group!.takes.find((t) => t.agent_id === 'b')!;
    expect(a.verdict).toBe('CRITICAL');
    expect(a.note).toBe('Injection');
    expect(b.verdict).toBe('ignored');
    expect(b.note).toBe('');
  });

  it('AC-37: with two findings in the group an agent takes its most severe one (verdict and note)', () => {
    const [group] = groupFindings([
      col('a', [
        f('src/x.ts', 10, 12, 'WARNING', 'Mild one'),
        f('src/x.ts', 11, 11, 'CRITICAL', 'Severe one'),
        f('src/x.ts', 12, 13, 'SUGGESTION', 'Nit'),
      ]),
      col('b', [f('src/x.ts', 10, 10, 'SUGGESTION', 'Tiny')]),
    ]);
    expect(group!.takes).toHaveLength(2);
    const a = group!.takes.find((t) => t.agent_id === 'a')!;
    expect(a.verdict).toBe('CRITICAL');
    expect(a.note).toBe('Severe one');
  });

  it('AC-37: takes follow the column order and carry the agent name as persona', () => {
    const [group] = groupFindings([
      col('z', [f('src/x.ts', 1, 1, 'WARNING', 'T')], 'done', 'Zed'),
      col('m', [], 'done', 'Mid'),
      col('a', [f('src/x.ts', 1, 1, 'WARNING', 'T2')], 'done', 'Alpha'),
    ]);
    expect(group!.takes.map((t) => t.agent_id)).toEqual(['z', 'm', 'a']);
    expect(group!.takes.map((t) => t.persona)).toEqual(['Zed', 'Mid', 'Alpha']);
  });
});

describe('groupFindings — conflicts (AC-38)', () => {
  it('AC-38: one agent flagged and another done agent did not -> conflict', () => {
    const [group] = groupFindings([
      col('a', [f('src/x.ts', 5, 5, 'WARNING', 'Flagged')]),
      col('b', []),
    ]);
    expect(group!.is_conflict).toBe(true);
  });

  it('AC-38: flagging agents with different severities -> conflict', () => {
    const [group] = groupFindings([
      col('a', [f('src/x.ts', 5, 5, 'WARNING', 'Meh')]),
      col('b', [f('src/x.ts', 5, 5, 'CRITICAL', 'Bad')]),
    ]);
    expect(group!.is_conflict).toBe(true);
  });

  it('AC-38: every done agent flagged with the same severity -> not a conflict', () => {
    const [group] = groupFindings([
      col('a', [f('src/x.ts', 5, 5, 'WARNING', 'Same A')]),
      col('b', [f('src/x.ts', 5, 6, 'WARNING', 'Same B')]),
      col('c', [f('src/x.ts', 4, 5, 'WARNING', 'Same C')]),
    ]);
    expect(group!.is_conflict).toBe(false);
  });

  it('AC-38: a lone done agent that flagged something is not a conflict (nobody to disagree with)', () => {
    const [group] = groupFindings([col('a', [f('src/x.ts', 5, 5, 'WARNING', 'Alone')])]);
    expect(group!.is_conflict).toBe(false);
  });
});

describe('groupFindings — only `done` runs take part (AC-39)', () => {
  it.each(['running', 'failed', 'cancelled'])('AC-39: a %s column gets no take and starts no group', (status) => {
    const groups = groupFindings([
      col('a', [f('src/x.ts', 5, 5, 'WARNING', 'Done A')]),
      col('b', [f('src/x.ts', 5, 5, 'WARNING', 'Done B')]),
      col('x', [f('src/x.ts', 5, 5, 'CRITICAL', 'Not finished'), f('src/other.ts', 1, 1, 'CRITICAL', 'Elsewhere')], status),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.takes.map((t) => t.agent_id)).toEqual(['a', 'b']);
    expect(groups[0]!.takes.every((t) => t.verdict === 'WARNING')).toBe(true);
    expect(groups[0]!.is_conflict).toBe(false);
  });

  it('AC-39: with no done column there are no groups at all', () => {
    expect(
      groupFindings([
        col('x', [f('src/x.ts', 1, 1, 'CRITICAL', 'T')], 'failed'),
        col('y', [f('src/x.ts', 1, 1, 'CRITICAL', 'T')], 'running'),
      ]),
    ).toEqual([]);
    expect(groupFindings([])).toEqual([]);
  });
});

describe('groupFindings — title and order are deterministic (AC-40)', () => {
  it('AC-40: groups are ordered by file, then by first line', () => {
    const groups = groupFindings([
      col('a', [
        f('src/b.ts', 5, 5, 'WARNING', 'B5'),
        f('src/a.ts', 20, 20, 'WARNING', 'A20'),
        f('src/a.ts', 3, 3, 'WARNING', 'A3'),
      ]),
    ]);
    expect(groups.map((g) => `${g.file}:${g.line}`)).toEqual(['src/a.ts:3', 'src/a.ts:20', 'src/b.ts:5']);
  });

  it('AC-40: file order is by code unit (uppercase before lowercase), not by locale', () => {
    const groups = groupFindings([
      col('a', [f('alpha.ts', 1, 1, 'WARNING', 'lower'), f('Zeta.ts', 1, 1, 'WARNING', 'upper')]),
    ]);
    expect(groups.map((g) => g.file)).toEqual(['Zeta.ts', 'alpha.ts']);
  });

  it('AC-40: `line` is the smallest start_line in the group', () => {
    const [group] = groupFindings([
      col('a', [f('src/x.ts', 12, 14, 'WARNING', 'Later')]),
      col('b', [f('src/x.ts', 9, 12, 'WARNING', 'Earlier')]),
    ]);
    expect(group!.line).toBe(9);
  });

  it('AC-40: the group title is the title of its most severe finding', () => {
    const [group] = groupFindings([
      col('a', [f('src/x.ts', 10, 12, 'WARNING', 'Warning title')]),
      col('b', [f('src/x.ts', 11, 11, 'CRITICAL', 'Critical title')]),
      col('c', [f('src/x.ts', 10, 10, 'SUGGESTION', 'Nit title')]),
    ]);
    expect(group!.title).toBe('Critical title');
  });

  it('AC-40: equally severe findings: the lower start_line titles the group', () => {
    const [group] = groupFindings([
      col('a', [f('src/x.ts', 12, 14, 'WARNING', 'Later title', 'id-1')]),
      col('b', [f('src/x.ts', 10, 12, 'WARNING', 'Earlier title', 'id-9')]),
    ]);
    expect(group!.title).toBe('Earlier title');
  });

  it('AC-40: equally severe on the same line: the smaller finding id titles the group', () => {
    const [group] = groupFindings([
      col('a', [f('src/x.ts', 10, 12, 'WARNING', 'Title of id-b', 'id-b')]),
      col('b', [f('src/x.ts', 10, 12, 'WARNING', 'Title of id-a', 'id-a')]),
    ]);
    expect(group!.title).toBe('Title of id-a');
  });

  it('AC-40: the same findings in any order give identical groups', () => {
    const findings = [
      f('src/a.ts', 3, 6, 'WARNING', 'a1', 'id-1'),
      f('src/a.ts', 5, 9, 'CRITICAL', 'a2', 'id-2'),
      f('src/a.ts', 30, 31, 'SUGGESTION', 'a3', 'id-3'),
      f('src/b.ts', 1, 2, 'WARNING', 'b1', 'id-4'),
      f('src/b.ts', 2, 2, 'WARNING', 'b2', 'id-5'),
    ];
    const other = [f('src/a.ts', 6, 7, 'WARNING', 'o1', 'id-6'), f('src/b.ts', 40, 41, 'CRITICAL', 'o2', 'id-7')];
    const build = (mine: F[], theirs: F[]) => [col('a', mine), col('b', theirs)];
    const reference = groupFindings(build(findings, other));
    expect(reference.length).toBeGreaterThan(2);
    expect(groupFindings(build([...findings].reverse(), [...other].reverse()))).toEqual(reference);
    const rotated = [...findings.slice(2), ...findings.slice(0, 2)];
    expect(groupFindings(build(rotated, other))).toEqual(reference);
  });
});

describe('computeTotals (AC-33, AC-69)', () => {
  it('AC-33: total time is the longest done duration, total cost the sum of non-null done costs', () => {
    expect(
      computeTotals([
        { status: 'done', duration_ms: 4000, cost_usd: 0.01 },
        { status: 'done', duration_ms: 9000, cost_usd: 0.02 },
        { status: 'done', duration_ms: 1000, cost_usd: null },
      ]),
    ).toEqual({ total_duration_ms: 9000, total_cost_usd: expect.closeTo(0.03, 6) });
  });

  it.each(['running', 'failed', 'cancelled'])('AC-33: a %s run counts toward neither time nor cost', (status) => {
    const totals = computeTotals([
      { status: 'done', duration_ms: 2000, cost_usd: 0.5 },
      { status: 'done', duration_ms: 3000, cost_usd: 0.25 },
      { status, duration_ms: 99_000, cost_usd: 100 },
    ]);
    expect(totals.total_duration_ms).toBe(3000);
    expect(totals.total_cost_usd).toBeCloseTo(0.75, 6);
  });

  it('AC-69: when every done run has a null cost the total cost is null, never 0', () => {
    const totals = computeTotals([
      { status: 'done', duration_ms: 1500, cost_usd: null },
      { status: 'done', duration_ms: 2500, cost_usd: null },
      { status: 'failed', duration_ms: 100, cost_usd: 3 },
    ]);
    expect(totals.total_cost_usd).toBeNull();
    expect(totals.total_duration_ms).toBe(2500);
  });

  it('AC-69: a done run priced at exactly 0 gives a total of 0 (known free), not null', () => {
    expect(computeTotals([{ status: 'done', duration_ms: 10, cost_usd: 0 }]).total_cost_usd).toBe(0);
  });

  it('AC-33: with no done run the duration is 0 and the cost null', () => {
    expect(computeTotals([])).toEqual({ total_duration_ms: 0, total_cost_usd: null });
    expect(computeTotals([{ status: 'running', duration_ms: null, cost_usd: null }])).toEqual({
      total_duration_ms: 0,
      total_cost_usd: null,
    });
  });
});

describe('median / buildEstimates (AC-15 helpers)', () => {
  it('median of an odd count is the middle value of the sorted list', () => {
    expect(median([30, 10, 20])).toBe(20);
    expect(median([5])).toBe(5);
  });

  it('median of an even count is the mean of the middle two', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([1000, 2000])).toBe(1500);
  });

  it('median of nothing is null', () => {
    expect(median([])).toBeNull();
  });

  it('buildEstimates: medians per agent, cost median over non-null costs only, sample size = runs used', () => {
    const estimates = buildEstimates(
      ['a', 'b'],
      [
        { agent_id: 'a', duration_ms: 1000, cost_usd: 0.1 },
        { agent_id: 'a', duration_ms: 3000, cost_usd: null },
        { agent_id: 'a', duration_ms: 2000, cost_usd: 0.3 },
        { agent_id: 'b', duration_ms: 500, cost_usd: null },
        { agent_id: 'zzz', duration_ms: 9, cost_usd: 9 },
      ],
    );
    expect(estimates).toHaveLength(2);
    const a = estimates.find((e) => e.agent_id === 'a')!;
    expect(a.median_duration_ms).toBe(2000);
    expect(a.median_cost_usd).toBeCloseTo(0.2, 6);
    expect(a.sample_size).toBe(3);
    const b = estimates.find((e) => e.agent_id === 'b')!;
    expect(b).toMatchObject({ median_duration_ms: 500, median_cost_usd: null, sample_size: 1 });
  });

  it('buildEstimates: an agent with 0 runs gets null medians and sample_size 0; durations round to whole ms', () => {
    const estimates = buildEstimates(
      ['never', 'odd'],
      [
        { agent_id: 'odd', duration_ms: 1000, cost_usd: null },
        { agent_id: 'odd', duration_ms: 1001, cost_usd: null },
      ],
    );
    expect(estimates.find((e) => e.agent_id === 'never')).toEqual({
      agent_id: 'never',
      median_duration_ms: null,
      median_cost_usd: null,
      sample_size: 0,
    });
    const odd = estimates.find((e) => e.agent_id === 'odd')!;
    expect(Number.isInteger(odd.median_duration_ms)).toBe(true);
    expect(odd.median_duration_ms).toBe(1001);
  });
});
