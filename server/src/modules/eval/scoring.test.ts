import { describe, it, expect } from 'vitest';
import type { EvalExpectation } from '@devdigest/shared';
import {
  caseFlips,
  matches,
  metricDeltas,
  scoreCase,
  scoreRun,
  type ScoredCase,
} from './scoring.js';

const exp = (over: Partial<EvalExpectation> = {}): EvalExpectation => ({
  type: 'must_find',
  file: 'src/a.ts',
  start_line: 10,
  end_line: 20,
  severity: 'WARNING',
  category: 'bug',
  title: 't',
  ...over,
});
const at = (start: number, end: number, file = 'src/a.ts') => ({
  file,
  start_line: start,
  end_line: end,
});

describe('matches', () => {
  it('matches the same file with overlapping ranges', () => {
    expect(matches(at(15, 16), exp())).toBe(true);
  });
  it('does not match another file', () => {
    expect(matches(at(15, 16, 'src/b.ts'), exp())).toBe(false);
  });
  it('does not match a disjoint range', () => {
    expect(matches(at(21, 30), exp())).toBe(false);
    expect(matches(at(1, 9), exp())).toBe(false);
  });
  it('matches a one-line touch at either end of the expectation', () => {
    expect(matches(at(20, 25), exp())).toBe(true);
    expect(matches(at(5, 10), exp())).toBe(true);
  });
  it('orders reversed ranges on both sides', () => {
    expect(matches(at(16, 15), exp())).toBe(true);
    expect(matches(at(15, 16), exp({ start_line: 20, end_line: 10 }))).toBe(true);
  });
});

describe('scoreCase', () => {
  it('must_find passes with one match and fails with none', () => {
    expect(scoreCase(exp(), [at(12, 12)], 1, 0)).toMatchObject({ pass: true, tp: 1, fp: 0, recall: 1 });
    expect(scoreCase(exp(), [at(50, 51)], 1, 0)).toMatchObject({ pass: false, tp: 0, recall: 0 });
  });
  it('must_not_flag passes with no match and fails with one', () => {
    const e = exp({ type: 'must_not_flag' });
    expect(scoreCase(e, [at(50, 51)], 1, 0)).toMatchObject({ pass: true, fp: 0, recall: null });
    expect(scoreCase(e, [at(12, 12)], 1, 0)).toMatchObject({ pass: false, fp: 1, precision: 0 });
  });
  it('derives per-row precision and citation accuracy', () => {
    const s = scoreCase(exp(), [at(12, 12), at(50, 51)], 2, 2);
    expect(s.precision).toBe(1);
    expect(s.citation_accuracy).toBe(0.5);
  });
  it('is null where nothing is computable', () => {
    const s = scoreCase(exp(), [], 0, 0);
    expect(s.precision).toBeNull();
    expect(s.citation_accuracy).toBeNull();
  });
});

const sc = (over: Partial<ScoredCase> = {}): ScoredCase => ({
  status: 'completed',
  type: 'must_find',
  pass: true,
  tp: 1,
  fp: 0,
  kept: 1,
  dropped: 0,
  durationMs: 100,
  costUsd: 0.5,
  ...over,
});

describe('scoreRun', () => {
  it('recall is passed must_find over all must_find', () => {
    const m = scoreRun([sc(), sc({ pass: false, tp: 0 }), sc({ type: 'must_not_flag', tp: 0 })]);
    expect(m.recall).toBe(0.5);
  });
  it('precision is TP/(TP+FP); unlabelled findings do not dilute it', () => {
    // 1 TP, 1 FP and 3 unlabelled findings: 1 - FP/total would give 0.8, TP/(TP+FP) is 0.5.
    const m = scoreRun([
      sc({ tp: 1, fp: 0, kept: 4 }),
      sc({ type: 'must_not_flag', pass: false, tp: 0, fp: 1, kept: 1 }),
    ]);
    expect(m.precision).toBe(0.5);
  });
  it('citation accuracy is sum(kept)/sum(kept+dropped)', () => {
    const m = scoreRun([sc({ kept: 4, dropped: 1 }), sc({ kept: 2, dropped: 1 })]);
    expect(m.citation_accuracy).toBeCloseTo(6 / 8);
  });
  it('excludes errored cases from every metric but counts them', () => {
    const m = scoreRun([
      sc(),
      sc({ status: 'errored', pass: null, tp: 0, kept: 0, durationMs: 9999, costUsd: 9 }),
    ]);
    expect(m).toMatchObject({
      recall: 1,
      traces_total: 1,
      traces_passed: 1,
      cases_errored: 1,
      duration_ms: 100,
      cost_usd: 0.5,
    });
  });
  it('is null where not computable', () => {
    const m = scoreRun([
      sc({ type: 'must_not_flag', tp: 0, fp: 0, kept: 0, dropped: 0 }),
    ]);
    expect(m.recall).toBeNull();
    expect(m.precision).toBeNull();
    expect(m.citation_accuracy).toBeNull();
  });
  it('cost is null when any case has no cost', () => {
    expect(scoreRun([sc(), sc({ costUsd: null })]).cost_usd).toBeNull();
    expect(scoreRun([sc(), sc()]).cost_usd).toBe(1);
  });
});

describe('metricDeltas', () => {
  it('is b - a, and null when either side is null', () => {
    const base = { recall: 0.5, precision: 0.5, citation_accuracy: 1, cost_usd: 1 };
    const d = metricDeltas(base, { ...base, recall: 0.75, precision: null });
    expect(d.recall).toBeCloseTo(0.25);
    expect(d.precision).toBeNull();
    expect(d.citation_accuracy).toBe(0);
  });
});

describe('caseFlips', () => {
  it('reports both directions over shared cases only', () => {
    const a = [
      { case_id: '1', name: 'one', pass: true },
      { case_id: '2', name: 'two', pass: false },
      { case_id: '3', name: 'three', pass: true },
      { case_id: '4', name: 'four', pass: true },
    ];
    const b = [
      { case_id: '1', name: 'one', pass: false },
      { case_id: '2', name: 'two', pass: true },
      { case_id: '3', name: 'three', pass: true },
      { case_id: '5', name: 'five', pass: false },
    ];
    expect(caseFlips(a, b)).toEqual([
      { case_id: '1', name: 'one', a_pass: true, b_pass: false, direction: 'pass_to_fail' },
      { case_id: '2', name: 'two', a_pass: false, b_pass: true, direction: 'fail_to_pass' },
    ]);
  });
  it('ignores undecided (errored) sides', () => {
    expect(
      caseFlips([{ case_id: '1', name: 'x', pass: null }], [{ case_id: '1', name: 'x', pass: true }]),
    ).toEqual([]);
  });
});
