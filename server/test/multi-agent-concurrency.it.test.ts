import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import type { MultiAgentRetryResult, MultiAgentRunStarted } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import {
  agentRunsOfPr,
  newAgent,
  newRepoPr,
  resetEnv,
  seedMultiRun,
  setupEnv,
  waitForRuns,
  type Env,
} from './helpers/multi-agent.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[multi-agent-concurrency] Docker not available — skipping integration tests.');
}

/**
 * Multi-agent review (SPEC-05, fix round 3) — concurrency and the shared event stream:
 *  - D15  concurrent retries of one agent create exactly one run;
 *  - D16  concurrent Learn clicks on one finding store exactly one memory row;
 *  - D18  a malformed `memory.sources` row does not break the reviews read;
 *  - D14  retry is rate-limited (10 per minute, its own counter);
 *  - D17  GET /multi-agent-runs/:id/events?run_ids= is one SSE stream for several runs.
 *
 * One app set per file, built in `beforeAll` before any run exists (`buildApp` reaps every
 * `running` row on boot). Retried runs are held on the `ScriptedLLM` gate so the concurrent
 * requests meet a `running` row.
 */
d('multi-agent concurrency and shared stream (Testcontainers pg)', () => {
  let pg: PgFixture;
  let env: Env;
  let release: (() => void) | undefined;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    env = await setupEnv(pg);
  });
  afterAll(async () => {
    release?.();
    await env?.close();
    await pg?.stop();
  });
  beforeEach(() => resetEnv(env));
  afterEach(() => {
    release?.();
    release = undefined;
  });

  /** All agent_runs of one agent inside one multi-run. */
  const runsOf = async (multiRunId: string, agentId: string) =>
    env.db
      .select()
      .from(t.agentRuns)
      .where(and(eq(t.agentRuns.multiAgentRunId, multiRunId), eq(t.agentRuns.agentId, agentId)));

  /** Release the gate and let every run of the multi-run reach a terminal state. */
  const settle = async (multiRunId: string) => {
    release?.();
    release = undefined;
    const rows = await env.db.select().from(t.agentRuns).where(eq(t.agentRuns.multiAgentRunId, multiRunId));
    await waitForRuns(
      env.db,
      rows.filter((r) => r.status === 'running' || r.model !== 'seeded-model').map((r) => r.id),
    );
  };

  describe('D15 / D16 / D18 — concurrent writes', () => {
    it('D15: 5 concurrent retries of one failed agent -> exactly one 200, four 409 agent_running, one new run', async () => {
      const { pr } = await newRepoPr(env.db, env.workspaceA);
      const agent = await newAgent(env.db, env.workspaceA);
      const seeded = await seedMultiRun(env.db, {
        workspaceId: env.workspaceA,
        prId: pr.id,
        runs: [{ agentId: agent.id, status: 'failed', error: 'boom', withReview: false, ranAt: new Date(Date.now() - 120_000) }],
      });
      expect(await runsOf(seeded.multiRunId, agent.id)).toHaveLength(1);
      release = env.llm.hold();

      // R20: make the interleave deterministic. A BEFORE INSERT trigger holds every new
      // `running` run of this multi-run for 300 ms, so each request has read the (still
      // `failed`) newest run before the first insert commits, unless the retry is serialized
      // by a lock taken before that read.
      const fn = `slow_retry_insert_${seeded.multiRunId.replaceAll('-', '')}`;
      await env.db.execute(
        sql.raw(`create function ${fn}() returns trigger language plpgsql as $$
          begin
            if new.multi_agent_run_id = '${seeded.multiRunId}' and new.status = 'running' then perform pg_sleep(0.3); end if;
            return new;
          end $$`),
      );
      await env.db.execute(sql.raw(`create trigger ${fn} before insert on agent_runs for each row execute function ${fn}()`));
      let responses: Awaited<ReturnType<typeof env.app.inject>>[];
      try {
        responses = await Promise.all(
          Array.from({ length: 5 }, () =>
            env.app.inject({ method: 'POST', url: `/multi-agent-runs/${seeded.multiRunId}/agents/${agent.id}/retry` }),
          ),
        );
      } finally {
        await env.db.execute(sql.raw(`drop trigger if exists ${fn} on agent_runs`));
        await env.db.execute(sql.raw(`drop function if exists ${fn}()`));
      }
      const codes = responses.map((r) => r.statusCode).sort();
      const afterRuns = await runsOf(seeded.multiRunId, agent.id);
      try {
        expect(codes).toEqual([200, 409, 409, 409, 409]);
        for (const r of responses.filter((x) => x.statusCode === 409)) {
          expect(r.json().error.code).toBe('agent_running');
        }
        expect(afterRuns).toHaveLength(2);
        const ok = responses.find((x) => x.statusCode === 200)!;
        expect(afterRuns.map((r) => r.id)).toContain((ok.json() as MultiAgentRetryResult).run_id);
      } finally {
        await settle(seeded.multiRunId);
      }
    });

    it('D16: 5 concurrent Learn clicks on one finding -> exactly one 201, four 200 with the same id, one memory row', async () => {
      const { pr } = await newRepoPr(env.db, env.workspaceA);
      const agent = await newAgent(env.db, env.workspaceA);
      const seeded = await seedMultiRun(env.db, {
        workspaceId: env.workspaceA,
        prId: pr.id,
        runs: [{ agentId: agent.id, status: 'done', findings: [{ start: 11, title: 'Learn me' }] }],
      });
      const findingId = seeded.runs[0]!.findingIds[0]!;

      // Same R20 technique as D15: plain concurrent injects serialise on their own, so a BEFORE
      // INSERT trigger holds every new `learning` row of this finding for 300 ms. Each request
      // then reads "no row yet" before the first insert commits, unless a lock taken before
      // that read serialises them.
      const fn = `slow_learn_insert_${findingId.replaceAll('-', '')}`;
      await env.db.execute(
        sql.raw(`create function ${fn}() returns trigger language plpgsql as $$
          begin
            if new.kind = 'learning' and new.sources @> '[{"context":"finding:${findingId}"}]'::jsonb then perform pg_sleep(0.3); end if;
            return new;
          end $$`),
      );
      await env.db.execute(sql.raw(`create trigger ${fn} before insert on memory for each row execute function ${fn}()`));
      let responses: Awaited<ReturnType<typeof env.app.inject>>[];
      try {
        responses = await Promise.all(
          Array.from({ length: 5 }, () => env.app.inject({ method: 'POST', url: `/findings/${findingId}/learn` })),
        );
      } finally {
        await env.db.execute(sql.raw(`drop trigger if exists ${fn} on memory`));
        await env.db.execute(sql.raw(`drop function if exists ${fn}()`));
      }
      expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 200, 200, 200, 201]);
      const ids = new Set(responses.map((r) => (r.json() as { id: string }).id));
      expect(ids.size).toBe(1);

      const rows = await env.db
        .select({ id: t.memory.id })
        .from(t.memory)
        .where(
          and(
            eq(t.memory.workspaceId, env.workspaceA),
            eq(t.memory.kind, 'learning'),
            sql`${t.memory.sources} @> ${JSON.stringify([{ context: `finding:${findingId}` }])}::jsonb`,
          ),
        );
      expect(rows).toHaveLength(1);
    });

    it('D18: a learning row with null / string / non-string-context sources does not break GET /pulls/:id/reviews', async () => {
      const { repo, pr } = await newRepoPr(env.db, env.workspaceA);
      const agent = await newAgent(env.db, env.workspaceA);
      const seeded = await seedMultiRun(env.db, {
        workspaceId: env.workspaceA,
        prId: pr.id,
        runs: [{ agentId: agent.id, status: 'done', findings: [{ start: 11, title: 'Learned one' }] }],
      });
      const findingId = seeded.runs[0]!.findingIds[0]!;
      await env.db.insert(t.memory).values({
        workspaceId: env.workspaceA,
        repoId: repo.id,
        scope: 'repo',
        kind: 'learning',
        content: 'row with a malformed sources array',
        sources: [null, 'x', { context: 5 }, { context: `finding:${findingId}` }],
      });

      const res = await env.app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` });
      expect(res.statusCode).toBe(200);
      const reviews = res.json() as { findings: { id: string; learned?: boolean }[] }[];
      const found = reviews.flatMap((r) => r.findings).find((f) => f.id === findingId);
      expect(found).toBeDefined();
      expect(found!.learned).toBe(true);
    });
  });

  describe('D14 — retry rate limit', () => {
    it('D14: the 11th retry within a minute answers 429 and creates no agent run', async () => {
      const { pr } = await newRepoPr(env.db, env.workspaceA);
      const agent = await newAgent(env.db, env.workspaceA);
      const seeded = await seedMultiRun(env.db, {
        workspaceId: env.workspaceA,
        prId: pr.id,
        runs: [{ agentId: agent.id, status: 'failed', error: 'boom', withReview: false, ranAt: new Date(Date.now() - 120_000) }],
      });
      release = env.llm.hold();
      const retry = () =>
        env.appDev.inject({ method: 'POST', url: `/multi-agent-runs/${seeded.multiRunId}/agents/${agent.id}/retry` });

      const codes: number[] = [];
      try {
        codes.push((await retry()).statusCode); // creates a run, held on the gate
        for (let i = 0; i < 9; i++) codes.push((await retry()).statusCode);
        const before = (await agentRunsOfPr(env.db, pr.id)).length;
        const eleventh = await retry();
        codes.push(eleventh.statusCode);

        expect(codes.slice(0, 10)).toEqual([200, ...Array(9).fill(409)]);
        expect(eleventh.statusCode).toBe(429);
        expect(await agentRunsOfPr(env.db, pr.id)).toHaveLength(before);
        expect(before).toBe(2);
      } finally {
        await settle(seeded.multiRunId);
      }
    });
  });

  describe('D17 — GET /multi-agent-runs/:id/events?run_ids=', () => {
    /** A settled 2-agent multi-run started through the API (no gate). */
    async function settledMultiRun() {
      const { pr } = await newRepoPr(env.db, env.workspaceA);
      const [a, b] = [await newAgent(env.db, env.workspaceA), await newAgent(env.db, env.workspaceA)];
      const res = await env.app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/multi-agent-run`,
        payload: { agent_ids: [a.id, b.id] },
      });
      expect(res.statusCode).toBe(200);
      const started = res.json() as MultiAgentRunStarted;
      const runIds = started.runs.map((r) => r.run_id);
      await waitForRuns(env.db, runIds);
      return { multiRunId: started.multi_agent_run_id, runIds, pr };
    }
    const events = (multiRunId: string, runIds: string[], app = env.app) =>
      app.inject({ method: 'GET', url: `/multi-agent-runs/${multiRunId}/events?run_ids=${runIds.join(',')}` });

    it('D17: a settled 2-agent multi-run streams the frames of both runs on one response that ends', async () => {
      const { multiRunId, runIds } = await settledMultiRun();
      const res = await events(multiRunId, runIds);
      expect(res.statusCode).toBe(200);
      expect(String(res.headers['content-type'])).toMatch(/^text\/event-stream/);
      const frames = res.payload
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => JSON.parse(l.slice('data:'.length).trim()) as { runId: string });
      const seen = new Set(frames.map((f) => f.runId));
      expect(seen.has(runIds[0]!)).toBe(true);
      expect(seen.has(runIds[1]!)).toBe(true);
    });

    it('D17: a run that is already settled in the DB but unknown to this process (seeded, or after a restart) ends the stream instead of holding it open', async () => {
      const { pr } = await newRepoPr(env.db, env.workspaceA);
      const agent = await newAgent(env.db, env.workspaceA);
      const seeded = await seedMultiRun(env.db, {
        workspaceId: env.workspaceA,
        prId: pr.id,
        runs: [{ agentId: agent.id, status: 'done' }],
      });
      const runId = seeded.runs[0]!.runId;
      const timedOut = Symbol('timed out');
      const res = await Promise.race([
        events(seeded.multiRunId, [runId]),
        new Promise<typeof timedOut>((r) => setTimeout(() => r(timedOut), 3000)),
      ]);
      expect(res).not.toBe(timedOut);
      expect((res as Awaited<ReturnType<typeof events>>).statusCode).toBe(200);
    });

    it('D17: a run id from another multi-run answers 404 "Run not found"; another workspace answers 404', async () => {
      const { multiRunId, runIds, pr } = await settledMultiRun();
      const other = await newAgent(env.db, env.workspaceA);
      const foreignSeed = await seedMultiRun(env.db, {
        workspaceId: env.workspaceA,
        prId: pr.id,
        runs: [{ agentId: other.id, status: 'done' }],
      });
      const foreignRun = foreignSeed.runs[0]!.runId;

      const mixed = await events(multiRunId, [runIds[0]!, foreignRun]);
      expect(mixed.statusCode).toBe(404);
      expect(mixed.json().error.message).toBe('Run not found');

      const crossWorkspace = await events(multiRunId, runIds, env.appB);
      expect(crossWorkspace.statusCode).toBe(404);
    });

    it('D17: a non-uuid in run_ids and a list of 21 ids answer 422', async () => {
      const { multiRunId, runIds } = await settledMultiRun();
      const bad = await events(multiRunId, [runIds[0]!, 'not-a-uuid']);
      expect(bad.statusCode).toBe(422);
      const tooMany = await events(
        multiRunId,
        Array.from({ length: 21 }, () => crypto.randomUUID()),
      );
      expect(tooMany.statusCode).toBe(422);
    });
  });
});
