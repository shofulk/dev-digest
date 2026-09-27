import { describe, expect, it } from 'vitest';
import { runAndWait } from '../src/app/run-review.js';
import { ReviewMissing, RunNotStarted } from '../src/domain/errors.js';
import { makeFakeApi } from './helpers/fake-api.js';
import type { RunSummary, ReviewRecord } from '../src/domain/contracts.js';

function fakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

describe('runAndWait', () => {
  it('resolves done on the 2nd poll', async () => {
    let call = 0;
    const runs: RunSummary[][] = [
      [{ run_id: 'run1', agent_id: 'a1', agent_name: 'A', status: 'running', error: null, ran_at: null }],
      [{ run_id: 'run1', agent_id: 'a1', agent_name: 'A', status: 'done', error: null, ran_at: null }],
    ];
    const review: ReviewRecord = { id: 'rv1', run_id: 'run1', kind: 'review', verdict: 'approve', score: 90, findings: [] };
    const api = makeFakeApi({
      triggerRun: { pr_id: 'p1', runs: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'A' }] },
    });
    api.listRuns = async () => runs[call++] ?? runs[runs.length - 1]!;
    api.listReviews = async () => [review];

    const clock = fakeClock();
    const result = await runAndWait(api, { prId: 'p1', agentId: 'a1' }, { deadlineAt: 100_000, pollMs: 3000, ...clock });
    expect(result).toEqual({ status: 'done', run_id: 'run1', review });
  });

  it('returns running + run_id past the deadline', async () => {
    const api = makeFakeApi({
      triggerRun: { pr_id: 'p1', runs: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'A' }] },
      runs: { p1: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'A', status: 'running', error: null, ran_at: null }] },
    });
    const clock = fakeClock(200_000); // already past deadlineAt
    const result = await runAndWait(api, { prId: 'p1', agentId: 'a1' }, { deadlineAt: 100_000, pollMs: 3000, ...clock });
    expect(result).toEqual({ status: 'running', run_id: 'run1' });
  });

  it('an expired deadline makes exactly one POST and zero polls', async () => {
    const api = makeFakeApi({
      triggerRun: { pr_id: 'p1', runs: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'A' }] },
    });
    const clock = fakeClock(200_000);
    await runAndWait(api, { prId: 'p1', agentId: 'a1' }, { deadlineAt: 100_000, pollMs: 3000, ...clock });
    const posts = api.calls.filter((c) => c.method === 'triggerReview');
    const polls = api.calls.filter((c) => c.method === 'listRuns');
    expect(posts).toHaveLength(1);
    expect(polls).toHaveLength(0);
  });

  it('surfaces a failed run with its error', async () => {
    const api = makeFakeApi({
      triggerRun: { pr_id: 'p1', runs: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'A' }] },
      runs: { p1: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'A', status: 'failed', error: 'boom', ran_at: null }] },
    });
    const clock = fakeClock();
    const result = await runAndWait(api, { prId: 'p1', agentId: 'a1' }, { deadlineAt: 100_000, pollMs: 3000, ...clock });
    expect(result).toEqual({ status: 'failed', run_id: 'run1', error: 'boom' });
  });

  it('surfaces a cancelled run', async () => {
    const api = makeFakeApi({
      triggerRun: { pr_id: 'p1', runs: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'A' }] },
      runs: { p1: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'A', status: 'cancelled', error: null, ran_at: null }] },
    });
    const clock = fakeClock();
    const result = await runAndWait(api, { prId: 'p1', agentId: 'a1' }, { deadlineAt: 100_000, pollMs: 3000, ...clock });
    expect(result.status).toBe('cancelled');
  });

  it('keeps polling on a null status or a run not yet listed', async () => {
    let call = 0;
    const sequences: RunSummary[][] = [
      [], // not listed yet
      [{ run_id: 'run1', agent_id: 'a1', agent_name: 'A', status: null, error: null, ran_at: null }],
      [{ run_id: 'run1', agent_id: 'a1', agent_name: 'A', status: 'done', error: null, ran_at: null }],
    ];
    const review: ReviewRecord = { id: 'rv1', run_id: 'run1', kind: 'review', verdict: 'approve', score: 90, findings: [] };
    const api = makeFakeApi({ triggerRun: { pr_id: 'p1', runs: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'A' }] } });
    api.listRuns = async () => sequences[call++]!;
    api.listReviews = async () => [review];

    const clock = fakeClock();
    const result = await runAndWait(api, { prId: 'p1', agentId: 'a1' }, { deadlineAt: 100_000, pollMs: 3000, ...clock });
    expect(result.status).toBe('done');
    expect(call).toBe(3);
  });

  it('a done run with no matching review throws ReviewMissing', async () => {
    const api = makeFakeApi({
      triggerRun: { pr_id: 'p1', runs: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'A' }] },
      runs: { p1: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'A', status: 'done', error: null, ran_at: null }] },
      reviews: { p1: [] },
    });
    const clock = fakeClock();
    await expect(runAndWait(api, { prId: 'p1', agentId: 'a1' }, { deadlineAt: 100_000, pollMs: 3000, ...clock })).rejects.toBeInstanceOf(
      ReviewMissing,
    );
  });

  it('no run started by the API throws RunNotStarted', async () => {
    const api = makeFakeApi({ triggerRun: { pr_id: 'p1', runs: [] } });
    const clock = fakeClock();
    await expect(runAndWait(api, { prId: 'p1', agentId: 'a1' }, { deadlineAt: 100_000, pollMs: 3000, ...clock })).rejects.toBeInstanceOf(
      RunNotStarted,
    );
  });
});
