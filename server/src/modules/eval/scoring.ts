import type {
  EvalCaseFlip,
  EvalExpectation,
  EvalExpectationType,
  EvalMetricDelta,
  EvalRunMetrics,
} from '@devdigest/shared';

/**
 * Eval scoring — ring 1, PURE. Code alone decides pass/fail and every metric:
 * no I/O, no wiring, no model. Everything here is a function of its arguments,
 * so the same findings always score the same.
 *
 * Only GROUNDED findings are ever passed in (the grounding gate runs before
 * scoring); `kept`/`dropped` are the gate's counts, used for citation accuracy.
 */

/** The location part of a finding — all matching needs. */
export interface LocatedFinding {
  file: string;
  start_line: number;
  end_line: number;
}

/** Per-case score; the per-row columns of `eval_runs` (C6 c). */
export interface CaseScore {
  pass: boolean;
  /** Findings that matched a `must_find` expectation. */
  tp: number;
  /** Findings that matched a `must_not_flag` expectation. */
  fp: number;
  /** 1 | 0 for `must_find`, `null` for `must_not_flag`. */
  recall: number | null;
  precision: number | null;
  citation_accuracy: number | null;
}

/** One case, reduced to what the run-level metrics need. */
export interface ScoredCase {
  status: 'pending' | 'completed' | 'errored';
  type: EvalExpectationType | null;
  pass: boolean | null;
  tp: number;
  fp: number;
  kept: number;
  dropped: number;
  durationMs: number | null;
  costUsd: number | null;
}

export function orderedRange(start: number, end: number): [number, number] {
  return start <= end ? [start, end] : [end, start];
}

/** Same file, and the line ranges intersect once each is put in min/max order. */
export function matches(finding: LocatedFinding, expectation: EvalExpectation): boolean {
  if (finding.file !== expectation.file) return false;
  const [fLo, fHi] = orderedRange(finding.start_line, finding.end_line);
  const [eLo, eHi] = orderedRange(expectation.start_line, expectation.end_line);
  return fLo <= eHi && eLo <= fHi;
}

function ratio(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

export function scoreCase(
  expectation: EvalExpectation,
  findings: LocatedFinding[],
  kept: number,
  dropped: number,
): CaseScore {
  const hits = findings.filter((f) => matches(f, expectation)).length;
  const mustFind = expectation.type === 'must_find';
  const tp = mustFind ? hits : 0;
  const fp = mustFind ? 0 : hits;
  return {
    pass: mustFind ? hits >= 1 : hits === 0,
    tp,
    fp,
    recall: mustFind ? (hits >= 1 ? 1 : 0) : null,
    // Findings that match nothing are unlabelled: neither true nor false positives.
    precision: ratio(tp, tp + fp),
    citation_accuracy: ratio(kept, kept + dropped),
  };
}

/** Run metrics over the COMPLETED cases only; errored and pending ones are excluded. */
export function scoreRun(cases: ScoredCase[]): EvalRunMetrics {
  const done = cases.filter((c) => c.status === 'completed');
  const mustFind = done.filter((c) => c.type === 'must_find');
  const tp = done.reduce((n, c) => n + c.tp, 0);
  const fp = done.reduce((n, c) => n + c.fp, 0);
  const kept = done.reduce((n, c) => n + c.kept, 0);
  const dropped = done.reduce((n, c) => n + c.dropped, 0);
  const anyUnpriced = done.some((c) => c.costUsd === null);
  return {
    recall: ratio(mustFind.filter((c) => c.pass === true).length, mustFind.length),
    precision: ratio(tp, tp + fp),
    citation_accuracy: ratio(kept, kept + dropped),
    traces_passed: done.filter((c) => c.pass === true).length,
    traces_total: done.length,
    cases_errored: cases.filter((c) => c.status === 'errored').length,
    duration_ms: Math.round(done.reduce((n, c) => n + (c.durationMs ?? 0), 0)),
    cost_usd:
      done.length === 0 || anyUnpriced ? null : done.reduce((n, c) => n + (c.costUsd ?? 0), 0),
  };
}

function diff(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : b - a;
}

/** `b − a` per metric; `null` as soon as either side is not computable. */
export function metricDeltas(
  a: Pick<EvalRunMetrics, 'recall' | 'precision' | 'citation_accuracy' | 'cost_usd'>,
  b: Pick<EvalRunMetrics, 'recall' | 'precision' | 'citation_accuracy' | 'cost_usd'>,
): EvalMetricDelta {
  return {
    recall: diff(a.recall, b.recall),
    precision: diff(a.precision, b.precision),
    citation_accuracy: diff(a.citation_accuracy, b.citation_accuracy),
    cost_usd: diff(a.cost_usd, b.cost_usd),
  };
}

export interface FlipRow {
  case_id: string;
  name: string;
  pass: boolean | null;
}

/** Cases present in both runs, with a decided result on both sides, whose result differs. */
export function caseFlips(aRows: FlipRow[], bRows: FlipRow[]): EvalCaseFlip[] {
  const bById = new Map(bRows.map((r) => [r.case_id, r]));
  const flips: EvalCaseFlip[] = [];
  for (const a of aRows) {
    const b = bById.get(a.case_id);
    if (!b || a.pass === null || b.pass === null || a.pass === b.pass) continue;
    flips.push({
      case_id: a.case_id,
      name: a.name,
      a_pass: a.pass,
      b_pass: b.pass,
      direction: a.pass ? 'pass_to_fail' : 'fail_to_pass',
    });
  }
  return flips;
}
