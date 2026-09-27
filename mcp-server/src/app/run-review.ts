// Ring 1 — application. Triggers a review run and polls it to completion or a deadline
// (C6). `sleep` and `now` are injected so tests never sleep for real.
import { reviewForRun } from '../domain/findings.js';
import { isTransient, ReviewMissing, RunNotStarted } from '../domain/errors.js';
import type { ReviewRecord } from '../domain/contracts.js';
import type { DevDigestApi } from '../domain/ports.js';

export type RunAndWaitResult =
  | { status: 'done'; run_id: string; review: ReviewRecord }
  | { status: 'running'; run_id: string }
  | { status: 'failed' | 'cancelled'; run_id: string; error: string | null };

export interface RunAndWaitTarget {
  prId: string;
  agentId: string;
}

export interface RunAndWaitOptions {
  deadlineAt: number;
  pollMs: number;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const TERMINAL = new Set(['done', 'failed', 'cancelled']);

export async function runAndWait(api: DevDigestApi, target: RunAndWaitTarget, options: RunAndWaitOptions): Promise<RunAndWaitResult> {
  const triggered = await api.triggerReview(target.prId, target.agentId);
  const runId = triggered.runs[0]?.run_id;
  if (!runId) throw new RunNotStarted();

  for (;;) {
    if (options.now() >= options.deadlineAt) {
      return { status: 'running', run_id: runId };
    }

    let runs;
    try {
      runs = await api.listRuns(target.prId);
    } catch (err) {
      if (isTransient(err)) {
        await options.sleep(options.pollMs);
        continue;
      }
      throw err;
    }

    const run = runs.find((r) => r.run_id === runId);
    const status = run?.status;

    if (status && TERMINAL.has(status)) {
      if (status === 'done') {
        const reviews = await api.listReviews(target.prId);
        const review = reviewForRun(reviews, runId);
        if (!review) throw new ReviewMissing(runId);
        return { status: 'done', run_id: runId, review };
      }
      return { status: status as 'failed' | 'cancelled', run_id: runId, error: run?.error ?? null };
    }

    // null/unknown status, or the run not listed yet — keep polling.
    await options.sleep(options.pollMs);
  }
}
