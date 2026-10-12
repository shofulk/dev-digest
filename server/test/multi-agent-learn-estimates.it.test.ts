import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { LearnFindingResult, MultiAgentRun, RunEstimate } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import {
  countAll,
  newAgent,
  newRepoPr,
  resetEnv,
  seedMultiRun,
  setupEnv,
  type Env,
} from './helpers/multi-agent.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[multi-agent-learn-estimates] Docker not available — skipping integration tests.');
}

/**
 * Multi-agent review (SPEC-05) — run estimates (GET /run-estimates) and the Learn
 * action (POST /findings/:id/learn), plus the `learned` flag on both reads.
 */
d('multi-agent learn and estimates (Testcontainers pg)', () => {
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

  // ------------------------------------------------------------ estimates

  describe('run estimates', () => {
    type RunSeed = {
      workspaceId: string;
      agentId: string;
      prId: string;
      status: string;
      ranAt: Date;
      durationMs: number | null;
      costUsd: number | null;
    };
    const insertRuns = (rows: RunSeed[]) => env.db.insert(t.agentRuns).values(rows).returning();

    it('AC-15: per agent, the median duration and median non-null cost over its last 10 `done` runs on any PR, and the runs used', async () => {
      const { pr: pr1 } = await newRepoPr(env.db, env.workspaceA);
      const { pr: pr2 } = await newRepoPr(env.db, env.workspaceA);
      const { pr: foreignPr } = await newRepoPr(env.db, env.workspaceB);
      const x = await newAgent(env.db, env.workspaceA, { name: 'Estimated X' });
      const y = await newAgent(env.db, env.workspaceA, { name: 'Estimated Y (unpriced)' });
      const never = await newAgent(env.db, env.workspaceA, { name: 'Never ran' });
      const disabled = await newAgent(env.db, env.workspaceA, { name: 'Disabled W', enabled: false });
      const foreignAgent = await newAgent(env.db, env.workspaceB, { name: 'Foreign agent' });
      const now = Date.now();
      const minutesAgo = (m: number) => new Date(now - m * 60_000);

      await insertRuns([
        // X: 10 newest done runs (1..10 s, $0.01..$0.10), spread over two PRs ...
        ...Array.from({ length: 10 }, (_, k) => ({
          workspaceId: env.workspaceA,
          agentId: x.id,
          prId: k % 2 === 0 ? pr1.id : pr2.id,
          status: 'done',
          ranAt: minutesAgo(k + 1),
          durationMs: (k + 1) * 1000,
          costUsd: (k + 1) / 100,
        })),
        // ... an 11th, older done run that must NOT count ...
        { workspaceId: env.workspaceA, agentId: x.id, prId: pr1.id, status: 'done', ranAt: minutesAgo(60), durationMs: 999_999, costUsd: 99 },
        // ... newer failed / cancelled runs that must NOT count ...
        { workspaceId: env.workspaceA, agentId: x.id, prId: pr1.id, status: 'failed', ranAt: minutesAgo(0.5), durationMs: 500_000, costUsd: 50 },
        { workspaceId: env.workspaceA, agentId: x.id, prId: pr1.id, status: 'cancelled', ranAt: minutesAgo(0.4), durationMs: 400_000, costUsd: 40 },
        // ... and a run recorded in another workspace under the same agent id.
        { workspaceId: env.workspaceB, agentId: x.id, prId: foreignPr.id, status: 'done', ranAt: minutesAgo(0.1), durationMs: 777_777, costUsd: 77 },
        // Y: three done runs, none priced.
        { workspaceId: env.workspaceA, agentId: y.id, prId: pr1.id, status: 'done', ranAt: minutesAgo(3), durationMs: 100, costUsd: null },
        { workspaceId: env.workspaceA, agentId: y.id, prId: pr1.id, status: 'done', ranAt: minutesAgo(2), durationMs: 300, costUsd: null },
        { workspaceId: env.workspaceA, agentId: y.id, prId: pr2.id, status: 'done', ranAt: minutesAgo(1), durationMs: 200, costUsd: null },
        // A disabled agent still gets an estimate (sample of one is enough, A-4).
        { workspaceId: env.workspaceA, agentId: disabled.id, prId: pr1.id, status: 'done', ranAt: minutesAgo(1), durationMs: 1234, costUsd: 0.5 },
        // Another workspace's agent.
        { workspaceId: env.workspaceB, agentId: foreignAgent.id, prId: foreignPr.id, status: 'done', ranAt: minutesAgo(1), durationMs: 10, costUsd: 1 },
      ]);

      const res = await env.app.inject({ method: 'GET', url: '/run-estimates' });
      expect(res.statusCode).toBe(200);
      const estimates = res.json() as RunEstimate[];
      const of = (id: string) => estimates.find((e) => e.agent_id === id);

      const ex = of(x.id)!;
      expect(ex.sample_size).toBe(10);
      expect(ex.median_duration_ms).toBe(5500);
      expect(ex.median_cost_usd).toBeCloseTo(0.055, 6);

      expect(of(y.id)).toEqual({ agent_id: y.id, median_duration_ms: 200, median_cost_usd: null, sample_size: 3 });
      expect(of(never.id)).toEqual({ agent_id: never.id, median_duration_ms: null, median_cost_usd: null, sample_size: 0 });
      const ed = of(disabled.id)!;
      expect(ed.sample_size).toBe(1);
      expect(ed.median_duration_ms).toBe(1234);
      expect(ed.median_cost_usd).toBeCloseTo(0.5, 6);

      // Exactly one entry per agent of the caller's workspace; none for another workspace's agent.
      expect(of(foreignAgent.id)).toBeUndefined();
      expect(new Set(estimates.map((e) => e.agent_id)).size).toBe(estimates.length);
      const workspaceAgents = await env.db.select().from(t.agents).where(eq(t.agents.workspaceId, env.workspaceA));
      expect(estimates.map((e) => e.agent_id).sort()).toEqual(workspaceAgents.map((a) => a.id).sort());
    });
  });

  // ------------------------------------------------------------ learn

  describe('learn', () => {
    /** A PR with a done multi-run: Alpha and Bravo each flag an overlapping range. */
    async function fixture() {
      const { repo, pr } = await newRepoPr(env.db, env.workspaceA, { number: 913 });
      const alpha = await newAgent(env.db, env.workspaceA, { name: 'Alpha' });
      const bravo = await newAgent(env.db, env.workspaceA, { name: 'Bravo' });
      const seeded = await seedMultiRun(env.db, {
        workspaceId: env.workspaceA,
        prId: pr.id,
        runs: [
          { agentId: alpha.id, status: 'done', findings: [{ start: 10, end: 12, severity: 'WARNING', title: 'Alpha title', rationale: 'Alpha rationale' }] },
          { agentId: bravo.id, status: 'done', findings: [{ start: 11, severity: 'WARNING', title: 'Bravo title', rationale: 'Bravo rationale' }] },
        ],
      });
      return {
        repo,
        pr,
        multiRunId: seeded.multiRunId,
        alphaFinding: seeded.runs[0]!.findingIds[0]!,
        bravoFinding: seeded.runs[1]!.findingIds[0]!,
      };
    }

    const learn = (id: string, app = env.app) => app.inject({ method: 'POST', url: `/findings/${id}/learn` });
    const memoryOf = (repoId: string) =>
      env.db
        .select()
        .from(t.memory)
        .where(and(eq(t.memory.workspaceId, env.workspaceA), eq(t.memory.repoId, repoId), eq(t.memory.kind, 'learning')));

    it('AC-59: Learn answers 201 and stores one repo-scoped `learning` memory row with title + rationale, the PR number as source, and no embedding', async () => {
      const f = await fixture();
      const res = await learn(f.alphaFinding);
      expect(res.statusCode).toBe(201);
      const body = res.json() as LearnFindingResult;
      expect(body.created).toBe(true);
      expect(body.kind).toBe('learning');
      expect(body.scope).toBe('repo');
      expect(body.content).toContain('Alpha title');
      expect(body.content).toContain('Alpha rationale');

      const rows = await memoryOf(f.repo.id);
      expect(rows).toHaveLength(1);
      const [row] = rows;
      expect(row!.id).toBe(body.id);
      expect(row!.scope).toBe('repo');
      expect(row!.kind).toBe('learning');
      expect(row!.repoId).toBe(f.repo.id);
      expect(row!.workspaceId).toBe(env.workspaceA);
      expect(row!.content).toContain('Alpha title');
      expect(row!.content).toContain('Alpha rationale');
      expect(row!.embedding).toBeNull();
      expect(row!.confidence).toBeNull();
      const sources = row!.sources as { pr?: number }[];
      expect(Array.isArray(sources)).toBe(true);
      expect(sources[0]!.pr).toBe(913);
    });

    it('AC-60: learning the same finding again answers 200 with the existing row and stores no new row', async () => {
      const f = await fixture();
      const first = await learn(f.alphaFinding);
      expect(first.statusCode).toBe(201);
      const again = await learn(f.alphaFinding);
      expect(again.statusCode).toBe(200);
      const body = again.json() as LearnFindingResult;
      expect(body.id).toBe((first.json() as LearnFindingResult).id);
      expect(body.created).toBe(false);
      expect(await memoryOf(f.repo.id)).toHaveLength(1);

      // A different finding is its own row.
      expect((await learn(f.bravoFinding)).statusCode).toBe(201);
      expect(await memoryOf(f.repo.id)).toHaveLength(2);
    });

    it('Learn on a finding of another workspace, or an unknown finding, answers 404 and stores nothing', async () => {
      const f = await fixture();
      const before = await countAll(env.db, t.memory);
      expect((await learn(f.alphaFinding, env.appB)).statusCode).toBe(404);
      expect((await learn(crypto.randomUUID())).statusCode).toBe(404);
      expect(await countAll(env.db, t.memory)).toBe(before);
    });

    it('AC-75: `learned` is true for a learned finding and false for the others, on the PR reviews read and on the multi-run read', async () => {
      const f = await fixture();
      const reviewFindings = async () => {
        const res = await env.app.inject({ method: 'GET', url: `/pulls/${f.pr.id}/reviews` });
        expect(res.statusCode).toBe(200);
        return (res.json() as { findings: { id: string; learned?: boolean | null }[] }[]).flatMap((r) => r.findings);
      };
      const runFindings = async () => {
        const res = await env.app.inject({ method: 'GET', url: `/multi-agent-runs/${f.multiRunId}` });
        expect(res.statusCode).toBe(200);
        return (res.json() as MultiAgentRun).columns.flatMap((c) => c.findings);
      };

      // Nothing learned yet: both are explicitly "not learned".
      for (const list of [await reviewFindings(), await runFindings()]) {
        expect(list.map((x) => x.learned)).toEqual([false, false]);
      }

      expect((await learn(f.alphaFinding)).statusCode).toBe(201);

      for (const list of [await reviewFindings(), await runFindings()]) {
        expect(list).toHaveLength(2);
        expect(list.find((x) => x.id === f.alphaFinding)!.learned).toBe(true);
        expect(list.find((x) => x.id === f.bravoFinding)!.learned).toBe(false);
      }
    });

    it('AC-57 (guard — holds at Base): accepting one agent\'s finding leaves the other agent\'s finding in the same group untriaged', async () => {
      const f = await fixture();
      const accept = await env.app.inject({ method: 'POST', url: `/findings/${f.alphaFinding}/accept` });
      expect(accept.statusCode).toBe(200);

      const [alpha] = await env.db.select().from(t.findings).where(eq(t.findings.id, f.alphaFinding));
      const [bravo] = await env.db.select().from(t.findings).where(eq(t.findings.id, f.bravoFinding));
      expect(alpha!.acceptedAt).not.toBeNull();
      expect(alpha!.dismissedAt).toBeNull();
      expect(bravo!.acceptedAt).toBeNull();
      expect(bravo!.dismissedAt).toBeNull();

      const reviews = await env.app.inject({ method: 'GET', url: `/pulls/${f.pr.id}/reviews` });
      const all = (reviews.json() as { findings: { id: string; accepted_at: string | null; dismissed_at: string | null }[] }[]).flatMap(
        (r) => r.findings,
      );
      const other = all.find((x) => x.id === f.bravoFinding)!;
      expect(other.accepted_at).toBeNull();
      expect(other.dismissed_at).toBeNull();
    });
  });
});
