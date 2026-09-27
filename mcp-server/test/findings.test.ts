import { describe, expect, it } from 'vitest';
import { fitToBudget, reviewForRun, selectRun, shapeReview, truncate } from '../src/domain/findings.js';
import type { FindingRecord, ReviewRecord, RunSummary } from '../src/domain/contracts.js';

function finding(over: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: 'f1',
    severity: 'WARNING',
    category: 'style',
    title: 'title',
    file: 'a.ts',
    start_line: 1,
    end_line: 1,
    rationale: 'because',
    suggestion: null,
    confidence: 0.9,
    dismissed_at: null,
    ...over,
  };
}

function review(over: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: 'rv1',
    run_id: 'run1',
    kind: 'review',
    verdict: 'approve',
    score: 80,
    findings: [],
    ...over,
  };
}

describe('selectRun', () => {
  const runs: RunSummary[] = [
    { run_id: 'r1', agent_id: 'a1', agent_name: 'A', status: 'done', error: null, ran_at: '2026-09-27T00:00:02Z' },
    { run_id: 'r2', agent_id: 'a2', agent_name: 'B', status: 'done', error: null, ran_at: '2026-09-27T00:00:01Z' },
  ];

  it('selects by run_id first', () => {
    expect(selectRun(runs, { runId: 'r2' })?.run_id).toBe('r2');
  });

  it('falls back to the latest run of an agent', () => {
    expect(selectRun(runs, { agentId: 'a2' })?.run_id).toBe('r2');
  });

  it('falls back to the newest run overall (runs[0])', () => {
    expect(selectRun(runs, {})?.run_id).toBe('r1');
  });
});

describe('reviewForRun', () => {
  it('matches by run_id and kind === review, skipping summary rows', () => {
    const reviews = [review({ id: 's1', run_id: 'run1', kind: 'summary' }), review({ id: 'rv1', run_id: 'run1' })];
    const found = reviewForRun(reviews, 'run1');
    expect(found?.id).toBe('rv1');
  });
});

describe('shapeReview', () => {
  it('drops dismissed findings before sorting/filtering', () => {
    const r = review({
      findings: [finding({ id: 'f1', severity: 'CRITICAL', dismissed_at: '2026-09-27T00:00:00Z' }), finding({ id: 'f2', severity: 'WARNING' })],
    });
    const shaped = shapeReview(r, { limit: 20, format: 'concise', textMax: 500 });
    expect(shaped.findings.map((f) => f.id)).toEqual(['f2']);
    expect(shaped.total).toBe(1);
  });

  it('sorts CRITICAL -> WARNING -> SUGGESTION', () => {
    const r = review({
      findings: [
        finding({ id: 'f1', severity: 'SUGGESTION' }),
        finding({ id: 'f2', severity: 'CRITICAL' }),
        finding({ id: 'f3', severity: 'WARNING' }),
      ],
    });
    const shaped = shapeReview(r, { limit: 20, format: 'concise', textMax: 500 });
    expect(shaped.findings.map((f) => f.id)).toEqual(['f2', 'f3', 'f1']);
  });

  it('filters by min_severity', () => {
    const r = review({
      findings: [finding({ id: 'f1', severity: 'CRITICAL' }), finding({ id: 'f2', severity: 'SUGGESTION' })],
    });
    const shaped = shapeReview(r, { minSeverity: 'WARNING', limit: 20, format: 'concise', textMax: 500 });
    expect(shaped.findings.map((f) => f.id)).toEqual(['f1']);
  });

  it('caps by limit while total counts the full filtered set', () => {
    const findings = Array.from({ length: 5 }, (_, i) => finding({ id: `f${i}` }));
    const r = review({ findings });
    const shaped = shapeReview(r, { limit: 2, format: 'concise', textMax: 500 });
    expect(shaped.findings).toHaveLength(2);
    expect(shaped.total).toBe(5);
    expect(shaped).not.toHaveProperty('hint');
  });

  it('truncates concise title and the file part of location to textMax', () => {
    const r = review({
      findings: [finding({ title: 'x'.repeat(600), file: 'y'.repeat(600) })],
    });
    const shaped = shapeReview(r, { limit: 20, format: 'concise', textMax: 500 });
    const f = shaped.findings[0]!;
    expect(f.title).toHaveLength(500);
    expect(f.title.endsWith('…')).toBe(true);
    expect(f.location.split(':')[0]).toHaveLength(500);
  });

  it('concise vs detailed keys', () => {
    const r = review({ findings: [finding({ suggestion: 'do X' })] });
    const concise = shapeReview(r, { limit: 20, format: 'concise', textMax: 500 }).findings[0]!;
    const detailed = shapeReview(r, { limit: 20, format: 'detailed', textMax: 500 }).findings[0]!;
    expect(concise).not.toHaveProperty('rationale');
    expect(detailed).toMatchObject({ rationale: 'because', suggestion: 'do X', category: 'style', confidence: 0.9 });
  });

  it('location is file:line for a single line, file:start-end for a range', () => {
    const r = review({
      findings: [finding({ id: 'single', start_line: 5, end_line: 5 }), finding({ id: 'range', start_line: 5, end_line: 9 })],
    });
    const shaped = shapeReview(r, { limit: 20, format: 'concise', textMax: 500 });
    expect(shaped.findings.find((f) => f.id === 'single')?.location).toBe('a.ts:5');
    expect(shaped.findings.find((f) => f.id === 'range')?.location).toBe('a.ts:5-9');
  });
});

describe('truncate', () => {
  it('truncates with an ellipsis past max', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abc', 4)).toBe('abc');
  });
});

describe('fitToBudget', () => {
  it('drops tail items of value[key] until JSON.stringify(value) fits, and reports the cut count', () => {
    const findings = Array.from({ length: 50 }, (_, i) => ({
      id: `f${i}`,
      severity: 'WARNING' as const,
      location: 'a.ts:1',
      title: 'x',
      category: 'style',
      confidence: 1,
      rationale: 'r'.repeat(5000),
      suggestion: null,
    }));
    const result = { verdict: 'approve', score: 80, total: 50, findings };
    const fit = fitToBudget(result, 'findings', 20_000);
    expect(JSON.stringify(fit.value).length).toBeLessThanOrEqual(20_000);
    expect(fit.value.findings.length).toBeLessThan(50);
    expect(fit.cut).toBeGreaterThan(0);
    expect(fit.value).not.toHaveProperty('hint');
  });
});
