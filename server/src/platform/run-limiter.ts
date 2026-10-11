import PQueue from 'p-queue';

/**
 * AgentRunLimiter — the single cap on agent runs executing at the same time,
 * across all PRs (one per Container). Wraps a p-queue with
 * `concurrency = reviewAgentConcurrency`.
 *
 * Ring 2 (infra half of platform/), like `jobs.ts`.
 */
export class AgentRunLimiter {
  private readonly queue: PQueue;
  /** Tasks submitted and not yet settled (running + waiting), counted synchronously. */
  private inflight = 0;

  constructor(readonly concurrency: number) {
    this.queue = new PQueue({ concurrency });
  }

  /** Run `task` once a slot is free; resolves with the task's result. */
  run<T>(task: () => Promise<T>): Promise<T> {
    this.inflight += 1;
    const settled = this.queue.add(task) as Promise<T>;
    const release = (): void => {
      this.inflight -= 1;
    };
    settled.then(release, release);
    return settled;
  }

  /**
   * True when a task submitted now would start immediately. Counts tasks
   * submitted earlier in the same tick, which p-queue has not started yet.
   */
  hasFreeSlot(): boolean {
    return this.inflight < this.concurrency;
  }
}
