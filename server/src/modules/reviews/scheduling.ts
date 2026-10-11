/**
 * Ring 1 (application). Schedules a set of agent runs through the shared
 * concurrency cap. Declares its own structural limiter/logger types so it never
 * imports `run-executor.ts` (that would be a cycle).
 */

/** The slice of `AgentRunLimiter` the scheduler needs. */
export type SlotLimiter = {
  run<T>(task: () => Promise<T>): Promise<T>;
  hasFreeSlot(): boolean;
};

/** Structured logger (pino-compatible). Callers log only ids, counts, statuses, durations. */
export type SchedulerLogger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

/** One agent run to schedule. */
export type ScheduledJob = { runId: string; agentId: string };

export type ScheduleDeps<J extends ScheduledJob = ScheduledJob> = {
  limiter: SlotLimiter;
  isCancelled: (runId: string) => boolean;
  /** Runs the job's model work; called only inside a granted slot. */
  run: (job: J) => Promise<void>;
  /** Called when the job found no free slot at enqueue time. */
  onWaiting: (job: J) => void;
  /** Called instead of `run` when the job was cancelled before it got a slot. */
  onSkipped: (job: J) => Promise<void> | void;
  logger?: SchedulerLogger;
  context: { prId: string; multiRunId?: string };
};

/**
 * Enqueue `jobs` in order; resolves when every job has settled. Errors are
 * isolated per job. A job cancelled before its slot is skipped, never run.
 */
export async function scheduleAgentRuns<J extends ScheduledJob>(jobs: J[], deps: ScheduleDeps<J>): Promise<void> {
  const { limiter, logger, context } = deps;
  const base = { prId: context.prId, ...(context.multiRunId ? { multiRunId: context.multiRunId } : {}) };

  const tasks = jobs.map((job) => {
    const ids = { ...base, runId: job.runId, agentId: job.agentId };
    if (!limiter.hasFreeSlot()) {
      try {
        deps.onWaiting(job);
      } catch {
        /* a failing waiting hook must not block the run */
      }
    }
    return limiter
      .run(async () => {
        if (deps.isCancelled(job.runId)) {
          logger?.info({ ...ids, status: 'cancelled' }, 'agent run skipped');
          await deps.onSkipped(job);
          return;
        }
        const startedAt = Date.now();
        logger?.info({ ...ids, status: 'running' }, 'agent run started');
        try {
          await deps.run(job);
          logger?.info({ ...ids, status: 'done', durationMs: Date.now() - startedAt }, 'agent run finished');
        } catch {
          logger?.error({ ...ids, status: 'failed', durationMs: Date.now() - startedAt }, 'agent run failed');
        }
      })
      .catch(() => {
        logger?.error({ ...ids, status: 'failed' }, 'agent run could not be scheduled');
      });
  });

  await Promise.all(tasks);
}
