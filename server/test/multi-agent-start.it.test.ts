import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { MultiAgentRunStarted } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import {
  agentRunsOfPr,
  countAll,
  intentCalls,
  multiRunsOfPr,
  newAgent,
  newRepoPr,
  p95,
  resetEnv,
  setupEnv,
  waitForRuns,
  type Env,
} from './helpers/multi-agent.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[multi-agent-start] Docker not available — skipping integration tests.');
}

/**
 * Multi-agent review (SPEC-05) — starting a multi-run: POST /pulls/:id/multi-agent-run.
 *
 * The model is a gated fixture (ScriptedLLM); what is under test is the request
 * contract, workspace scoping, what is created before the answer, and how the
 * shared executor behaves around failure. Review calls are counted by
 * `schemaName === 'Review'` only (server/INSIGHTS.md 2026-09-25).
 */
d('multi-agent start (Testcontainers pg)', () => {
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

  const start = (app: FastifyInstance, prId: string, agentIds: unknown, raw?: unknown) =>
    app.inject({
      method: 'POST',
      url: `/pulls/${prId}/multi-agent-run`,
      ...(raw !== undefined ? { payload: raw as object } : { payload: { agent_ids: agentIds } }),
    });

  const startOk = async (prId: string, agentIds: string[]) => {
    const res = await start(env.app, prId, agentIds);
    expect(res.statusCode).toBe(200);
    return res.json() as MultiAgentRunStarted;
  };

  it('AC-20: answers with the multi-run id and one running linked run per agent before any agent finishes; records the PR head SHA', async () => {
    release = env.llm.hold();
    const { pr } = await newRepoPr(env.db, env.workspaceA, { headSha: 'deadbeef1234' });
    const a1 = await newAgent(env.db, env.workspaceA, { name: 'Alpha' });
    const a2 = await newAgent(env.db, env.workspaceA, { name: 'Bravo' });

    const res = await start(env.app, pr.id, [a1.id, a2.id]);
    expect(res.statusCode).toBe(200);
    const body = res.json() as MultiAgentRunStarted;

    expect(typeof body.multi_agent_run_id).toBe('string');
    expect(body.multi_agent_run_id.length).toBeGreaterThan(0);
    expect(body.pr_id).toBe(pr.id);
    expect(body.runs).toHaveLength(2);
    expect(body.runs.map((r) => r.agent_id).sort()).toEqual([a1.id, a2.id].sort());
    expect(body.runs.find((r) => r.agent_id === a1.id)!.agent_name).toBe('Alpha');
    expect(body.runs.find((r) => r.agent_id === a2.id)!.agent_name).toBe('Bravo');

    // The model is still held: nothing can have finished, every run is `running` and linked.
    const rows = await agentRunsOfPr(env.db, pr.id);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id).sort()).toEqual(body.runs.map((r) => r.run_id).sort());
    expect(rows.every((r) => r.status === 'running')).toBe(true);
    expect(rows.every((r) => r.multiAgentRunId === body.multi_agent_run_id)).toBe(true);

    const multi = await multiRunsOfPr(env.db, pr.id);
    expect(multi).toHaveLength(1);
    expect(multi[0]!.id).toBe(body.multi_agent_run_id);
    expect(multi[0]!.workspaceId).toBe(env.workspaceA);
    expect(multi[0]!.headSha).toBe('deadbeef1234');

    release();
    release = undefined;
    await waitForRuns(env.db, body.runs.map((r) => r.run_id));
  });

  describe('request validation (AC-21, NFR-5)', () => {
    it('AC-21: an empty agent list answers 400 and creates nothing', async () => {
      const { pr } = await newRepoPr(env.db, env.workspaceA);
      const res = await start(env.app, pr.id, []);
      expect(res.statusCode).toBe(400);
      expect(await multiRunsOfPr(env.db, pr.id)).toHaveLength(0);
      expect(await agentRunsOfPr(env.db, pr.id)).toHaveLength(0);
    });

    it('AC-21: a missing or malformed agent_ids answers 400 and creates nothing', async () => {
      const { pr } = await newRepoPr(env.db, env.workspaceA);
      const agent = await newAgent(env.db, env.workspaceA);
      expect((await start(env.app, pr.id, undefined, {})).statusCode).toBe(400);
      expect((await start(env.app, pr.id, undefined, { agent_ids: agent.id })).statusCode).toBe(400);
      expect((await start(env.app, pr.id, undefined, { agent_ids: [''] })).statusCode).toBe(400);
      expect(await multiRunsOfPr(env.db, pr.id)).toHaveLength(0);
      expect(await agentRunsOfPr(env.db, pr.id)).toHaveLength(0);
    });

    it('AC-21 / NFR-5: 21 agent ids answer 400 (before any agent lookup) and create nothing', async () => {
      const { pr } = await newRepoPr(env.db, env.workspaceA);
      const before = await countAll(env.db, t.multiAgentRuns);
      const ids = Array.from({ length: 21 }, () => crypto.randomUUID());
      const res = await start(env.app, pr.id, ids);
      expect(res.statusCode).toBe(400);
      expect(await countAll(env.db, t.multiAgentRuns)).toBe(before);
      expect(await agentRunsOfPr(env.db, pr.id)).toHaveLength(0);
    });

    it('NFR-5: exactly 20 agents are accepted', async () => {
      release = env.llm.hold();
      const { pr } = await newRepoPr(env.db, env.workspaceA);
      const agents = await Promise.all(Array.from({ length: 20 }, () => newAgent(env.db, env.workspaceA)));
      const body = await startOk(pr.id, agents.map((a) => a.id));
      expect(body.runs).toHaveLength(20);
      expect(await agentRunsOfPr(env.db, pr.id)).toHaveLength(20);
      release();
      release = undefined;
      const settled = await waitForRuns(env.db, body.runs.map((r) => r.run_id), 60_000);
      expect(settled.every((r) => r?.status === 'done')).toBe(true);
    });
  });

  describe('lookups are workspace-scoped (AC-22, AC-23)', () => {
    it('AC-22: an unknown agent id answers 404 and creates no multi-run and no run — even next to a valid agent', async () => {
      const { pr } = await newRepoPr(env.db, env.workspaceA);
      const good = await newAgent(env.db, env.workspaceA);
      const before = await countAll(env.db, t.multiAgentRuns);
      const res = await start(env.app, pr.id, [good.id, crypto.randomUUID()]);
      expect(res.statusCode).toBe(404);
      expect(await countAll(env.db, t.multiAgentRuns)).toBe(before);
      expect(await agentRunsOfPr(env.db, pr.id)).toHaveLength(0);
    });

    it("AC-22: an agent of another workspace answers 404 and creates nothing", async () => {
      const { pr } = await newRepoPr(env.db, env.workspaceA);
      const foreign = await newAgent(env.db, env.workspaceB);
      const res = await start(env.app, pr.id, [foreign.id]);
      expect(res.statusCode).toBe(404);
      expect(await multiRunsOfPr(env.db, pr.id)).toHaveLength(0);
      expect(await agentRunsOfPr(env.db, pr.id)).toHaveLength(0);
    });

    it('AC-22: a malformed agent id also answers 404 and creates nothing', async () => {
      const { pr } = await newRepoPr(env.db, env.workspaceA);
      const res = await start(env.app, pr.id, ['not-a-uuid']);
      expect(res.statusCode).toBe(404);
      expect(await multiRunsOfPr(env.db, pr.id)).toHaveLength(0);
      expect(await agentRunsOfPr(env.db, pr.id)).toHaveLength(0);
    });

    it('AC-23: an unknown PR answers 404 and creates nothing', async () => {
      const agent = await newAgent(env.db, env.workspaceA);
      const before = [await countAll(env.db, t.multiAgentRuns), await countAll(env.db, t.agentRuns)];
      const res = await start(env.app, crypto.randomUUID(), [agent.id]);
      expect(res.statusCode).toBe(404);
      expect([await countAll(env.db, t.multiAgentRuns), await countAll(env.db, t.agentRuns)]).toEqual(before);
    });

    it('AC-23: a PR of another workspace answers 404 and creates nothing', async () => {
      const { pr: foreignPr } = await newRepoPr(env.db, env.workspaceB);
      const agent = await newAgent(env.db, env.workspaceA);
      const res = await start(env.app, foreignPr.id, [agent.id]);
      expect(res.statusCode).toBe(404);
      expect(await multiRunsOfPr(env.db, foreignPr.id)).toHaveLength(0);
      expect(await agentRunsOfPr(env.db, foreignPr.id)).toHaveLength(0);
    });
  });

  it('AC-24: a disabled agent is run like an enabled one and reaches `done`', async () => {
    const { pr } = await newRepoPr(env.db, env.workspaceA);
    const disabled = await newAgent(env.db, env.workspaceA, { enabled: false });
    const body = await startOk(pr.id, [disabled.id]);
    const [run] = await waitForRuns(env.db, body.runs.map((r) => r.run_id));
    expect(run!.status).toBe('done');
    expect(env.llm.reviewCalls).toBe(1);
  });

  it('AC-26: the PR diff is loaded once and the intent is resolved at most once for all agents of the multi-run', async () => {
    const { pr } = await newRepoPr(env.db, env.workspaceA);
    const agents = await Promise.all([1, 2, 3].map(() => newAgent(env.db, env.workspaceA)));
    const body = await startOk(pr.id, agents.map((a) => a.id));
    await waitForRuns(env.db, body.runs.map((r) => r.run_id));
    expect(env.git.diffCalls).toBe(1);
    expect(intentCalls(env)).toBeLessThanOrEqual(1);
    expect(env.llm.reviewCalls).toBe(3);
  });

  it('AC-27: one agent timing out is marked `failed` with its reason while the others finish `done`', async () => {
    const { pr } = await newRepoPr(env.db, env.workspaceA);
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => newAgent(env.db, env.workspaceA)));
    env.llm.failModels.set(b!.model, 'Request timed out');
    const body = await startOk(pr.id, [a!.id, b!.id, c!.id]);
    await waitForRuns(env.db, body.runs.map((r) => r.run_id), 60_000);

    const rows = await agentRunsOfPr(env.db, pr.id);
    const byAgent = new Map(rows.map((r) => [r.agentId, r]));
    expect(byAgent.get(b!.id)!.status).toBe('failed');
    expect(byAgent.get(b!.id)!.error).toContain('Request timed out');
    expect(byAgent.get(a!.id)!.status).toBe('done');
    expect(byAgent.get(c!.id)!.status).toBe('done');
  });

  it('AC-28: when the diff cannot be loaded every run ends `failed` with the same reason and no model is called', async () => {
    const { pr } = await newRepoPr(env.db, env.workspaceA, { withPatch: false });
    env.git.failWith = 'fatal: bad object deadbeef';
    const agents = await Promise.all([1, 2, 3].map(() => newAgent(env.db, env.workspaceA)));
    const body = await startOk(pr.id, agents.map((a) => a.id));
    await waitForRuns(env.db, body.runs.map((r) => r.run_id));

    const rows = await agentRunsOfPr(env.db, pr.id);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === 'failed')).toBe(true);
    const reasons = new Set(rows.map((r) => r.error));
    expect(reasons.size).toBe(1);
    const [reason] = [...reasons];
    expect(reason).toBeTruthy();
    expect(reason).toContain('fatal: bad object deadbeef');
    expect(env.llm.reviewCalls).toBe(0);
  });

  it('AC-29 (guard — holds at Base): POST /pulls/:id/review keeps its response and creates runs without a multi-run link', async () => {
    const { pr } = await newRepoPr(env.db, env.workspaceA);
    const agent = await newAgent(env.db, env.workspaceA);
    const res = await env.app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { pr_id: string; runs: { run_id: string; agent_id: string }[]; reviews: unknown[] };
    expect(Object.keys(body).sort()).toEqual(['pr_id', 'reviews', 'runs']);
    expect(body.pr_id).toBe(pr.id);
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0]!.agent_id).toBe(agent.id);
    await waitForRuns(env.db, body.runs.map((r) => r.run_id));

    const rows = await agentRunsOfPr(env.db, pr.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.multiAgentRunId).toBeNull();
    expect(await multiRunsOfPr(env.db, pr.id)).toHaveLength(0);
    // The harness identifies an agent's model call by its model name (AC-27 relies on it).
    expect(env.llm.reviewModels).toEqual([agent.model]);
  });

  it('AC-30: the 11th start within a minute answers 429 and creates nothing', async () => {
    const { pr } = await newRepoPr(env.db, env.workspaceA);
    const agent = await newAgent(env.db, env.workspaceA);
    const runIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      const res = await start(env.appDev, pr.id, [agent.id]);
      expect(res.statusCode, `request ${i + 1}`).toBe(200);
      runIds.push(...(res.json() as MultiAgentRunStarted).runs.map((r) => r.run_id));
    }
    const eleventh = await start(env.appDev, pr.id, [agent.id]);
    expect(eleventh.statusCode).toBe(429);
    expect(await multiRunsOfPr(env.db, pr.id)).toHaveLength(10);
    expect(await agentRunsOfPr(env.db, pr.id)).toHaveLength(10);
    await waitForRuns(env.db, runIds, 60_000);
  });

  it('NFR-2: N agents make exactly N Review calls; reading the run and the estimates add none', async () => {
    const { pr } = await newRepoPr(env.db, env.workspaceA);
    const agents = await Promise.all([1, 2, 3].map(() => newAgent(env.db, env.workspaceA)));
    const body = await startOk(pr.id, agents.map((a) => a.id));
    await waitForRuns(env.db, body.runs.map((r) => r.run_id));
    expect(env.llm.reviewCalls).toBe(3);

    const callsBefore = env.llm.calls.length + env.intentLlm.calls.length;
    const read = await env.app.inject({ method: 'GET', url: `/multi-agent-runs/${body.multi_agent_run_id}` });
    expect(read.statusCode).toBe(200);
    const estimates = await env.app.inject({ method: 'GET', url: '/run-estimates' });
    expect(estimates.statusCode).toBe(200);
    expect(env.llm.calls.length + env.intentLlm.calls.length).toBe(callsBefore);
    expect(env.llm.reviewCalls).toBe(3);
  });

  it('NFR-3: the start request answers within 500 ms at p95 (no agent work before the answer)', async () => {
    release = env.llm.hold();
    const { pr } = await newRepoPr(env.db, env.workspaceA);
    const agent = await newAgent(env.db, env.workspaceA);
    const samples: number[] = [];
    const runIds: string[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      const res = await start(env.app, pr.id, [agent.id]);
      samples.push(performance.now() - t0);
      expect(res.statusCode, `request ${i + 1}`).toBe(200);
      runIds.push(...(res.json() as MultiAgentRunStarted).runs.map((r) => r.run_id));
    }
    expect(p95(samples)).toBeLessThanOrEqual(500);
    release();
    release = undefined;
    await waitForRuns(env.db, runIds, 60_000);
  });
});
