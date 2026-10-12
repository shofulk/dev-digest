import { describe, it, expect } from 'vitest';
import { columnStatus, computeTotals, newestPerAgent, summaryStatus } from '../src/modules/reviews/multi-run-helpers.js';

/**
 * SPEC-06 (multi-agent run history) — the pure helpers behind
 * GET /repos/:id/multi-agent-runs: `summaryStatus`, `columnStatus`,
 * `newestPerAgent`, plus a guard on the existing `computeTotals`.
 */

describe('summaryStatus', () => {
  it('AC-80: any running counted run makes the multi-run running, whatever the others are', () => {
    expect(summaryStatus(['running', 'done', 'failed'])).toBe('running');
    expect(summaryStatus(['running'])).toBe('running');
    expect(summaryStatus(['cancelled', 'running'])).toBe('running');
  });

  it('AC-102: every counted run done -> done', () => {
    expect(summaryStatus(['done', 'done'])).toBe('done');
    expect(summaryStatus(['done'])).toBe('done');
  });

  it('AC-103: some done and some failed or cancelled -> partial', () => {
    expect(summaryStatus(['done', 'failed'])).toBe('partial');
    expect(summaryStatus(['done', 'cancelled'])).toBe('partial');
    expect(summaryStatus(['failed', 'done', 'cancelled'])).toBe('partial');
  });

  it('AC-104: none running or done -> failed; cancelled counts as not done (H-A-3)', () => {
    expect(summaryStatus(['failed', 'cancelled'])).toBe('failed');
    expect(summaryStatus(['cancelled'])).toBe('failed');
    expect(summaryStatus(['failed'])).toBe('failed');
  });

  it('AC-81: no counted run -> failed', () => {
    expect(summaryStatus([])).toBe('failed');
  });
});

describe('columnStatus', () => {
  it('H3: each of the four column statuses maps to itself', () => {
    expect(columnStatus('running')).toBe('running');
    expect(columnStatus('done')).toBe('done');
    expect(columnStatus('failed')).toBe('failed');
    expect(columnStatus('cancelled')).toBe('cancelled');
  });

  it('H3: null and queued map to failed', () => {
    expect(columnStatus(null)).toBe('failed');
    expect(columnStatus('queued')).toBe('failed');
  });
});

describe('newestPerAgent', () => {
  type Row = { id: string; agentId: string | null };

  it('AC-106: over newest-first rows keeps only the first run of an agent', () => {
    const rows: Row[] = [
      { id: 'a-new', agentId: 'A' },
      { id: 'b-1', agentId: 'B' },
      { id: 'a-old', agentId: 'A' },
    ];
    const out = newestPerAgent(rows, (r) => r.agentId);
    expect(out.map((r) => r.id)).toEqual(['a-new', 'b-1']);
  });

  it('AC-81: rows with a null agent id are dropped', () => {
    const rows: Row[] = [
      { id: 'x', agentId: null },
      { id: 'a', agentId: 'A' },
      { id: 'y', agentId: null },
    ];
    expect(newestPerAgent(rows, (r) => r.agentId).map((r) => r.id)).toEqual(['a']);
    expect(newestPerAgent([{ id: 'x', agentId: null }], (r) => r.agentId)).toEqual([]);
  });

  it('AC-106: keeps the input order of the surviving rows and handles an empty input', () => {
    const rows: Row[] = [
      { id: 'c', agentId: 'C' },
      { id: 'a', agentId: 'A' },
      { id: 'c2', agentId: 'C' },
    ];
    expect(newestPerAgent(rows, (r) => r.agentId).map((r) => r.id)).toEqual(['c', 'a']);
    expect(newestPerAgent([] as Row[], (r) => r.agentId)).toEqual([]);
  });
});

describe('computeTotals (guard, exists at base)', () => {
  it('AC-82: longest done duration, sum of non-null done costs', () => {
    const totals = computeTotals([
      { status: 'done', duration_ms: 5000, cost_usd: null },
      { status: 'failed', duration_ms: 9000, cost_usd: 0.3 },
      { status: 'done', duration_ms: 7000, cost_usd: 0.1 },
    ]);
    expect(totals.total_duration_ms).toBe(7000);
    expect(totals.total_cost_usd).toBeCloseTo(0.1, 10);
  });

  it('AC-82: all-null costs -> null cost; no done run -> 0 duration and null cost', () => {
    expect(computeTotals([{ status: 'done', duration_ms: 100, cost_usd: null }]).total_cost_usd).toBeNull();
    expect(computeTotals([{ status: 'failed', duration_ms: 100, cost_usd: 1 }])).toEqual({
      total_duration_ms: 0,
      total_cost_usd: null,
    });
  });
});
