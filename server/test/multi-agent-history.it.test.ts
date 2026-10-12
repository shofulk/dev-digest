import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { MultiAgentRun, MultiAgentRunSummary } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import { newAgent, newRepoPr, p95, resetEnv, setupEnv, type Env } from './helpers/multi-agent.js';
import { bulkSeedMultiRuns, seedListedMultiRun } from './helpers/multi-agent-history.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[multi-agent-history] Docker not available — skipping integration tests.');
}

/**
 * Multi-agent run history (SPEC-06) — GET /repos/:id/multi-agent-runs.
 *
 * Every app is built in `beforeAll`, BEFORE any `running` row is seeded: the
 * boot reaper (`buildApp`) flips every `running` agent run to `failed`.
 * Multi-runs and agent runs are written straight to the DB.
 */
d('multi-agent run list (Testcontainers pg)', () => {
  let pg: PgFixture;
  let env: Env;

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

  const listUrl = (repoId: string, prId?: string) => `/repos/${repoId}/multi-agent-runs${prId ? `?pr_id=${prId}` : ''}`;
  const list = (repoId: string, prId?: string, app: FastifyInstance = env.app) =>
    app.inject({ method: 'GET', url: listUrl(repoId, prId) });
  const listOk = async (repoId: string, prId?: string) => {
    const res = await list(repoId, prId);
    expect(res.statusCode).toBe(200);
    return res.json() as MultiAgentRunSummary[];
  };
  const addPr = async (workspaceId: string, repoId: string, number: number, title: string) => {
    const [pr] = await env.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number,
        title,
        author: 'marisa.koch',
        branch: 'feat/x',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: '',
      })
      .returning();
    return pr!;
  };
  const at = (iso: string) => new Date(iso);

  it('AC-76: orders by ran_at desc then id desc (ties included) and excludes another repo of the same workspace', async () => {
    const { repo, pr } = await newRepoPr(env.db, env.workspaceA, { number: 11, title: 'First PR' });
    const pr2 = await addPr(env.workspaceA, repo.id, 12, 'Second PR');
    const { pr: otherRepoPr } = await newRepoPr(env.db, env.workspaceA, { number: 11 });
    const ws = env.workspaceA;
    const oldest = await seedListedMultiRun(env.db, { workspaceId: ws, prId: pr.id, ranAt: at('2026-02-01T10:00:00Z') });
    const newest = await seedListedMultiRun(env.db, { workspaceId: ws, prId: pr2.id, ranAt: at('2026-02-03T10:00:00Z') });
    const tieLow = await seedListedMultiRun(env.db, {
      workspaceId: ws,
      prId: pr.id,
      ranAt: at('2026-02-02T10:00:00Z'),
      id: '00000000-0000-4000-8000-0000000000a1',
    });
    const tieHigh = await seedListedMultiRun(env.db, {
      workspaceId: ws,
      prId: pr2.id,
      ranAt: at('2026-02-02T10:00:00Z'),
      id: '00000000-0000-4000-8000-0000000000b2',
    });
    const foreign = await seedListedMultiRun(env.db, { workspaceId: ws, prId: otherRepoPr.id, ranAt: at('2026-02-05T10:00:00Z') });

    const body = await listOk(repo.id);
    expect(body.map((i) => i.id)).toEqual([newest.multiRunId, tieHigh.multiRunId, tieLow.multiRunId, oldest.multiRunId]);
    expect(body.map((i) => i.id)).not.toContain(foreign.multiRunId);
  });

  it('AC-77, H-NFR-3: 25 multi-runs on the repo -> the 20 newest; 25 on one PR with pr_id -> the 20 newest of that PR', async () => {
    const { repo, pr } = await newRepoPr(env.db, env.workspaceA, { number: 21 });
    const noise = await addPr(env.workspaceA, repo.id, 22, 'Noise PR');
    const agent = await newAgent(env.db, env.workspaceA);
    const ids = await bulkSeedMultiRuns(env.db, {
      workspaceId: env.workspaceA,
      prId: pr.id,
      agentIds: [agent.id],
      count: 25,
      startAt: at('2026-03-01T00:00:00Z'),
    });
    // Newer multi-runs of another PR in the same repo: they push the PR's own runs out of the repo-wide top 20.
    await bulkSeedMultiRuns(env.db, {
      workspaceId: env.workspaceA,
      prId: noise.id,
      agentIds: [agent.id],
      count: 5,
      startAt: at('2026-04-01T00:00:00Z'),
    });

    const repoWide = await listOk(repo.id);
    expect(repoWide).toHaveLength(20);
    expect(repoWide.slice(0, 5).every((i) => i.pr_id === noise.id)).toBe(true);

    const ofPr = await listOk(repo.id, pr.id);
    expect(ofPr).toHaveLength(20);
    const newestTwenty = ids.slice(5).reverse(); // ids are oldest -> newest
    expect(ofPr.map((i) => i.id)).toEqual(newestTwenty);
  });

  it('AC-78: every field is present, with pr_number and pr_title from the PR', async () => {
    const { repo, pr } = await newRepoPr(env.db, env.workspaceA, { number: 31, title: 'Title with <b>markup</b> & more' });
    const a1 = await newAgent(env.db, env.workspaceA);
    const a2 = await newAgent(env.db, env.workspaceA);
    const ranAt = at('2026-05-06T07:08:09.123Z');
    const seeded = await seedListedMultiRun(env.db, {
      workspaceId: env.workspaceA,
      prId: pr.id,
      ranAt,
      runs: [
        { agentId: a1.id, status: 'done', durationMs: 4000, costUsd: 0.25 },
        { agentId: a2.id, status: 'done', durationMs: 9000, costUsd: 0.5 },
      ],
    });
    const body = await listOk(repo.id);
    expect(body).toEqual([
      {
        id: seeded.multiRunId,
        pr_id: pr.id,
        pr_number: 31,
        pr_title: 'Title with <b>markup</b> & more',
        ran_at: ranAt.toISOString(),
        agent_count: 2,
        status: 'done',
        total_duration_ms: 9000,
        total_cost_usd: 0.75,
      },
    ]);
  });

  it('AC-79, AC-106: a retried agent (failed, then done) counts once, and the item equals GET /multi-agent-runs/:id', async () => {
    const { repo, pr } = await newRepoPr(env.db, env.workspaceA, { number: 41 });
    const retried = await newAgent(env.db, env.workspaceA, { name: 'Retried' });
    const steady = await newAgent(env.db, env.workspaceA, { name: 'Steady' });
    const base = at('2026-06-01T10:00:00Z');
    const seeded = await seedListedMultiRun(env.db, {
      workspaceId: env.workspaceA,
      prId: pr.id,
      ranAt: base,
      runs: [
        { agentId: retried.id, status: 'failed', ranAt: new Date(base.getTime() + 1_000), durationMs: 9_999, costUsd: 5 },
        { agentId: steady.id, status: 'done', ranAt: new Date(base.getTime() + 2_000), durationMs: 4_000, costUsd: 0.2 },
        { agentId: retried.id, status: 'done', ranAt: new Date(base.getTime() + 3_000), durationMs: 6_000, costUsd: 0.3 },
      ],
    });

    const [item] = await listOk(repo.id);
    const readRes = await env.app.inject({ method: 'GET', url: `/multi-agent-runs/${seeded.multiRunId}` });
    expect(readRes.statusCode).toBe(200);
    const read = readRes.json() as MultiAgentRun;

    expect(item!.id).toBe(seeded.multiRunId);
    expect(item!.agent_count).toBe(2);
    expect(item!.status).toBe('done');
    expect(item!.agent_count).toBe(read.agent_count);
    expect(item!.total_duration_ms).toBe(read.total_duration_ms);
    expect(item!.total_cost_usd).toBe(read.total_cost_usd);
    expect(item!.total_duration_ms).toBe(6_000);
  });

  it('AC-80: one counted run seeded running (after the app build) -> status running', async () => {
    const { repo, pr } = await newRepoPr(env.db, env.workspaceA, { number: 51 });
    const a1 = await newAgent(env.db, env.workspaceA);
    const a2 = await newAgent(env.db, env.workspaceA);
    await seedListedMultiRun(env.db, {
      workspaceId: env.workspaceA,
      prId: pr.id,
      ranAt: at('2026-06-02T10:00:00Z'),
      runs: [
        { agentId: a1.id, status: 'done' },
        { agentId: a2.id, status: 'running', durationMs: null, costUsd: null },
      ],
    });
    const [item] = await listOk(repo.id);
    expect(item!.status).toBe('running');
    expect(item!.agent_count).toBe(2);
  });

  it('AC-83: a repo with no multi-run -> 200 []', async () => {
    const { repo } = await newRepoPr(env.db, env.workspaceA, { number: 61 });
    const res = await list(repo.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('AC-84: pr_id returns only that PR\'s multi-runs', async () => {
    const { repo, pr } = await newRepoPr(env.db, env.workspaceA, { number: 71 });
    const pr2 = await addPr(env.workspaceA, repo.id, 72, 'Other PR in the repo');
    const mine1 = await seedListedMultiRun(env.db, { workspaceId: env.workspaceA, prId: pr.id, ranAt: at('2026-07-01T10:00:00Z') });
    const mine2 = await seedListedMultiRun(env.db, { workspaceId: env.workspaceA, prId: pr.id, ranAt: at('2026-07-02T10:00:00Z') });
    const theirs = await seedListedMultiRun(env.db, { workspaceId: env.workspaceA, prId: pr2.id, ranAt: at('2026-07-03T10:00:00Z') });

    const body = await listOk(repo.id, pr.id);
    expect(body.map((i) => i.id)).toEqual([mine2.multiRunId, mine1.multiRunId]);
    expect(body.every((i) => i.pr_id === pr.id)).toBe(true);
    expect((await listOk(repo.id)).map((i) => i.id)).toContain(theirs.multiRunId);
  });

  it('AC-85: an unknown pr_id, a PR of another repo and a PR of another workspace -> 404 with error.message', async () => {
    const { repo } = await newRepoPr(env.db, env.workspaceA, { number: 81 });
    const { pr: otherRepoPr } = await newRepoPr(env.db, env.workspaceA, { number: 81 });
    const { pr: otherWsPr } = await newRepoPr(env.db, env.workspaceB, { number: 81 });
    for (const prId of [randomUUID(), otherRepoPr.id, otherWsPr.id]) {
      const res = await list(repo.id, prId);
      expect(res.statusCode).toBe(404);
      expect(typeof res.json().error.message).toBe('string');
    }
  });

  it('AC-86: an unknown repo and another workspace\'s repo -> 404; another workspace\'s multi-runs on a same-numbered PR never appear', async () => {
    const { repo, pr } = await newRepoPr(env.db, env.workspaceA, { number: 482, title: 'Mine' });
    const { repo: repoB, pr: prB } = await newRepoPr(env.db, env.workspaceB, { number: 482, title: 'Theirs' });
    const agentB = await newAgent(env.db, env.workspaceB);
    const mine = await seedListedMultiRun(env.db, { workspaceId: env.workspaceA, prId: pr.id, ranAt: at('2026-08-01T10:00:00Z') });
    const theirs = await seedListedMultiRun(env.db, {
      workspaceId: env.workspaceB,
      prId: prB.id,
      ranAt: at('2026-08-02T10:00:00Z'),
      runs: [{ agentId: agentB.id, status: 'done' }],
    });
    // Cross-workspace rows hanging off workspace A's repo: a multi-run row stamped with
    // workspace B on A's PR, and a workspace-B agent run linked to A's multi-run.
    const stamped = await seedListedMultiRun(env.db, { workspaceId: env.workspaceB, prId: pr.id, ranAt: at('2026-08-03T10:00:00Z') });
    const leakyAgent = await newAgent(env.db, env.workspaceA);
    const withLeak = await seedListedMultiRun(env.db, {
      workspaceId: env.workspaceA,
      prId: pr.id,
      ranAt: at('2026-08-04T10:00:00Z'),
      runs: [
        { agentId: leakyAgent.id, status: 'done' },
        { agentId: agentB.id, status: 'failed', workspaceId: env.workspaceB },
      ],
    });

    const mineList = await listOk(repo.id);
    const ids = mineList.map((i) => i.id);
    expect(ids).toEqual([withLeak.multiRunId, mine.multiRunId]);
    expect(ids).not.toContain(theirs.multiRunId);
    expect(ids).not.toContain(stamped.multiRunId);
    expect(mineList[0]!.agent_count).toBe(1);
    expect(mineList[0]!.status).toBe('done');

    expect((await list(randomUUID())).statusCode).toBe(404);
    const crossRepo = await list(repoB.id);
    expect(crossRepo.statusCode).toBe(404);
    expect(typeof crossRepo.json().error.message).toBe('string');
    const fromB = await list(repoB.id, undefined, env.appB);
    expect(fromB.statusCode).toBe(200);
    expect((fromB.json() as MultiAgentRunSummary[]).map((i) => i.id)).toEqual([theirs.multiRunId]);
  });

  it('AC-87: a non-uuid repo id and a non-uuid pr_id -> 422', async () => {
    const { repo } = await newRepoPr(env.db, env.workspaceA, { number: 91 });
    expect((await list('not-a-uuid')).statusCode).toBe(422);
    expect((await list(repo.id, 'not-a-uuid')).statusCode).toBe(422);
  });

  it('H-NFR-1: p95 of 20 sequential list reads <= 200 ms with 500 multi-runs x 5 agent runs on one repo', async () => {
    const { repo, pr } = await newRepoPr(env.db, env.workspaceA, { number: 101 });
    const agents = await Promise.all(Array.from({ length: 5 }, () => newAgent(env.db, env.workspaceA)));
    await bulkSeedMultiRuns(env.db, {
      workspaceId: env.workspaceA,
      prId: pr.id,
      agentIds: agents.map((a) => a.id),
      count: 500,
      startAt: at('2025-01-01T00:00:00Z'),
    });

    const warm = await list(repo.id);
    expect(warm.statusCode).toBe(200);
    expect(warm.json()).toHaveLength(20);

    const samples: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const started = performance.now();
      const res = await list(repo.id);
      samples.push(performance.now() - started);
      expect(res.statusCode).toBe(200);
    }
    expect(p95(samples)).toBeLessThanOrEqual(200);
  }, 60_000);
});
