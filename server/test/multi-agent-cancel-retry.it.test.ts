import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { MultiAgentCancelResult, MultiAgentRetryResult, MultiAgentRun, MultiAgentRunStarted } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import {
  agentRunsOfPr,
  newAgent,
  newRepoPr,
  resetEnv,
  seedMultiRun,
  setupEnv,
  waitForRun,
  type Env,
} from './helpers/multi-agent.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[multi-agent-cancel-retry] Docker not available — skipping integration tests.');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll `fn` until it is truthy (bounded: a hang fails the test, not the suite). */
async function until(fn: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await sleep(25);
  }
  return false;
}

/**
 * Multi-agent review (SPEC-03) — cancelling a multi-run and retrying one agent:
 * POST /multi-agent-runs/:id/cancel and /agents/:agentId/retry.
 *
 * Cancel/retry bookkeeping is seeded straight into the DB; the AC-43 case holds a
 * real model call on the ScriptedLLM gate so the cancel lands mid-call.
 */
d('multi-agent cancel and retry (Testcontainers pg)', () => {
  let pg: PgFixture;
  let env: Env;
  let release: (() => void) | undefined;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    env = await setupEnv(pg);
  });
  afterAll(async () => {
    await env?.close();
    await pg?.stop();
  });
  beforeEach(() => resetEnv(env));
  afterEach(() => {
    release?.();
    release = undefined;
  });

  const statusOf = async (runId: string) => {
    const [row] = await env.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    return row!.status;
  };

  describe('cancel', () => {
    it('AC-42: cancels every running agent run of the multi-run, leaves a done run alone, and lists the cancelled ids', async () => {
      const { pr } = await newRepoPr(env.db, env.workspaceA);
      const [a, b, c, outsider] = await Promise.all([1, 2, 3, 4].map((n) => newAgent(env.db, env.workspaceA, { name: `Agent ${n}` })));
      const seeded = await seedMultiRun(env.db, {
        workspaceId: env.workspaceA,
        prId: pr.id,
        runs: [
          { agentId: a!.id, status: 'running', withReview: false },
          { agentId: b!.id, status: 'running', withReview: false },
          { agentId: c!.id, status: 'done' },
          // A running run of the same PR that is NOT part of this multi-run.
          { agentId: outsider!.id, status: 'running', withReview: false, linked: false },
        ],
      });
      const [runA, runB, runC, runOutsider] = seeded.runs;

      const res = await env.app.inject({ method: 'POST', url: `/multi-agent-runs/${seeded.multiRunId}/cancel` });
      expect(res.statusCode).toBe(200);
      const body = res.json() as MultiAgentCancelResult;
      expect(body.ok).toBe(true);
      expect([...body.run_ids].sort()).toEqual([runA!.runId, runB!.runId].sort());

      expect(await statusOf(runA!.runId)).toBe('cancelled');
      expect(await statusOf(runB!.runId)).toBe('cancelled');
      expect(await statusOf(runC!.runId)).toBe('done');
      expect(await statusOf(runOutsider!.runId)).toBe('running');

      const read = await env.app.inject({ method: 'GET', url: `/multi-agent-runs/${seeded.multiRunId}` });
      expect(read.statusCode).toBe(200);
      const statuses = (read.json() as MultiAgentRun).columns.map((col) => col.status).sort();
      expect(statuses).toEqual(['cancelled', 'cancelled', 'done']);
    });

    it('AC-42: a multi-run of another workspace (or an unknown id) answers 404 and cancels nothing', async () => {
      const { pr } = await newRepoPr(env.db, env.workspaceA);
      const agent = await newAgent(env.db, env.workspaceA);
      const seeded = await seedMultiRun(env.db, {
        workspaceId: env.workspaceA,
        prId: pr.id,
        runs: [{ agentId: agent.id, status: 'running', withReview: false }],
      });
      const foreign = await env.appB.inject({ method: 'POST', url: `/multi-agent-runs/${seeded.multiRunId}/cancel` });
      expect(foreign.statusCode).toBe(404);
      expect(await statusOf(seeded.runs[0]!.runId)).toBe('running');

      const unknown = await env.app.inject({ method: 'POST', url: `/multi-agent-runs/${crypto.randomUUID()}/cancel` });
      expect(unknown.statusCode).toBe(404);
    });

    it('AC-43: a run that finishes after it was cancelled keeps the status `cancelled`', async () => {
      release = env.llm.hold();
      const { pr } = await newRepoPr(env.db, env.workspaceA);
      const agent = await newAgent(env.db, env.workspaceA);
      const startRes = await env.app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/multi-agent-run`,
        payload: { agent_ids: [agent.id] },
      });
      expect(startRes.statusCode).toBe(200);
      const started = startRes.json() as MultiAgentRunStarted;
      const runId = started.runs[0]!.run_id;

      // The model call is in flight (held on the gate) when the cancel arrives.
      expect(await until(() => env.llm.reviewCalls >= 1)).toBe(true);
      const cancelRes = await env.app.inject({ method: 'POST', url: `/multi-agent-runs/${started.multi_agent_run_id}/cancel` });
      expect(cancelRes.statusCode).toBe(200);
      expect((cancelRes.json() as MultiAgentCancelResult).run_ids).toEqual([runId]);
      expect(await statusOf(runId)).toBe('cancelled');

      // Let the model answer, then let the executor finish its bookkeeping.
      release();
      release = undefined;
      expect(await until(() => env.llm.finishedReviewCalls >= 1)).toBe(true);
      const run = await waitForRun(env.db, runId);
      expect(run!.status).toBe('cancelled');
      for (let i = 0; i < 8; i++) {
        await sleep(50);
        expect(await statusOf(runId)).toBe('cancelled');
      }
    });
  });

  describe('retry', () => {
    const retry = (multiRunId: string, agentId: string, app = env.app) =>
      app.inject({ method: 'POST', url: `/multi-agent-runs/${multiRunId}/agents/${agentId}/retry` });

    it('AC-45: retrying a failed agent creates a new running run linked to the same multi-run; the column switches to it', async () => {
      const { pr } = await newRepoPr(env.db, env.workspaceA);
      const failed = await newAgent(env.db, env.workspaceA, { name: 'Alpha' });
      const fine = await newAgent(env.db, env.workspaceA, { name: 'Bravo' });
      const seeded = await seedMultiRun(env.db, {
        workspaceId: env.workspaceA,
        prId: pr.id,
        runs: [
          { agentId: failed.id, status: 'failed', error: 'boom', withReview: false, ranAt: new Date(Date.now() - 120_000) },
          { agentId: fine.id, status: 'done' },
        ],
      });
      const oldRunId = seeded.runs[0]!.runId;

      const res = await retry(seeded.multiRunId, failed.id);
      expect(res.statusCode).toBe(200);
      const { run_id: newRunId } = res.json() as MultiAgentRetryResult;
      expect(newRunId).toBeTruthy();
      expect(newRunId).not.toBe(oldRunId);

      const [created] = await env.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, newRunId));
      expect(created!.multiAgentRunId).toBe(seeded.multiRunId);
      expect(created!.agentId).toBe(failed.id);
      expect(created!.prId).toBe(pr.id);

      const settled = await waitForRun(env.db, newRunId);
      expect(settled!.status).toBe('done');
      expect(env.llm.reviewCalls).toBe(1); // only the retried agent called the model
      expect((await agentRunsOfPr(env.db, pr.id)).filter((r) => r.agentId === failed.id)).toHaveLength(2);

      const read = await env.app.inject({ method: 'GET', url: `/multi-agent-runs/${seeded.multiRunId}` });
      expect(read.statusCode).toBe(200);
      const column = (read.json() as MultiAgentRun).columns.find((col) => col.agent_id === failed.id)!;
      expect(column.run_id).toBe(newRunId);
      expect(column.status).toBe('done');
      expect(column.error).toBeNull();
    });

    it('AC-46: retrying while the newest run of that agent is running answers 409 and creates no run', async () => {
      const { pr } = await newRepoPr(env.db, env.workspaceA);
      const agent = await newAgent(env.db, env.workspaceA);
      const seeded = await seedMultiRun(env.db, {
        workspaceId: env.workspaceA,
        prId: pr.id,
        runs: [
          { agentId: agent.id, status: 'done', ranAt: new Date(Date.now() - 300_000) },
          { agentId: agent.id, status: 'running', withReview: false, ranAt: new Date(Date.now() - 5_000) },
        ],
      });
      const before = (await agentRunsOfPr(env.db, pr.id)).length;
      expect(before).toBe(2);

      const res = await retry(seeded.multiRunId, agent.id);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('agent_running');
      expect(await agentRunsOfPr(env.db, pr.id)).toHaveLength(before);
      expect(env.llm.reviewCalls).toBe(0);
    });

    it('AC-45: another workspace, an unknown multi-run, or an agent that has no run in the multi-run answers 404 and creates no run', async () => {
      const { pr } = await newRepoPr(env.db, env.workspaceA);
      const inRun = await newAgent(env.db, env.workspaceA);
      const notInRun = await newAgent(env.db, env.workspaceA);
      const seeded = await seedMultiRun(env.db, {
        workspaceId: env.workspaceA,
        prId: pr.id,
        runs: [{ agentId: inRun.id, status: 'failed', error: 'boom', withReview: false }],
      });
      expect((await retry(seeded.multiRunId, inRun.id, env.appB)).statusCode).toBe(404);
      expect((await retry(crypto.randomUUID(), inRun.id)).statusCode).toBe(404);
      expect((await retry(seeded.multiRunId, notInRun.id)).statusCode).toBe(404);
      expect(await agentRunsOfPr(env.db, pr.id)).toHaveLength(1);
      expect(env.llm.reviewCalls).toBe(0);
    });
  });
});
