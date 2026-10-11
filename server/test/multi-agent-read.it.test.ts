import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { MultiAgentRun, MultiAgentRunStarted } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import {
  GROUNDED_FINDING,
  OFF_DIFF_FINDING,
  CLEAN_REVIEW,
  findingsOfPr,
  newAgent,
  newRepoPr,
  p95,
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
  console.warn('[multi-agent-read] Docker not available — skipping integration tests.');
}

/**
 * Multi-agent review (SPEC-03) — the read model: GET /multi-agent-runs/:id.
 *
 * Most cases seed the multi-run straight into the DB (so they do not depend on
 * the start path); the AC-70 case drives a real run through the grounding gate.
 */
d('multi-agent read (Testcontainers pg)', () => {
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

  const read = (id: string, app: FastifyInstance = env.app) => app.inject({ method: 'GET', url: `/multi-agent-runs/${id}` });
  const readOk = async (id: string) => {
    const res = await read(id);
    expect(res.statusCode).toBe(200);
    return res.json() as MultiAgentRun;
  };

  it('AC-31: returns the PR id and number, run time, agent count, a column per agent, totals, groups and the stale flag', async () => {
    const { pr } = await newRepoPr(env.db, env.workspaceA, { number: 777, headSha: 'sha-777' });
    const alpha = await newAgent(env.db, env.workspaceA, { name: 'Alpha' });
    const bravo = await newAgent(env.db, env.workspaceA, { name: 'Bravo' });
    const seeded = await seedMultiRun(env.db, {
      workspaceId: env.workspaceA,
      prId: pr.id,
      headSha: 'sha-777',
      runs: [
        { agentId: alpha.id, status: 'done', durationMs: 4000, costUsd: 0.01, findings: [{ start: 10, end: 12, severity: 'WARNING', title: 'Alpha finding' }] },
        { agentId: bravo.id, status: 'done', durationMs: 9000, costUsd: 0.02 },
      ],
    });
    const [multi] = await env.db.select().from(t.multiAgentRuns).where(eq(t.multiAgentRuns.id, seeded.multiRunId));

    const body = await readOk(seeded.multiRunId);
    expect(body.id).toBe(seeded.multiRunId);
    expect(body.pr_id).toBe(pr.id);
    expect(body.pr_number).toBe(777);
    expect(new Date(body.ran_at).getTime()).toBe(multi!.ranAt.getTime());
    expect(body.agent_count).toBe(2);
    expect(body.columns).toHaveLength(2);
    expect(body.total_duration_ms).toBe(9000);
    expect(body.total_cost_usd).toBeCloseTo(0.03, 6);
    expect(body.head_sha).toBe('sha-777');
    expect(body.stale).toBe(false);
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0]).toMatchObject({ file: 'src/config.ts', line: 10, title: 'Alpha finding', is_conflict: true });
    expect(body.conflicts[0]!.takes.map((x) => [x.agent_id, x.verdict])).toEqual([
      [alpha.id, 'WARNING'],
      [bravo.id, 'ignored'],
    ]);
  });

  it('AC-32: each column is the newest run of its agent, with status, score, verdict, summary, duration, cost, error and findings', async () => {
    const { pr } = await newRepoPr(env.db, env.workspaceA);
    const alpha = await newAgent(env.db, env.workspaceA, { name: 'alpha' });
    const bravo = await newAgent(env.db, env.workspaceA, { name: 'Bravo' });
    const charlie = await newAgent(env.db, env.workspaceA, { name: 'Charlie' });
    const delta = await newAgent(env.db, env.workspaceA, { name: 'Delta' });
    const now = Date.now();
    const seeded = await seedMultiRun(env.db, {
      workspaceId: env.workspaceA,
      prId: pr.id,
      runs: [
        // alpha was retried: the older run failed, the newer one is done.
        { agentId: alpha.id, status: 'failed', ranAt: new Date(now - 600_000), error: 'old failure', durationMs: 50, costUsd: null },
        {
          agentId: alpha.id,
          status: 'done',
          ranAt: new Date(now - 60_000),
          durationMs: 3210,
          costUsd: 0.0123,
          score: 66,
          verdict: 'request_changes',
          summary: 'Alpha summary',
          findings: [
            { start: 5, severity: 'CRITICAL', title: 'First', file: 'src/a.ts' },
            { start: 40, end: 42, severity: 'SUGGESTION', title: 'Second', file: 'src/b.ts' },
          ],
        },
        { agentId: bravo.id, status: 'failed', error: 'Request timed out', withReview: false, durationMs: 900, costUsd: null },
        { agentId: charlie.id, status: 'cancelled', withReview: false, durationMs: null, costUsd: null },
        { agentId: delta.id, status: 'running', withReview: false, durationMs: null, costUsd: null },
      ],
    });

    const body = await readOk(seeded.multiRunId);
    expect(body.agent_count).toBe(4);
    // Ordered by agent name, case-insensitively.
    expect(body.columns.map((c) => c.agent_name)).toEqual(['alpha', 'Bravo', 'Charlie', 'Delta']);

    const newestAlpha = seeded.runs[1]!;
    const [a, b, c, dl] = body.columns;
    expect(a).toMatchObject({
      run_id: newestAlpha.runId,
      agent_id: alpha.id,
      status: 'done',
      score: 66,
      verdict: 'request_changes',
      summary: 'Alpha summary',
      duration_ms: 3210,
      error: null,
    });
    expect(a!.cost_usd).toBeCloseTo(0.0123, 6);
    const byTitle = [...a!.findings].sort((x, y) => x.title.localeCompare(y.title));
    expect(byTitle.map((x) => [x.id, x.severity, x.title, x.file, x.start_line, x.category])).toEqual([
      [newestAlpha.findingIds[0], 'CRITICAL', 'First', 'src/a.ts', 5, 'test'],
      [newestAlpha.findingIds[1], 'SUGGESTION', 'Second', 'src/b.ts', 40, 'test'],
    ]);
    expect(b).toMatchObject({ run_id: seeded.runs[2]!.runId, status: 'failed', error: 'Request timed out', verdict: null, summary: null, score: null });
    expect(b!.findings).toEqual([]);
    expect(c).toMatchObject({ run_id: seeded.runs[3]!.runId, status: 'cancelled', error: null });
    expect(dl).toMatchObject({ run_id: seeded.runs[4]!.runId, status: 'running', error: null });

    // Totals come from the finished `done` runs only.
    expect(body.total_duration_ms).toBe(3210);
    expect(body.total_cost_usd).toBeCloseTo(0.0123, 6);
  });

  it('AC-34: the run is stale once the PR head SHA moved, and not before', async () => {
    const { pr } = await newRepoPr(env.db, env.workspaceA, { headSha: 'head-1' });
    const agent = await newAgent(env.db, env.workspaceA);
    const seeded = await seedMultiRun(env.db, {
      workspaceId: env.workspaceA,
      prId: pr.id,
      headSha: 'head-1',
      runs: [{ agentId: agent.id, status: 'done' }],
    });

    const fresh = await readOk(seeded.multiRunId);
    expect(fresh.head_sha).toBe('head-1');
    expect(fresh.stale).toBe(false);

    await env.db.update(t.pullRequests).set({ headSha: 'head-2' }).where(eq(t.pullRequests.id, pr.id));
    const moved = await readOk(seeded.multiRunId);
    expect(moved.head_sha).toBe('head-1');
    expect(moved.stale).toBe(true);
  });

  it('AC-35: an unknown multi-run id answers 404', async () => {
    expect((await read(crypto.randomUUID())).statusCode).toBe(404);
  });

  it('AC-35: a multi-run of another workspace answers 404 for the caller and 200 for its owner', async () => {
    const { pr } = await newRepoPr(env.db, env.workspaceA);
    const agent = await newAgent(env.db, env.workspaceA);
    const seeded = await seedMultiRun(env.db, {
      workspaceId: env.workspaceA,
      prId: pr.id,
      runs: [{ agentId: agent.id, status: 'done' }],
    });
    expect((await read(seeded.multiRunId, env.appB)).statusCode).toBe(404);
    expect((await read(seeded.multiRunId, env.app)).statusCode).toBe(200);
  });

  it('AC-39: takes leave out agents that are not in the multi-run and runs that are running, failed or cancelled', async () => {
    const { pr } = await newRepoPr(env.db, env.workspaceA);
    const [alpha, bravo, failed, running, cancelled, outsider] = await Promise.all(
      ['Alpha', 'Bravo', 'Failed', 'Running', 'Cancelled', 'Outsider'].map((name) => newAgent(env.db, env.workspaceA, { name })),
    );
    const seeded = await seedMultiRun(env.db, {
      workspaceId: env.workspaceA,
      prId: pr.id,
      runs: [
        { agentId: alpha!.id, status: 'done', findings: [{ start: 10, end: 12, severity: 'WARNING', title: 'Alpha title' }] },
        { agentId: bravo!.id, status: 'done', findings: [{ start: 11, severity: 'WARNING', title: 'Bravo title' }] },
        { agentId: failed!.id, status: 'failed', error: 'x', findings: [{ start: 10, end: 12, severity: 'CRITICAL', title: 'Failed title' }] },
        { agentId: running!.id, status: 'running', findings: [{ start: 10, end: 12, severity: 'CRITICAL', title: 'Running title' }] },
        { agentId: cancelled!.id, status: 'cancelled', findings: [{ start: 10, end: 12, severity: 'CRITICAL', title: 'Cancelled title' }] },
        // Same PR, but NOT part of this multi-run:
        { agentId: outsider!.id, status: 'done', linked: false, findings: [{ start: 10, end: 12, severity: 'CRITICAL', title: 'Outsider title' }] },
      ],
    });

    const body = await readOk(seeded.multiRunId);
    expect(body.agent_count).toBe(5);
    expect(body.columns.map((c) => c.agent_id)).not.toContain(outsider!.id);
    expect(body.conflicts).toHaveLength(1);
    const [group] = body.conflicts;
    expect(group!.takes.map((x) => x.agent_id)).toEqual([alpha!.id, bravo!.id]);
    expect(group!.takes.map((x) => x.verdict)).toEqual(['WARNING', 'WARNING']);
    expect(group!.is_conflict).toBe(false);
    expect(group!.title).toBe('Alpha title');
    expect(JSON.stringify(group)).not.toMatch(/Failed title|Running title|Cancelled title|Outsider title/);
  });

  it('AC-41: reading never changes a stored finding, and every column finding keeps its id, agent and run', async () => {
    const { pr } = await newRepoPr(env.db, env.workspaceA);
    const alpha = await newAgent(env.db, env.workspaceA, { name: 'Alpha' });
    const bravo = await newAgent(env.db, env.workspaceA, { name: 'Bravo' });
    const seeded = await seedMultiRun(env.db, {
      workspaceId: env.workspaceA,
      prId: pr.id,
      runs: [
        { agentId: alpha.id, status: 'done', findings: [{ start: 10, end: 12, title: 'A1' }, { start: 11, title: 'A2' }] },
        { agentId: bravo.id, status: 'done', findings: [{ start: 12, end: 13, title: 'B1' }] },
      ],
    });
    const snapshot = async () => (await findingsOfPr(env.db, pr.id)).sort((x, y) => x.id.localeCompare(y.id));
    const before = await snapshot();
    expect(before).toHaveLength(3);

    const first = await readOk(seeded.multiRunId);
    const second = await readOk(seeded.multiRunId);
    expect(second).toEqual(first);
    expect(await snapshot()).toEqual(before);

    // The three findings overlap into ONE group, yet each stays its own row.
    expect(first.conflicts).toHaveLength(1);
    for (const column of first.columns) {
      const mine = seeded.runs.find((r) => r.runId === column.run_id)!;
      expect(column.findings.map((x) => x.id).sort()).toEqual([...mine.findingIds].sort());
      for (const finding of column.findings) {
        const [review] = await env.db.select().from(t.reviews).where(eq(t.reviews.id, mine.reviewId!));
        expect(review!.agentId).toBe(column.agent_id);
        expect(review!.runId).toBe(column.run_id);
        expect(before.find((row) => row.id === finding.id)!.reviewId).toBe(mine.reviewId);
      }
    }
  });

  it('AC-70: a finding the grounding gate dropped appears in no column and no group (only persisted findings are read)', async () => {
    env.llm.fixture = { ...CLEAN_REVIEW, findings: [GROUNDED_FINDING, OFF_DIFF_FINDING] };
    const { pr } = await newRepoPr(env.db, env.workspaceA);
    const agents = await Promise.all(['Alpha', 'Bravo'].map((name) => newAgent(env.db, env.workspaceA, { name })));
    const startRes = await env.app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agent_ids: agents.map((a) => a.id) },
    });
    expect(startRes.statusCode).toBe(200);
    const started = startRes.json() as MultiAgentRunStarted;
    await waitForRuns(env.db, started.runs.map((r) => r.run_id));

    const body = await readOk(started.multi_agent_run_id);
    expect(body.columns).toHaveLength(2);
    for (const column of body.columns) {
      expect(column.status).toBe('done');
      expect(column.findings.map((x) => x.title)).toEqual([GROUNDED_FINDING.title]);
    }
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0]).toMatchObject({ file: 'src/config.ts', line: 11, title: GROUNDED_FINDING.title, is_conflict: false });
    expect(body.conflicts[0]!.takes.map((x) => x.verdict)).toEqual(['CRITICAL', 'CRITICAL']);
    expect(JSON.stringify(body)).not.toContain('Phantom');
    expect((await findingsOfPr(env.db, pr.id)).some((row) => row.startLine === 999)).toBe(false);
  });

  it('NFR-4: reading 5 agents x 50 findings answers within 300 ms at p95', async () => {
    const { pr } = await newRepoPr(env.db, env.workspaceA);
    const agents = await Promise.all([1, 2, 3, 4, 5].map((n) => newAgent(env.db, env.workspaceA, { name: `Perf ${n}` })));
    const seeded = await seedMultiRun(env.db, {
      workspaceId: env.workspaceA,
      prId: pr.id,
      runs: agents.map((agent, a) => ({
        agentId: agent.id,
        status: 'done' as const,
        findings: Array.from({ length: 50 }, (_, i) => ({
          file: `src/f${i % 5}.ts`,
          start: 10 + i * 4 + (a % 2),
          end: 12 + i * 4 + (a % 2),
          severity: (['CRITICAL', 'WARNING', 'SUGGESTION'] as const)[(i + a) % 3]!,
          title: `Perf finding ${a}-${i}`,
        })),
      })),
    });

    const samples: number[] = [];
    let last: MultiAgentRun | undefined;
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      const res = await read(seeded.multiRunId);
      samples.push(performance.now() - t0);
      expect(res.statusCode, `read ${i + 1}`).toBe(200);
      last = res.json() as MultiAgentRun;
    }
    expect(last!.columns).toHaveLength(5);
    expect(last!.columns.every((c) => c.findings.length === 50)).toBe(true);
    expect(last!.conflicts.length).toBeGreaterThan(0);
    expect(p95(samples)).toBeLessThanOrEqual(300);
  });
});
