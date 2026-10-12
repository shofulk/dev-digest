import { describe, it, expect } from 'vitest';
import { AgentRunLimiter } from '../src/platform/run-limiter.js';
import {
  scheduleAgentRuns,
  type ScheduledJob,
  type SchedulerLogger,
} from '../src/modules/reviews/scheduling.js';
import { loadConfig } from '../src/platform/config.js';

/**
 * Multi-agent review (SPEC-05) — the concurrency cap and the scheduler.
 * Hermetic: gated promises stand in for model calls; nothing touches a DB.
 */

/** Let queued microtasks / timers of the limiter run. */
const tick = (ms = 25) => new Promise<void>((r) => setTimeout(r, ms));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('AgentRunLimiter (AC-25, NFR-1)', () => {
  it('AC-25: with cap 2 and 5 tasks at most 2 run at once, and the 3rd starts only after one ends', async () => {
    const limiter = new AgentRunLimiter(2);
    const gates = Array.from({ length: 5 }, () => deferred());
    let active = 0;
    let maxActive = 0;
    const started: number[] = [];
    const finished: number[] = [];

    const results = gates.map((gate, i) =>
      limiter.run(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        started.push(i);
        await gate.promise;
        active -= 1;
        finished.push(i);
        return i * 10;
      }),
    );

    await tick();
    expect(started).toEqual([0, 1]);
    expect(limiter.hasFreeSlot()).toBe(false);

    gates[0]!.resolve();
    await tick();
    expect(started).toEqual([0, 1, 2]);
    expect(finished).toEqual([0]);

    gates[1]!.resolve();
    gates[2]!.resolve();
    await tick();
    expect(started).toEqual([0, 1, 2, 3, 4]);

    gates[3]!.resolve();
    gates[4]!.resolve();
    expect(await Promise.all(results)).toEqual([0, 10, 20, 30, 40]);
    expect(maxActive).toBe(2);
    expect(limiter.hasFreeSlot()).toBe(true);
  });

  it('AC-25: a rejected task frees its slot for the next waiting task', async () => {
    const limiter = new AgentRunLimiter(1);
    const gate = deferred();
    const first = limiter.run(async () => {
      await gate.promise;
      throw new Error('boom');
    });
    const second = limiter.run(async () => 'second ran');
    const firstSettled = first.catch((e: Error) => e.message);
    await tick();
    gate.resolve();
    expect(await firstSettled).toBe('boom');
    expect(await second).toBe('second ran');
  });

  it('NFR-1: with cap 1 tasks run strictly one after another', async () => {
    const limiter = new AgentRunLimiter(1);
    expect(limiter.concurrency).toBe(1);
    const events: string[] = [];
    const gates = [deferred(), deferred(), deferred()];
    const results = gates.map((gate, i) =>
      limiter.run(async () => {
        events.push(`start-${i}`);
        await gate.promise;
        events.push(`end-${i}`);
      }),
    );

    await tick();
    expect(events).toEqual(['start-0']);
    for (const gate of gates) {
      gate.resolve();
      await tick();
    }
    await Promise.all(results);
    expect(events).toEqual(['start-0', 'end-0', 'start-1', 'end-1', 'start-2', 'end-2']);
  });
});

type Job = ScheduledJob & { label: string };
const job = (n: number): Job => ({ runId: `run-${n}`, agentId: `agent-${n}`, label: `job-${n}` });

/** Scheduler deps with every callback recorded; `run` is gated per job. */
function harness(cap: number, opts: { logger?: SchedulerLogger } = {}) {
  const limiter = new AgentRunLimiter(cap);
  const gates = new Map<string, ReturnType<typeof deferred>>();
  const cancelled = new Set<string>();
  const ran: string[] = [];
  const waiting: string[] = [];
  const skipped: string[] = [];
  const gateFor = (runId: string) => {
    if (!gates.has(runId)) gates.set(runId, deferred());
    return gates.get(runId)!;
  };
  const deps = {
    limiter,
    isCancelled: (runId: string) => cancelled.has(runId),
    run: async (j: Job) => {
      ran.push(j.runId);
      await gateFor(j.runId).promise;
    },
    onWaiting: (j: Job) => {
      waiting.push(j.runId);
    },
    onSkipped: async (j: Job) => {
      skipped.push(j.runId);
    },
    ...(opts.logger ? { logger: opts.logger } : {}),
    context: { prId: 'pr-1', multiRunId: 'multi-1' },
  };
  return { deps, gateFor, cancelled, ran, waiting, skipped };
}

describe('scheduleAgentRuns (AC-25, AC-44, A-3, D3)', () => {
  it('A-3: with cap 2 and 3 jobs only the third is told it is waiting, and it runs when a slot frees', async () => {
    const h = harness(2);
    const settled = scheduleAgentRuns([job(1), job(2), job(3)], h.deps);

    await tick();
    expect(h.ran).toEqual(['run-1', 'run-2']);
    expect(h.waiting).toEqual(['run-3']);

    h.gateFor('run-1').resolve();
    await tick();
    expect(h.ran).toEqual(['run-1', 'run-2', 'run-3']);

    h.gateFor('run-2').resolve();
    h.gateFor('run-3').resolve();
    await settled;
    expect(h.waiting).toEqual(['run-3']);
    expect(h.skipped).toEqual([]);
  });

  it('A-3: when every job gets a slot at once nobody is told to wait', async () => {
    const h = harness(3);
    const settled = scheduleAgentRuns([job(1), job(2), job(3)], h.deps);
    await tick();
    expect(h.waiting).toEqual([]);
    for (const n of [1, 2, 3]) h.gateFor(`run-${n}`).resolve();
    await settled;
    expect(h.ran).toEqual(['run-1', 'run-2', 'run-3']);
  });

  it('AC-44: a job cancelled while waiting is skipped and its run callback is never called', async () => {
    const h = harness(2);
    const settled = scheduleAgentRuns([job(1), job(2), job(3)], h.deps);
    await tick();
    expect(h.waiting).toEqual(['run-3']);

    h.cancelled.add('run-3');
    h.gateFor('run-1').resolve();
    await tick();
    h.gateFor('run-2').resolve();
    await settled;

    expect(h.skipped).toEqual(['run-3']);
    expect(h.ran).toEqual(['run-1', 'run-2']);
    expect(h.ran).not.toContain('run-3');
  });

  it('AC-44: a job already cancelled before scheduling is skipped without ever running', async () => {
    const h = harness(1);
    h.cancelled.add('run-1');
    h.gateFor('run-2').resolve();
    await scheduleAgentRuns([job(1), job(2)], h.deps);
    expect(h.skipped).toEqual(['run-1']);
    expect(h.ran).toEqual(['run-2']);
  });

  it('AC-27 (scheduler half): a job that throws does not stop the others, and the schedule still settles', async () => {
    const h = harness(1);
    const failing = {
      ...h.deps,
      run: async (j: Job) => {
        h.ran.push(j.runId);
        if (j.runId === 'run-1') throw new Error('provider exploded');
      },
    };
    await expect(scheduleAgentRuns([job(1), job(2), job(3)], failing)).resolves.toBeUndefined();
    expect(h.ran).toEqual(['run-1', 'run-2', 'run-3']);
  });
});

describe('scheduler logging (NFR-6, D13)', () => {
  const ALLOWED_KEYS = new Set(['runId', 'agentId', 'prId', 'multiRunId', 'status', 'durationMs', 'findings', 'count']);
  const MARKERS = [
    'MARKER_FINDING_TITLE_8f3a',
    'MARKER_DIFF_LINE_c41d',
    'MARKER_PROMPT_TEXT_92be',
    'MARKER_AGENT_NAME_77aa',
    'MARKER_ERROR_TEXT_1d0c',
  ];

  it('NFR-6: log lines carry only ids, counts, statuses and durations — no finding, diff, prompt or error text', async () => {
    const logs: { level: string; obj: unknown; msg?: string }[] = [];
    const capture =
      (level: string) =>
      (obj: unknown, msg?: string): void => {
        logs.push({ level, obj, ...(msg !== undefined ? { msg } : {}) });
      };
    const logger: SchedulerLogger = { info: capture('info'), warn: capture('warn'), error: capture('error') };

    const h = harness(2, { logger });
    // The fixture text rides on the jobs (as agent/prompt data would in the executor).
    const rich = (n: number) => ({
      ...job(n),
      agentName: MARKERS[3],
      title: MARKERS[0],
      diff: MARKERS[1],
      prompt: MARKERS[2],
    });
    const deps = {
      ...h.deps,
      run: async (j: Job) => {
        h.ran.push(j.runId);
        if (j.runId === 'run-2') throw new Error(`${MARKERS[4]} while reviewing ${MARKERS[0]}`);
      },
    };
    await scheduleAgentRuns([rich(1), rich(2), rich(3)], deps);

    expect(logs.length).toBeGreaterThan(0);
    for (const entry of logs) {
      const text = JSON.stringify(entry);
      for (const marker of MARKERS) expect(text).not.toContain(marker);
      if (entry.obj && typeof entry.obj === 'object') {
        for (const key of Object.keys(entry.obj as Record<string, unknown>)) {
          expect(ALLOWED_KEYS.has(key), `unexpected log key "${key}"`).toBe(true);
        }
      }
    }
  });
});

describe('scheduler logging of rejected jobs (D18, NFR-6)', () => {
  const D13_KEYS = new Set(['runId', 'agentId', 'prId', 'multiRunId', 'status', 'durationMs', 'findings', 'count']);

  function capturing() {
    const logs: { level: 'info' | 'warn' | 'error'; obj: Record<string, unknown>; msg?: string }[] = [];
    const at =
      (level: 'info' | 'warn' | 'error') =>
      (obj: unknown, msg?: string): void => {
        logs.push({ level, obj: obj as Record<string, unknown>, ...(msg !== undefined ? { msg } : {}) });
      };
    const logger: SchedulerLogger = { info: at('info'), warn: at('warn'), error: at('error') };
    return { logs, logger };
  }

  it('D18: a job whose run rejects while it is cancelled logs info status cancelled once, and never error', async () => {
    const { logs, logger } = capturing();
    const h = harness(1, { logger });
    const deps = {
      ...h.deps,
      run: async (j: Job) => {
        h.ran.push(j.runId);
        h.cancelled.add(j.runId); // cancelled mid-flight: the model call then rejects
        throw new Error('aborted by cancel');
      },
    };
    await scheduleAgentRuns([job(1)], deps);

    expect(h.ran).toEqual(['run-1']);
    expect(logs.filter((l) => l.level === 'error')).toEqual([]);
    const cancelled = logs.filter((l) => l.level === 'info' && l.obj.status === 'cancelled' && l.obj.runId === 'run-1');
    expect(cancelled).toHaveLength(1);
    for (const l of logs) for (const key of Object.keys(l.obj)) expect(D13_KEYS.has(key), `unexpected log key "${key}"`).toBe(true);
  });

  it('D18 (guard): a rejecting job that is not cancelled still logs error with status failed', async () => {
    const { logs, logger } = capturing();
    const h = harness(1, { logger });
    const deps = {
      ...h.deps,
      run: async (j: Job) => {
        h.ran.push(j.runId);
        throw new Error('provider exploded');
      },
    };
    await scheduleAgentRuns([job(1)], deps);

    const errors = logs.filter((l) => l.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.obj).toMatchObject({ status: 'failed', runId: 'run-1' });
    for (const l of logs) for (const key of Object.keys(l.obj)) expect(D13_KEYS.has(key), `unexpected log key "${key}"`).toBe(true);
  });
});

describe('REVIEW_AGENT_CONCURRENCY (NFR-1, A-1) — guards: this behaviour already holds', () => {
  it('NFR-1: the default cap is 3', () => {
    expect(loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv).reviewAgentConcurrency).toBe(3);
  });

  it('NFR-1: a blank value falls back to 3 and 1 is accepted (one after another)', () => {
    expect(
      loadConfig({ NODE_ENV: 'test', REVIEW_AGENT_CONCURRENCY: '' } as NodeJS.ProcessEnv).reviewAgentConcurrency,
    ).toBe(3);
    expect(
      loadConfig({ NODE_ENV: 'test', REVIEW_AGENT_CONCURRENCY: '1' } as NodeJS.ProcessEnv).reviewAgentConcurrency,
    ).toBe(1);
  });

  it('NFR-1: a cap below 1 is rejected', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', REVIEW_AGENT_CONCURRENCY: '0' } as NodeJS.ProcessEnv)).toThrow();
    expect(() => loadConfig({ NODE_ENV: 'test', REVIEW_AGENT_CONCURRENCY: '-2' } as NodeJS.ProcessEnv)).toThrow();
  });
});
