import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import type { AuthProvider, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[eval] Docker not available — skipping integration tests.');
}

/**
 * The eval pipeline end to end: freezing triaged findings into cases, running an
 * agent over them, code-only scoring, the pending-row timeout, compare, dashboard.
 *
 * The model is a scripted fixture; what is under test is everything around it —
 * workspace scoping, idempotency, the in-flight guard, what a run does NOT write,
 * and the single-statement completion a polling client relies on.
 */

/** Two context blocks + two added lines: new-side lines 1..12 are all inside the hunk. */
const PATCH = [
  '@@ -1,10 +1,12 @@',
  ...Array.from({ length: 5 }, (_, i) => ` context ${i + 1}`),
  '+added line 6',
  ...Array.from({ length: 5 }, (_, i) => ` context ${i + 7}`),
  '+added line 12',
].join('\n');

const finding = (start: number, over: Record<string, unknown> = {}) => ({
  id: `m-${start}`,
  severity: 'WARNING',
  category: 'test',
  title: `model finding at ${start}`,
  file: 'src/a.ts',
  start_line: start,
  end_line: start,
  rationale: 'because',
  confidence: 0.8,
  ...over,
});
const reviewOf = (...findings: unknown[]) => ({
  verdict: 'comment',
  summary: 'ok',
  score: 70,
  findings,
});

/** A model whose answer, speed and failures the test controls. Never touches the network. */
class ScriptedLLM extends MockLLMProvider {
  fixture: unknown = reviewOf();
  gate: Promise<void> | undefined;
  failCalls = new Set<number>();
  private n = 0;

  constructor() {
    super('openrouter', {});
  }

  /** How many review calls reached this provider (counted on entry, before the gate). */
  get callCount(): number {
    return this.n;
  }

  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.n += 1;
    const call = this.n;
    await this.gate;
    if (this.failCalls.has(call)) throw new Error(`scripted failure on call ${call}`);
    return new MockLLMProvider('openrouter', { structured: this.fixture }).completeStructured(req);
  }
}

interface Created {
  id: string;
  created: boolean;
  owner_id: string;
  name: string;
  input_diff: string;
  input_files: string[];
  input_meta: Record<string, unknown>;
  expected_output: Record<string, unknown>;
  notes: string | null;
}

interface Suite {
  run_id: string;
  agent_id: string;
  status: 'running' | 'completed';
  agent_version: number;
  cases_total: number;
  cases_done: number;
  recall: number | null;
  precision: number | null;
  citation_accuracy: number | null;
  traces_passed: number;
  traces_total: number;
  cases_errored: number;
  cost_usd: number | null;
  per_case: { case_id: string; name: string; status: string; pass: boolean | null; reason?: string | null }[];
}

d('eval module (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceA: string;
  let workspaceB: string;
  let workspaceC: string;
  let userId: string;
  let prId: string;
  let seq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const db = pg.handle.db;
    const [ws] = await db.select().from(t.workspaces).where(eq(t.workspaces.name, 'default'));
    workspaceA = ws!.id;
    const [user] = await db.select().from(t.users);
    userId = user!.id;
    const [other] = await db.insert(t.workspaces).values({ name: `other-${Date.now()}` }).returning();
    workspaceB = other!.id;
    const [third] = await db.insert(t.workspaces).values({ name: `run-all-${Date.now()}` }).returning();
    workspaceC = third!.id;

    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId: workspaceA, owner: 'acme', name: 'evals', fullName: 'acme/evals' })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: workspaceA,
        repoId: repo!.id,
        number: 42,
        title: 'Add the thing',
        author: 'dev',
        branch: 'feat',
        base: 'main',
        headSha: 'abc123',
        body: 'This PR adds the thing.',
      })
      .returning();
    prId = pr!.id;
    await db.insert(t.prFiles).values([
      { prId, path: 'src/a.ts', patch: PATCH },
      { prId, path: 'src/nopatch.ts', patch: null },
    ]);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  /** `workspaceId` picks which tenant the app's requests run as. */
  function makeApp(
    llm: ScriptedLLM = new ScriptedLLM(),
    workspaceId = workspaceA,
    // The rate-limit plugin is registered outside `test`; only the 429 case opts out of it.
    nodeEnv: 'test' | 'development' = 'test',
  ) {
    const auth: AuthProvider = {
      currentUser: async () => ({ id: userId, email: 'test@example.com', name: 'Test' }),
      currentWorkspace: async () => ({ id: workspaceId, name: 'test-ws' }),
    };
    const app = buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: nodeEnv, LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: { auth, git: new MockGitClient(), llm: { openrouter: llm } },
    });
    return app;
  }

  /** An agent of its own per test, so no test depends on another's cases. */
  async function newAgent(provider: 'openrouter' | 'openai' = 'openrouter', workspaceId = workspaceA) {
    seq += 1;
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: `Eval Agent ${seq}`,
        provider,
        model: 'test-model',
        systemPrompt: 'Review the diff carefully.',
        strategy: 'single-pass',
        version: 1,
      })
      .returning();
    return agent!.id;
  }

  /** A review (by `agentId`) holding one finding, triaged as asked. */
  async function newFinding(opts: {
    agentId: string | null;
    triage: 'accepted' | 'dismissed' | 'open';
    line?: number;
    file?: string;
    workspaceId?: string;
    rationale?: string;
  }): Promise<string> {
    const db = pg.handle.db;
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId: opts.workspaceId ?? workspaceA,
        prId,
        agentId: opts.agentId,
        kind: 'review',
        verdict: 'comment',
        summary: 's',
        score: 70,
        model: 'test-model',
      })
      .returning();
    const line = opts.line ?? 3;
    const [row] = await db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: opts.file ?? 'src/a.ts',
        startLine: line,
        endLine: line,
        severity: 'WARNING',
        category: 'test',
        title: `Original finding at line ${line}`,
        rationale: opts.rationale ?? 'The branch is never asserted.',
        confidence: 0.9,
        acceptedAt: opts.triage === 'accepted' ? new Date() : null,
        dismissedAt: opts.triage === 'dismissed' ? new Date() : null,
      })
      .returning();
    return row!.id;
  }

  async function freeze(app: FastifyInstance, findingId: string) {
    const res = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    return { res, body: res.json() as Created };
  }

  /** An agent with an accepted case (line 3) and a dismissed one (line 9). */
  async function agentWithCases(app: FastifyInstance, extra = 0) {
    const agentId = await newAgent();
    const caseIds: string[] = [];
    const specs = [
      { triage: 'accepted' as const, line: 3 },
      { triage: 'dismissed' as const, line: 9 },
      ...Array.from({ length: extra }, (_, i) => ({ triage: 'accepted' as const, line: 4 + i })),
    ];
    for (const s of specs) {
      const { res, body } = await freeze(app, await newFinding({ agentId, ...s }));
      expect(res.statusCode).toBe(201);
      caseIds.push(body.id);
    }
    return { agentId, caseIds };
  }

  async function startRun(app: FastifyInstance, agentId: string) {
    return app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
  }

  async function getRun(app: FastifyInstance, runId: string): Promise<Suite> {
    const res = await app.inject({ url: `/eval-runs/${runId}` });
    expect(res.statusCode).toBe(200);
    return res.json() as Suite;
  }

  /** Poll until the run is no longer `running` (bounded — a hung run fails the test, not the suite). */
  async function waitCompleted(app: FastifyInstance, runId: string): Promise<Suite> {
    for (let i = 0; i < 200; i++) {
      const run = await getRun(app, runId);
      if (run.status === 'completed') return run;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`run ${runId} did not complete`);
  }

  async function runAndWait(app: FastifyInstance, agentId: string): Promise<Suite> {
    const res = await startRun(app, agentId);
    expect(res.statusCode).toBe(202);
    return waitCompleted(app, (res.json() as { run_id: string }).run_id);
  }

  async function count(table: typeof t.agentRuns | typeof t.reviews | typeof t.findings | typeof t.runTraces) {
    const [row] = await pg.handle.db.select({ n: sql<number>`count(*)::int` }).from(table);
    return row!.n;
  }

  // ------------------------------------------------------------ freezing a case

  it('an accepted finding becomes a frozen must_find case (201)', async () => {
    const app = await makeApp();
    const agentId = await newAgent();
    const findingId = await newFinding({ agentId, triage: 'accepted', line: 3 });

    const { res, body } = await freeze(app, findingId);
    expect(res.statusCode).toBe(201);
    expect(body).toMatchObject({ created: true, owner_id: agentId, notes: 'The branch is never asserted.' });
    expect(body.name).toBe('original-finding-at-line-3');
    expect(body.input_diff.startsWith('diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@')).toBe(true);
    expect(body.input_files).toEqual(['src/a.ts']);
    expect(body.input_meta).toMatchObject({
      source_finding_id: findingId,
      pr_number: 42,
      pr_title: 'Add the thing',
      pr_body: 'This PR adds the thing.',
    });
    expect(body.expected_output).toMatchObject({
      type: 'must_find',
      file: 'src/a.ts',
      start_line: 3,
      end_line: 3,
      severity: 'WARNING',
      category: 'test',
    });
  });

  it('a dismissed finding becomes a must_not_flag case', async () => {
    const app = await makeApp();
    const agentId = await newAgent();
    const { res, body } = await freeze(app, await newFinding({ agentId, triage: 'dismissed' }));
    expect(res.statusCode).toBe(201);
    expect(body.expected_output.type).toBe('must_not_flag');
  });

  it('refuses an untriaged finding (422 finding_not_triaged)', async () => {
    const app = await makeApp();
    const agentId = await newAgent();
    const { res } = await freeze(app, await newFinding({ agentId, triage: 'open' }));
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('finding_not_triaged');
  });

  it('refuses a finding whose review has no agent (422 finding_has_no_agent)', async () => {
    const app = await makeApp();
    const { res } = await freeze(app, await newFinding({ agentId: null, triage: 'accepted' }));
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('finding_has_no_agent');
  });

  it('refuses a finding whose file has no stored diff (422 no_diff_available)', async () => {
    const app = await makeApp();
    const agentId = await newAgent();
    const { res } = await freeze(app, await newFinding({ agentId, triage: 'accepted', file: 'src/nopatch.ts' }));
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('no_diff_available');
  });

  it('refuses a finding that points outside its own diff (422 expectation_not_grounded)', async () => {
    const app = await makeApp();
    const agentId = await newAgent();
    const { res } = await freeze(app, await newFinding({ agentId, triage: 'accepted', line: 400 }));
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('expectation_not_grounded');
  });

  it('is idempotent: the second click is a 200 with the same case, and re-triage changes nothing', async () => {
    const app = await makeApp();
    const agentId = await newAgent();
    const findingId = await newFinding({ agentId, triage: 'accepted' });

    const first = await freeze(app, findingId);
    expect(first.res.statusCode).toBe(201);

    // The reviewer changes their mind after the case exists.
    await pg.handle.db
      .update(t.findings)
      .set({ acceptedAt: null, dismissedAt: new Date() })
      .where(eq(t.findings.id, findingId));

    const second = await freeze(app, findingId);
    expect(second.res.statusCode).toBe(200);
    expect(second.body).toMatchObject({ id: first.body.id, created: false });
    expect(second.body.expected_output.type).toBe('must_find');

    const list = await app.inject({ url: `/agents/${agentId}/eval-cases` });
    const cases = list.json() as { case: { id: string }; expectation: { type: string }; last_result: string }[];
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ expectation: { type: 'must_find' }, last_result: 'never_run' });
  });

  it('is tenant-scoped: another workspace gets 404 for the finding, the case and the run', async () => {
    const appA = await makeApp();
    const { agentId, caseIds } = await agentWithCases(appA);
    const started = await startRun(appA, agentId);
    const runId = (started.json() as { run_id: string }).run_id;
    await waitCompleted(appA, runId);
    const findingId = await newFinding({ agentId, triage: 'accepted', line: 5 });

    const appB = await makeApp(new ScriptedLLM(), workspaceB);
    expect((await freeze(appB, findingId)).res.statusCode).toBe(404);
    expect((await appB.inject({ method: 'DELETE', url: `/eval-cases/${caseIds[0]}` })).statusCode).toBe(404);
    expect((await appB.inject({ url: `/eval-runs/${runId}` })).statusCode).toBe(404);
    expect((await appB.inject({ url: `/agents/${agentId}/eval-cases` })).statusCode).toBe(404);
    expect((await startRun(appB, agentId)).statusCode).toBe(404);

    const cmp = await appB.inject({ url: `/eval-runs/compare?a=${runId}&b=${crypto.randomUUID()}` });
    expect(cmp.statusCode).toBe(404);
    // Still there for its own workspace.
    expect((await appA.inject({ url: `/eval-runs/${runId}` })).statusCode).toBe(200);
  });

  // -------------------------------------------------------------------- a run

  it('runs every case, scores by code, and writes nothing to the review tables', async () => {
    const llm = new ScriptedLLM();
    llm.fixture = reviewOf(finding(3));
    const app = await makeApp(llm);
    const { agentId, caseIds } = await agentWithCases(app);
    const before = [await count(t.agentRuns), await count(t.reviews), await count(t.findings), await count(t.runTraces)];

    const res = await startRun(app, agentId);
    expect(res.statusCode).toBe(202);
    const started = res.json() as { run_id: string; cases_total: number };
    expect(started.cases_total).toBe(2);

    const run = await waitCompleted(app, started.run_id);
    expect(run).toMatchObject({
      agent_id: agentId,
      agent_version: 1,
      cases_total: 2,
      cases_done: 2,
      recall: 1,
      precision: 1,
      citation_accuracy: 1,
      traces_passed: 2,
      traces_total: 2,
      cases_errored: 0,
    });
    expect(run.cost_usd).toBeCloseTo(0.002);
    expect(run.per_case.map((c) => c.status)).toEqual(['completed', 'completed']);

    // Every row carries its own metrics; recall is only defined for a must_find case.
    const rows = await pg.handle.db.select().from(t.evalRuns).where(inArray(t.evalRuns.caseId, caseIds));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.pass).toBe(true);
      expect(row.citationAccuracy).toBe(1);
      expect(row.durationMs).not.toBeNull();
      expect(row.costUsd).not.toBeNull();
      expect((row.actualOutput as { run_id: string }).run_id).toBe(started.run_id);
    }
    expect(rows.filter((r) => r.recall === 1)).toHaveLength(1);
    expect(rows.filter((r) => r.recall === null)).toHaveLength(1);

    const cases = (await app.inject({ url: `/agents/${agentId}/eval-cases` })).json() as {
      last_result: string;
      last_run_id: string;
    }[];
    expect(cases.map((c) => c.last_result)).toEqual(['pass', 'pass']);
    expect(cases[0]!.last_run_id).toBe(started.run_id);

    const runs = (await app.inject({ url: `/agents/${agentId}/eval-runs` })).json() as Suite[];
    expect(runs.map((r) => r.run_id)).toEqual([started.run_id]);

    expect([await count(t.agentRuns), await count(t.reviews), await count(t.findings), await count(t.runTraces)]).toEqual(
      before,
    );
  });

  it('scores a missed must_find and a flagged must_not_flag as failures', async () => {
    const llm = new ScriptedLLM();
    llm.fixture = reviewOf(finding(9));
    const app = await makeApp(llm);
    const { agentId } = await agentWithCases(app);

    const run = await runAndWait(app, agentId);
    expect(run).toMatchObject({ recall: 0, precision: 0, traces_passed: 0, traces_total: 2 });
  });

  it('answers 409 run_in_flight while a run is executing', async () => {
    const llm = new ScriptedLLM();
    let release!: () => void;
    llm.gate = new Promise<void>((r) => (release = r));
    const app = await makeApp(llm);
    const { agentId } = await agentWithCases(app);

    const first = await startRun(app, agentId);
    expect(first.statusCode).toBe(202);
    const second = await startRun(app, agentId);
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('run_in_flight');

    const runId = (first.json() as { run_id: string }).run_id;
    expect((await getRun(app, runId)).status).toBe('running');
    release();
    await waitCompleted(app, runId);
  });

  it('rate-limits the run start: the 6th POST within a minute answers 429', async () => {
    const app = await makeApp(new ScriptedLLM(), workspaceA, 'development');
    // An unknown agent answers 404 without a model call; the limiter counts every request.
    const url = `/agents/${crypto.randomUUID()}/eval-runs`;
    for (let i = 0; i < 5; i++) {
      expect((await app.inject({ method: 'POST', url })).statusCode).toBe(404);
    }
    expect((await app.inject({ method: 'POST', url })).statusCode).toBe(429);
  });

  it('refuses to start without cases (422 no_cases) or for an unknown agent (404)', async () => {
    const app = await makeApp();
    const res = await startRun(app, await newAgent());
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('no_cases');
    expect((await startRun(app, crypto.randomUUID())).statusCode).toBe(404);
  });

  it('refuses a provider that has no usable key (422 provider_not_configured)', async () => {
    const app = await makeApp(); // only openrouter is injected
    const agentId = await newAgent('openai');
    expect((await freeze(app, await newFinding({ agentId, triage: 'accepted' }))).res.statusCode).toBe(201);
    const res = await startRun(app, agentId);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('provider_not_configured');
  });

  it('records a throwing case as errored and finishes the rest', async () => {
    const llm = new ScriptedLLM();
    llm.fixture = reviewOf(finding(3));
    llm.failCalls.add(2);
    const app = await makeApp(llm);
    const { agentId } = await agentWithCases(app, 1); // three cases

    const run = await runAndWait(app, agentId);
    expect(run.per_case.map((c) => c.status).sort()).toEqual(['completed', 'completed', 'errored']);
    expect(run).toMatchObject({ cases_errored: 1, traces_total: 2, cases_done: 3 });
    expect(run.per_case.find((c) => c.status === 'errored')!.reason).toContain('scripted failure');
  });

  it('survives a case deleted while the run is in flight', async () => {
    const llm = new ScriptedLLM();
    llm.fixture = reviewOf(finding(3));
    let release!: () => void;
    llm.gate = new Promise<void>((r) => (release = r));
    const app = await makeApp(llm);
    const { agentId, caseIds } = await agentWithCases(app);

    const started = (await startRun(app, agentId)).json() as { run_id: string };
    expect((await app.inject({ method: 'DELETE', url: `/eval-cases/${caseIds[1]}` })).statusCode).toBe(204);
    release();
    const run = await waitCompleted(app, started.run_id);
    expect(run.per_case).toHaveLength(1);
    expect(run.per_case[0]!.status).toBe('completed');
  });

  it('reconciles a row pending past the timeout to errored, and leaves a fresh one running', async () => {
    const app = await makeApp();
    const { agentId, caseIds } = await agentWithCases(app);
    const staleRun = crypto.randomUUID();
    const freshRun = crypto.randomUUID();
    const pending = (runId: string) => ({ run_id: runId, agent_id: agentId, agent_version: 1, status: 'pending' });
    await pg.handle.db.insert(t.evalRuns).values([
      { caseId: caseIds[0]!, actualOutput: pending(staleRun), ranAt: new Date(Date.now() - 16 * 60 * 1000) },
      { caseId: caseIds[0]!, actualOutput: pending(freshRun), ranAt: new Date(Date.now() - 60 * 1000) },
    ]);

    const stale = await getRun(app, staleRun);
    expect(stale.status).toBe('completed');
    expect(stale.per_case[0]).toMatchObject({ status: 'errored', reason: 'timeout' });
    expect(stale.cases_errored).toBe(1);
    expect((await getRun(app, freshRun)).status).toBe('running');
  });

  // ------------------------------------------------------------ compare + more

  it('compares two versions of an agent: deltas, flips and the prompt diff (v1 snapshot included)', async () => {
    const llm = new ScriptedLLM();
    llm.fixture = reviewOf(finding(3)); // v1: finds the accepted one, leaves the dismissed one alone
    const app = await makeApp(llm);
    const { agentId } = await agentWithCases(app);

    const v1 = await runAndWait(app, agentId);
    expect(v1.agent_version).toBe(1);

    const put = await app.inject({
      method: 'PUT',
      url: `/agents/${agentId}`,
      payload: { system_prompt: 'Review the diff carefully.\nAlso be terse.' },
    });
    expect(put.statusCode).toBe(200);
    llm.fixture = reviewOf(); // v2: finds nothing, so the must_find case regresses

    const v2 = await runAndWait(app, agentId);
    expect(v2.agent_version).toBe(2);

    const res = await app.inject({ url: `/eval-runs/compare?a=${v1.run_id}&b=${v2.run_id}` });
    expect(res.statusCode).toBe(200);
    const cmp = res.json() as {
      a: Suite;
      b: Suite;
      delta: { recall: number; precision: number | null };
      flips: { direction: string }[];
      only_in_a: unknown[];
      only_in_b: unknown[];
      prompt_available: boolean;
      prompt_diff: { op: string; text: string }[];
    };
    expect(cmp.delta.recall).toBe(-1);
    expect(cmp.delta.precision).toBeNull(); // v2 has no TP and no FP, so precision is not computable
    expect(cmp.flips.map((f) => f.direction)).toEqual(['pass_to_fail']);
    expect(cmp.only_in_a).toEqual([]);
    expect(cmp.only_in_b).toEqual([]);
    expect(cmp.prompt_available).toBe(true);
    expect(cmp.prompt_diff).toEqual([
      { op: 'same', text: 'Review the diff carefully.' },
      { op: 'add', text: 'Also be terse.' },
    ]);

    // The run list is newest first, and the dashboard reads the newest completed run.
    const runs = (await app.inject({ url: `/agents/${agentId}/eval-runs` })).json() as Suite[];
    expect(runs.map((r) => r.run_id)).toEqual([v2.run_id, v1.run_id]);

    const dash = (await app.inject({ url: '/eval/dashboard' })).json() as {
      agents: { agent_id: string; cases_total: number; latest: { agent_version: number } | null; trend: unknown[] }[];
      recent_runs: { run_id: string; agent_name: string }[];
    };
    const row = dash.agents.find((a) => a.agent_id === agentId);
    expect(row).toMatchObject({ cases_total: 2, latest: { agent_version: 2 } });
    expect(row!.trend).toHaveLength(2);
    expect(dash.recent_runs[0]!.run_id).toBe(v2.run_id);
    expect(dash.recent_runs[0]!.agent_name).toMatch(/^Eval Agent/);
  });

  it('compares with prompt_available false when a run’s agent_version row is gone', async () => {
    const llm = new ScriptedLLM();
    llm.fixture = reviewOf(finding(3));
    const app = await makeApp(llm);
    const { agentId } = await agentWithCases(app);
    const v1 = await runAndWait(app, agentId);
    await app.inject({ method: 'PUT', url: `/agents/${agentId}`, payload: { system_prompt: 'Changed prompt.' } });
    const v2 = await runAndWait(app, agentId);

    await pg.handle.db
      .delete(t.agentVersions)
      .where(and(eq(t.agentVersions.agentId, agentId), eq(t.agentVersions.version, v1.agent_version)));

    const res = await app.inject({ url: `/eval-runs/compare?a=${v1.run_id}&b=${v2.run_id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ prompt_available: false, prompt_diff: [] });
  });

  it('refuses to compare a run with itself or runs of different agents (422 invalid_compare)', async () => {
    const llm = new ScriptedLLM();
    llm.fixture = reviewOf(finding(3));
    const app = await makeApp(llm);
    const one = await agentWithCases(app);
    const two = await agentWithCases(app);
    const runOne = await runAndWait(app, one.agentId);
    const runTwo = await runAndWait(app, two.agentId);

    const same = await app.inject({ url: `/eval-runs/compare?a=${runOne.run_id}&b=${runOne.run_id}` });
    expect(same.statusCode).toBe(422);
    expect(same.json().error.code).toBe('invalid_compare');

    const across = await app.inject({ url: `/eval-runs/compare?a=${runOne.run_id}&b=${runTwo.run_id}` });
    expect(across.statusCode).toBe(422);
    expect(across.json().error.code).toBe('invalid_compare');
  });

  it('deleting a case answers 204 and takes its run rows with it', async () => {
    const llm = new ScriptedLLM();
    llm.fixture = reviewOf(finding(3));
    const app = await makeApp(llm);
    const { agentId, caseIds } = await agentWithCases(app);
    await runAndWait(app, agentId);

    expect((await app.inject({ method: 'DELETE', url: `/eval-cases/${caseIds[0]}` })).statusCode).toBe(204);
    const rows = await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.caseId, caseIds[0]!));
    expect(rows).toHaveLength(0);
    const remaining = (await app.inject({ url: `/agents/${agentId}/eval-cases` })).json() as unknown[];
    expect(remaining).toHaveLength(1);
  });

  // ------------------------------------------------------- run all agents (AC35)

  interface RunAllEntry {
    agent_id: string;
    agent_name: string;
    run_id: string | null;
    refused_reason: string | null;
  }

  /** Freezes one accepted case per line for `agentId`, as the app of that workspace. */
  async function addCases(app: FastifyInstance, agentId: string, workspaceId: string, lines: number[]) {
    for (const line of lines) {
      const findingId = await newFinding({ agentId, triage: 'accepted', line, workspaceId });
      expect((await freeze(app, findingId)).res.statusCode).toBe(201);
    }
  }

  it('AC35: run-all starts every agent with cases through the single-agent start path and refuses the rest one by one', async () => {
    const llm = new ScriptedLLM();
    llm.fixture = reviewOf(finding(3));
    let release!: () => void;
    llm.gate = new Promise<void>((r) => (release = r));
    const app = await makeApp(llm, workspaceC);

    const x = await newAgent('openrouter', workspaceC); // 2 cases, starts
    const y = await newAgent('openai', workspaceC); //     1 case, no usable key
    const z = await newAgent('openrouter', workspaceC); // 1 case, already running
    const w = await newAgent('openrouter', workspaceC); // 0 cases, not listed
    await addCases(app, x, workspaceC, [3, 4]);
    await addCases(app, y, workspaceC, [3]);
    await addCases(app, z, workspaceC, [3]);

    // Z's run is started first and held on the gate, so run-all meets it in flight.
    const zRun = await startRun(app, z);
    expect(zRun.statusCode).toBe(202);
    const zRunId = (zRun.json() as { run_id: string }).run_id;

    const res = await app.inject({ method: 'POST', url: '/eval/runs/all', payload: { confirm: true } });
    expect(res.statusCode).toBe(202);
    const { started } = res.json() as { started: RunAllEntry[] };

    expect(started.map((e) => e.agent_id).sort()).toEqual([x, y, z].sort());
    expect(started.find((e) => e.agent_id === w)).toBeUndefined();
    const byId = (id: string) => started.find((e) => e.agent_id === id)!;

    expect(byId(x).agent_name).toMatch(/^Eval Agent \d+$/);
    expect(byId(x).run_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(byId(x).refused_reason).toBeNull();
    expect(byId(y)).toMatchObject({ run_id: null, refused_reason: 'provider_not_configured' });
    expect(byId(z)).toMatchObject({ run_id: null, refused_reason: 'run_in_flight' });
    for (const e of started) expect(e.agent_name.length).toBeGreaterThan(0);

    // Y was refused before any row was written.
    const yCases = (await app.inject({ url: `/agents/${y}/eval-cases` })).json() as { case: { id: string } }[];
    const yRows = await pg.handle.db
      .select()
      .from(t.evalRuns)
      .where(inArray(t.evalRuns.caseId, yCases.map((c) => c.case.id)));
    expect(yRows).toHaveLength(0);

    // X's run is a normal suite run: same start path, so both of its cases ran.
    release();
    const xRun = await waitCompleted(app, byId(x).run_id!);
    expect(xRun).toMatchObject({ agent_id: x, cases_total: 2, cases_done: 2 });
    await waitCompleted(app, zRunId);
  });

  it.each([
    ['an empty body', {}],
    ['confirm: false', { confirm: false }],
  ])('AC35: run-all with %s is rejected at the edge and starts nothing', async (_label, payload) => {
    const app = await makeApp(new ScriptedLLM(), workspaceC);
    const [before] = await pg.handle.db.select({ n: sql<number>`count(*)::int` }).from(t.evalRuns);

    const res = await app.inject({ method: 'POST', url: '/eval/runs/all', payload });
    // The app maps every request-validation failure to 422 `validation_error` (app.ts error handler).
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');

    const [after] = await pg.handle.db.select({ n: sql<number>`count(*)::int` }).from(t.evalRuns);
    expect(after!.n).toBe(before!.n);
  });

  it('AC35: run-all is rate-limited to 2 per minute: the 3rd POST answers 429', async () => {
    // A workspace of its own with no cases, so the two allowed calls start nothing.
    const [empty] = await pg.handle.db.insert(t.workspaces).values({ name: `empty-${Date.now()}` }).returning();
    const app = await makeApp(new ScriptedLLM(), empty!.id, 'development');
    const post = () => app.inject({ method: 'POST', url: '/eval/runs/all', payload: { confirm: true } });

    for (let i = 0; i < 2; i++) {
      const res = await post();
      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ started: [] });
    }
    expect((await post()).statusCode).toBe(429);
  });

  it('AC33: a case stored with the legacy `title · file:line` name is listed unchanged', async () => {
    const app = await makeApp();
    const agentId = await newAgent();
    const legacyName = 'old-title · src/a.ts:3';
    const [row] = await pg.handle.db
      .insert(t.evalCases)
      .values({
        workspaceId: workspaceA,
        ownerKind: 'agent',
        ownerId: agentId,
        name: legacyName,
        inputDiff: `diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n${PATCH}`,
        inputFiles: ['src/a.ts'],
        inputMeta: { source_finding_id: '00000000-0000-4000-8000-000000000001', pr_number: 42, pr_title: 'Add the thing', pr_body: '' },
        expectedOutput: {
          type: 'must_find',
          file: 'src/a.ts',
          start_line: 3,
          end_line: 3,
          severity: 'WARNING',
          category: 'test',
          title: 'old title',
        },
        notes: 'rationale',
      })
      .returning();

    const res = await app.inject({ url: `/agents/${agentId}/eval-cases` });
    expect(res.statusCode).toBe(200);
    const cases = res.json() as { case: { id: string; name: string }; last_result: string }[];
    expect(cases).toHaveLength(1);
    expect(cases[0]!.case).toMatchObject({ id: row!.id, name: legacyName });
    expect(cases[0]!.last_result).toBe('never_run');
  });

  // ================================================== case editor (SPEC-03, rev 6)

  /** `PATCH` framed as the case freezer frames it: new-side lines 1..12 are in the hunk. */
  const A_DIFF = `diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n${PATCH}`;
  /** New-side lines 1..3 of every file below are inside its hunk. */
  const fileDiff = (path: string) =>
    [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, '@@ -1,2 +1,3 @@', ' one', '+two', ' three'].join('\n');
  const TWO_FILE_DIFF = `${fileDiff('src/x.ts')}\n${fileDiff('src/y.ts')}`;

  const expectationAt = (line: number, over: Record<string, unknown> = {}) => ({
    type: 'must_find',
    file: 'src/a.ts',
    start_line: line,
    end_line: line,
    severity: 'WARNING',
    category: 'test',
    title: 'expected finding',
    ...over,
  });

  /** A hand-written case body: a two-file diff, expectation on `src/x.ts` line 2. */
  const handFields = (over: Record<string, unknown> = {}) => ({
    name: 'hand-written',
    notes: 'why it matters',
    pr_title: 'Hand PR',
    pr_body: 'Hand body',
    input_diff: TWO_FILE_DIFF,
    expectation: expectationAt(2, { file: 'src/x.ts' }),
    ...over,
  });

  /** A body for `src/a.ts` + `PATCH`, expecting a finding at `line`. */
  const aFields = (line: number, over: Record<string, unknown> = {}) => ({
    name: `a-case-${line}`,
    notes: null,
    pr_title: 'Add the thing',
    pr_body: 'This PR adds the thing.',
    input_diff: A_DIFF,
    expectation: expectationAt(line),
    ...over,
  });

  /** A hand-written case inserted straight into the table, so edit tests do not depend on the create route. */
  async function insertHandCase(agentId: string, line = 3, over: { name?: string; workspaceId?: string } = {}) {
    seq += 1;
    const [row] = await pg.handle.db
      .insert(t.evalCases)
      .values({
        workspaceId: over.workspaceId ?? workspaceA,
        ownerKind: 'agent',
        ownerId: agentId,
        name: over.name ?? `hand-case-${seq}`,
        inputDiff: A_DIFF,
        inputFiles: ['src/a.ts'],
        inputMeta: { pr_title: 'Hand PR', pr_body: 'Hand body', created_at: new Date().toISOString() },
        expectedOutput: expectationAt(line),
        notes: null,
      })
      .returning();
    return row!.id;
  }

  async function caseRow(id: string) {
    const [row] = await pg.handle.db.select().from(t.evalCases).where(eq(t.evalCases.id, id));
    return row!;
  }

  async function countOf(table: PgTable): Promise<number> {
    const [row] = await pg.handle.db.select({ n: sql<number>`count(*)::int` }).from(table);
    return row!.n;
  }

  /** Row counts of every table an eval write could touch. */
  async function storeCounts() {
    return [t.evalCases, t.evalRuns, t.agentRuns, t.reviews, t.findings, t.runTraces].map((tbl) => countOf(tbl));
  }

  interface CaseListEntry {
    case: { id: string };
    running: boolean;
    last_result: string;
    last_run_id: string | null;
    last_matched: number | null;
  }
  async function listCases(app: FastifyInstance, agentId: string): Promise<CaseListEntry[]> {
    const res = await app.inject({ url: `/agents/${agentId}/eval-cases` });
    expect(res.statusCode).toBe(200);
    return res.json() as CaseListEntry[];
  }

  /** Bounded poll; a hung condition fails the test, not the suite. */
  async function waitFor(check: () => Promise<boolean>, what: string) {
    for (let i = 0; i < 200; i++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect.fail(`timed out waiting for ${what}`);
  }

  /** One-case runs have no detail route: completion is read off the case list. */
  async function waitIdle(app: FastifyInstance, agentId: string) {
    await waitFor(async () => (await listCases(app, agentId)).every((c) => !c.running), 'every case to stop running');
  }

  async function startCaseRun(app: FastifyInstance, caseId: string) {
    return app.inject({ method: 'POST', url: `/eval-cases/${caseId}/runs` });
  }

  async function dryRun(app: FastifyInstance, agentId: string, payload: unknown) {
    return app.inject({ method: 'POST', url: `/agents/${agentId}/eval-cases/dry-run`, payload: payload as object });
  }

  /** A provider held on a gate; `release()` is idempotent so a failed test can always let go. */
  function gatedLLM() {
    const llm = new ScriptedLLM();
    let open!: () => void;
    llm.gate = new Promise<void>((r) => (open = r));
    return { llm, release: () => open() };
  }

  /** Waits until the provider has been entered, i.e. a held run is really in flight. */
  async function waitForProviderCall(llm: ScriptedLLM, calls = 1) {
    await waitFor(async () => llm.callCount >= calls, `${calls} provider call(s)`);
  }

  const errorCode = (res: { json: () => unknown }) => (res.json() as { error: { code: string } }).error.code;

  // ----------------------------------------------------------- draft and save

  describe('case editor: draft and save', () => {
    it('AC39: drafts an accepted finding without storing anything', async () => {
      const llm = new ScriptedLLM();
      const app = await makeApp(llm);
      const agentId = await newAgent();
      const findingId = await newFinding({ agentId, triage: 'accepted', line: 3 });
      const before = await countOf(t.evalCases);

      const res = await app.inject({ url: `/findings/${findingId}/eval-case-draft` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.agent_id).toBe(agentId);
      expect(body.existing_case).toBeNull();
      expect(body.draft).toMatchObject({
        name: 'original-finding-at-line-3',
        input_files: ['src/a.ts'],
        pr_title: 'Add the thing',
        pr_body: 'This PR adds the thing.',
        notes: 'The branch is never asserted.',
        expectation: { type: 'must_find', file: 'src/a.ts', start_line: 3, end_line: 3 },
      });
      expect(body.draft.input_diff.startsWith('diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@')).toBe(
        true,
      );
      expect(await countOf(t.evalCases)).toBe(before);
      expect(llm.callCount).toBe(0);
    });

    it('AC42: a draft of a finding with an over-long rationale is clipped to 4096 and saves unedited (201)', async () => {
      const app = await makeApp();
      const agentId = await newAgent();
      const findingId = await newFinding({ agentId, triage: 'accepted', line: 3, rationale: 'r'.repeat(5000) });

      const draft = (await app.inject({ url: `/findings/${findingId}/eval-case-draft` })).json().draft;
      expect(draft.notes).toHaveLength(4096);

      const save = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case`, payload: draft });
      expect(save.statusCode).toBe(201);
      expect((await caseRow(save.json().id)).notes).toHaveLength(4096);
    });

    it('AC40: refuses to draft an untriaged finding (422 finding_not_triaged)', async () => {
      const app = await makeApp();
      const agentId = await newAgent();
      const res = await app.inject({ url: `/findings/${await newFinding({ agentId, triage: 'open' })}/eval-case-draft` });
      expect(res.statusCode).toBe(422);
      expect(errorCode(res)).toBe('finding_not_triaged');
    });

    it('AC40: refuses to draft a finding whose review has no agent (422 finding_has_no_agent)', async () => {
      const app = await makeApp();
      const res = await app.inject({
        url: `/findings/${await newFinding({ agentId: null, triage: 'accepted' })}/eval-case-draft`,
      });
      expect(res.statusCode).toBe(422);
      expect(errorCode(res)).toBe('finding_has_no_agent');
    });

    it('AC40: refuses to draft a finding whose file has no stored diff (422 no_diff_available)', async () => {
      const app = await makeApp();
      const agentId = await newAgent();
      const findingId = await newFinding({ agentId, triage: 'accepted', file: 'src/nopatch.ts' });
      const res = await app.inject({ url: `/findings/${findingId}/eval-case-draft` });
      expect(res.statusCode).toBe(422);
      expect(errorCode(res)).toBe('no_diff_available');
    });

    it('AC40: refuses to draft a finding whose file diff is over 200 KB (422 frozen_diff_too_large)', async () => {
      const app = await makeApp();
      const agentId = await newAgent();
      await pg.handle.db
        .insert(t.prFiles)
        .values({ prId, path: 'src/big.ts', patch: `@@ -1,1 +1,1 @@\n+${'x'.repeat(210 * 1024)}` });
      const findingId = await newFinding({ agentId, triage: 'accepted', file: 'src/big.ts', line: 1 });
      const res = await app.inject({ url: `/findings/${findingId}/eval-case-draft` });
      expect(res.statusCode).toBe(422);
      expect(errorCode(res)).toBe('frozen_diff_too_large');
    });

    it('AC40: refuses to draft a finding that points outside its own diff (422 expectation_not_grounded)', async () => {
      const app = await makeApp();
      const agentId = await newAgent();
      const res = await app.inject({
        url: `/findings/${await newFinding({ agentId, triage: 'accepted', line: 40 })}/eval-case-draft`,
      });
      expect(res.statusCode).toBe(422);
      expect(errorCode(res)).toBe('expectation_not_grounded');
    });

    it('AC40: a finding reached from another workspace is a 404', async () => {
      const agentId = await newAgent();
      const findingId = await newFinding({ agentId, triage: 'accepted' });
      const appB = await makeApp(new ScriptedLLM(), workspaceB);
      expect((await appB.inject({ url: `/findings/${findingId}/eval-case-draft` })).statusCode).toBe(404);
    });

    it('AC41: after a freeze the draft route answers with the existing case and no draft', async () => {
      const app = await makeApp();
      const agentId = await newAgent();
      const findingId = await newFinding({ agentId, triage: 'accepted' });
      const first = await freeze(app, findingId);
      expect(first.res.statusCode).toBe(201);

      const res = await app.inject({ url: `/findings/${findingId}/eval-case-draft` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.existing_case).toMatchObject({ id: first.body.id });
      expect(body.draft).toBeNull();
    });

    it('AC42: saving a finding with a body stores the edited fields, keeps the frozen diff and type, and is idempotent', async () => {
      const llm = new ScriptedLLM();
      const app = await makeApp(llm);
      const agentId = await newAgent();
      const findingId = await newFinding({ agentId, triage: 'dismissed', line: 3 });
      const draft = (await app.inject({ url: `/findings/${findingId}/eval-case-draft` })).json().draft;

      const first = await app.inject({
        method: 'POST',
        url: `/findings/${findingId}/eval-case`,
        payload: {
          name: '  renamed  ',
          notes: 'n',
          pr_title: 'T2',
          pr_body: 'B2',
          expectation: {
            file: 'src/a.ts',
            start_line: 2,
            end_line: 4,
            severity: 'CRITICAL',
            category: 'security',
            title: 'X',
          },
        },
      });
      expect(first.statusCode).toBe(201);
      expect(first.json().name).toBe('renamed');
      const stored = await caseRow(first.json().id);
      expect(stored.name).toBe('renamed');
      expect(stored.notes).toBe('n');
      expect(stored.inputDiff).toBe(A_DIFF);
      expect(stored.inputDiff).toBe(draft.input_diff);
      expect(stored.inputMeta).toMatchObject({ source_finding_id: findingId, pr_title: 'T2', pr_body: 'B2' });
      expect(stored.expectedOutput).toMatchObject({
        type: 'must_not_flag',
        file: 'src/a.ts',
        start_line: 2,
        end_line: 4,
        severity: 'CRITICAL',
        category: 'security',
        title: 'X',
      });

      // A second save with a different body, and a third with none, change nothing.
      const second = await app.inject({
        method: 'POST',
        url: `/findings/${findingId}/eval-case`,
        payload: {
          name: 'another-name',
          expectation: { file: 'src/a.ts', start_line: 5, end_line: 5, severity: 'SUGGESTION', category: 'style', title: 'Y' },
        },
      });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toMatchObject({ id: first.json().id, created: false, name: 'renamed' });
      const third = await freeze(app, findingId);
      expect(third.res.statusCode).toBe(200);
      expect(third.body).toMatchObject({ id: first.json().id, created: false, name: 'renamed' });
      expect(await caseRow(first.json().id)).toEqual(stored);
      expect(llm.callCount).toBe(0);
    });

    it('AC43: creates a hand-written two-file case owned by the agent', async () => {
      const llm = new ScriptedLLM();
      const app = await makeApp(llm);
      const agentId = await newAgent();

      const res = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-cases`, payload: handFields() });
      expect(res.statusCode).toBe(201);
      const body = res.json() as Created;
      expect(body).toMatchObject({ owner_id: agentId, name: 'hand-written', input_files: ['src/x.ts', 'src/y.ts'] });
      expect(body.input_meta.source_finding_id ?? null).toBeNull();
      expect(body.input_meta).toMatchObject({ pr_title: 'Hand PR', pr_body: 'Hand body' });

      const listed = await listCases(app, agentId);
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ case: { id: body.id }, running: false, last_result: 'never_run' });
      expect(llm.callCount).toBe(0);
    });
  });

  // ------------------------------------------------------ validation and edit

  describe('case editor: validation and edit', () => {
    const create = (app: FastifyInstance, agentId: string, over: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: `/agents/${agentId}/eval-cases`, payload: handFields(over) });

    it('AC45: create refuses a bare hunk (422 invalid_diff)', async () => {
      const app = await makeApp();
      const res = await create(app, await newAgent(), { input_diff: '@@ -1 +1 @@\n+x' });
      expect(res.statusCode).toBe(422);
      expect(errorCode(res)).toBe('invalid_diff');
    });

    it('AC48: create refuses a blank name (422 invalid_name)', async () => {
      const app = await makeApp();
      const res = await create(app, await newAgent(), { name: '   ' });
      expect(res.statusCode).toBe(422);
      expect(errorCode(res)).toBe('invalid_name');
    });

    it('AC46: create refuses a 210 KB diff (422 frozen_diff_too_large, not a framework error)', async () => {
      const app = await makeApp();
      const res = await create(app, await newAgent(), { input_diff: `${TWO_FILE_DIFF}\n+${'x'.repeat(210 * 1024)}` });
      expect(res.statusCode).toBe(422);
      expect(errorCode(res)).toBe('frozen_diff_too_large');
    });

    it('AC46: a 1.5 MiB diff still reaches the service (the route body limit is above Fastify’s 1 MiB default)', async () => {
      const app = await makeApp();
      const res = await create(app, await newAgent(), { input_diff: `${TWO_FILE_DIFF}\n+${'x'.repeat(1_500_000)}` });
      expect(res.statusCode).toBe(422);
      expect(errorCode(res)).toBe('frozen_diff_too_large');
    });

    it('AC47: create refuses an expectation on a file that is not in the diff (422 expectation_not_grounded)', async () => {
      const app = await makeApp();
      const res = await create(app, await newAgent(), { expectation: expectationAt(2, { file: 'src/nowhere.ts' }) });
      expect(res.statusCode).toBe(422);
      expect(errorCode(res)).toBe('expectation_not_grounded');
    });

    it('AC49: PUT on a hand-written case stores the new fields and recomputes input_files', async () => {
      const llm = new ScriptedLLM();
      const app = await makeApp(llm);
      const agentId = await newAgent();
      const caseId = await insertHandCase(agentId);

      const res = await app.inject({
        method: 'PUT',
        url: `/eval-cases/${caseId}`,
        payload: handFields({ name: 'renamed-by-hand' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        id: caseId,
        name: 'renamed-by-hand',
        input_diff: TWO_FILE_DIFF,
        input_files: ['src/x.ts', 'src/y.ts'],
        expected_output: { file: 'src/x.ts', start_line: 2 },
      });
      const stored = await caseRow(caseId);
      expect(stored).toMatchObject({ name: 'renamed-by-hand', inputDiff: TWO_FILE_DIFF, inputFiles: ['src/x.ts', 'src/y.ts'] });

      // A bare hunk is refused and the case stays exactly as it was.
      const bad = await app.inject({
        method: 'PUT',
        url: `/eval-cases/${caseId}`,
        payload: handFields({ input_diff: '@@ -1 +1 @@\n+x' }),
      });
      expect(bad.statusCode).toBe(422);
      expect(errorCode(bad)).toBe('invalid_diff');
      expect(await caseRow(caseId)).toEqual(stored);
      expect(llm.callCount).toBe(0);
    });

    it('AC49: PUT from another workspace, or for an unknown case, is a 404', async () => {
      const agentId = await newAgent();
      const caseId = await insertHandCase(agentId);
      const before = await caseRow(caseId);
      const appB = await makeApp(new ScriptedLLM(), workspaceB);

      const other = await appB.inject({ method: 'PUT', url: `/eval-cases/${caseId}`, payload: handFields() });
      expect(other.statusCode).toBe(404);
      const unknown = await appB.inject({
        method: 'PUT',
        url: `/eval-cases/${crypto.randomUUID()}`,
        payload: handFields(),
      });
      expect(unknown.statusCode).toBe(404);
      expect(await caseRow(caseId)).toEqual(before);
    });

    it('AC50: PUT cannot flip the type or change the diff of a from-finding case (422 locked_field); a rename is fine', async () => {
      const llm = new ScriptedLLM();
      const app = await makeApp(llm);
      const agentId = await newAgent();
      const findingId = await newFinding({ agentId, triage: 'accepted', line: 3 });
      const { res: frozen, body } = await freeze(app, findingId);
      expect(frozen.statusCode).toBe(201);
      const put = (over: Record<string, unknown>) =>
        app.inject({
          method: 'PUT',
          url: `/eval-cases/${body.id}`,
          payload: {
            name: body.name,
            notes: body.notes,
            pr_title: 'Add the thing',
            pr_body: 'This PR adds the thing.',
            input_diff: body.input_diff,
            expectation: body.expected_output,
            ...over,
          },
        });
      const before = await caseRow(body.id);

      const flipped = await put({ expectation: { ...body.expected_output, type: 'must_not_flag' } });
      expect(flipped.statusCode).toBe(422);
      expect(errorCode(flipped)).toBe('locked_field');

      // A valid, still-grounded diff, so only the lock can refuse it.
      const rediffed = await put({ input_diff: `${body.input_diff}\n+extra` });
      expect(rediffed.statusCode).toBe(422);
      expect(errorCode(rediffed)).toBe('locked_field');
      expect(await caseRow(body.id)).toEqual(before);

      const renamed = await put({ name: 'renamed-case', expectation: { ...body.expected_output, start_line: 4, end_line: 4 } });
      expect(renamed.statusCode).toBe(200);
      expect(renamed.json()).toMatchObject({ id: body.id, name: 'renamed-case' });
      const after = await caseRow(body.id);
      expect(after.inputMeta).toMatchObject({ source_finding_id: findingId });
      expect(after.expectedOutput).toMatchObject({ type: 'must_find', start_line: 4 });
      expect(llm.callCount).toBe(0);
    });
  });

  // ----------------------------------------------------------- frozen history

  describe('case editor: frozen history', () => {
    it('AC52: every row of a suite run stores the expectation its case had at the start', async () => {
      const llm = new ScriptedLLM();
      llm.fixture = reviewOf(finding(3));
      const app = await makeApp(llm);
      const { agentId, caseIds } = await agentWithCases(app);

      await runAndWait(app, agentId);

      const rows = await pg.handle.db.select().from(t.evalRuns).where(inArray(t.evalRuns.caseId, caseIds));
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        const owner = await caseRow(row.caseId);
        expect((row.actualOutput as { expectation?: unknown }).expectation).toEqual(owner.expectedOutput);
      }
    });

    it('AC51: a legacy row (no stored expectation) keeps its result, matched flag and run metrics after the case is edited', async () => {
      const llm = new ScriptedLLM();
      const app = await makeApp(llm);
      const agentId = await newAgent();
      const caseId = await insertHandCase(agentId, 3);

      // Legacy row R: scored against line 3 when it ran, and carrying no `expectation`.
      const runR = crypto.randomUUID();
      const [rowR] = await pg.handle.db
        .insert(t.evalRuns)
        .values({
          caseId,
          ranAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
          actualOutput: {
            run_id: runR,
            agent_id: agentId,
            agent_version: 1,
            status: 'completed',
            findings: [
              { file: 'src/a.ts', start_line: 3, end_line: 3, severity: 'WARNING', category: 'test', title: 'f' },
            ],
            grounding_kept: 1,
            grounding_dropped: 0,
            finished_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          },
          pass: true,
          recall: 1,
          precision: 1,
          citationAccuracy: 1,
          durationMs: 10,
          costUsd: 0.001,
        })
        .returning();

      // A later suite run L in which the model finds nothing, so the case fails.
      llm.fixture = reviewOf();
      const later = await runAndWait(app, agentId);
      const compareBefore = await app.inject({ url: `/eval-runs/compare?a=${runR}&b=${later.run_id}` });
      expect(compareBefore.statusCode).toBe(200);
      const runBefore = await getRun(app, runR);
      expect(runBefore.per_case[0]).toMatchObject({ pass: true, findings: [{ matched: true }] });

      const put = await app.inject({
        method: 'PUT',
        url: `/eval-cases/${caseId}`,
        payload: aFields(9, { name: 'moved-to-line-9' }),
      });
      expect(put.statusCode).toBe(200);

      const runAfter = await getRun(app, runR);
      expect(runAfter.per_case[0]).toMatchObject({ pass: true, findings: [{ matched: true }] });
      expect(runAfter).toMatchObject({ recall: runBefore.recall, precision: runBefore.precision });
      const compareAfter = await app.inject({ url: `/eval-runs/compare?a=${runR}&b=${later.run_id}` });
      // Flips carry the case's current display name, so compare identity and direction only.
      type Flip = { case_id: string; a_pass: boolean; b_pass: boolean; direction: string; name: string };
      const byIdentity = (flips: Flip[]) =>
        flips.map(({ case_id, a_pass, b_pass, direction }) => ({ case_id, a_pass, b_pass, direction }));
      const flipsBefore = compareBefore.json().flips as Flip[];
      const flipsAfter = compareAfter.json().flips as Flip[];
      expect(flipsBefore.length).toBeGreaterThan(0);
      expect(byIdentity(flipsAfter)).toEqual(byIdentity(flipsBefore));
      expect(flipsAfter.map((f) => f.name)).toEqual(['moved-to-line-9']);
      expect(compareAfter.json().delta).toEqual(compareBefore.json().delta);

      const [stored] = await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.id, rowR!.id));
      expect((stored!.actualOutput as { expectation: { start_line: number } }).expectation.start_line).toBe(3);
      expect(stored).toMatchObject({ pass: true, recall: 1, precision: 1, citationAccuracy: 1 });
    });

    it('AC53: a row still running when its case is edited is scored against the expectation read at the start', async () => {
      const { llm, release } = gatedLLM();
      llm.fixture = reviewOf(finding(3));
      const app = await makeApp(llm);
      const agentId = await newAgent();
      const caseId = await insertHandCase(agentId, 3);
      try {
        const started = await startRun(app, agentId);
        expect(started.statusCode).toBe(202);
        const runId = (started.json() as { run_id: string }).run_id;

        const put = await app.inject({
          method: 'PUT',
          url: `/eval-cases/${caseId}`,
          payload: aFields(9, { name: 'moved-mid-run' }),
        });
        expect(put.statusCode).toBe(200);

        release();
        const run = await waitCompleted(app, runId);
        expect(run.per_case[0]!.pass).toBe(true);
        const [row] = await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.caseId, caseId));
        expect(row!.pass).toBe(true);
        expect((row!.actualOutput as { expectation: { start_line: number } }).expectation.start_line).toBe(3);
      } finally {
        release();
      }
    });
  });

  // ------------------------------------------------------------ one-case runs

  describe('case editor: one-case runs', () => {
    it('AC54: starts a run of one case, marks its row, and makes one provider call', async () => {
      const llm = new ScriptedLLM();
      llm.fixture = reviewOf(finding(3));
      const app = await makeApp(llm);
      const { agentId, caseIds } = await agentWithCases(app);

      const res = await startCaseRun(app, caseIds[0]!);
      expect(res.statusCode).toBe(202);
      const started = res.json() as { run_id: string; cases_total: number };
      expect(started.cases_total).toBe(1);
      expect(started.run_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

      await waitIdle(app, agentId);
      const rows = await pg.handle.db.select().from(t.evalRuns).where(inArray(t.evalRuns.caseId, caseIds));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.actualOutput).toMatchObject({ run_id: started.run_id, one_case: true, status: 'completed' });
      expect(llm.callCount).toBe(1);
    });

    it('AC58: the case list shows only the running case as running, and clears it when the run ends', async () => {
      const { llm, release } = gatedLLM();
      llm.fixture = reviewOf(finding(3));
      const app = await makeApp(llm);
      const { agentId, caseIds } = await agentWithCases(app);
      try {
        expect((await startCaseRun(app, caseIds[0]!)).statusCode).toBe(202);
        const during = await listCases(app, agentId);
        expect(during.find((c) => c.case.id === caseIds[0])!.running).toBe(true);
        expect(during.find((c) => c.case.id === caseIds[1])!.running).toBe(false);

        release();
        await waitIdle(app, agentId);
        expect((await listCases(app, agentId)).every((c) => !c.running)).toBe(true);
      } finally {
        release();
      }
    });

    it('AC57: the newest completed row wins, even when it came from a one-case run', async () => {
      const llm = new ScriptedLLM();
      llm.fixture = reviewOf(); // the must_find case fails in the suite run
      const app = await makeApp(llm);
      const { agentId, caseIds } = await agentWithCases(app);
      const suite = await runAndWait(app, agentId);
      expect((await listCases(app, agentId)).find((c) => c.case.id === caseIds[0])!.last_result).toBe('fail');

      llm.fixture = reviewOf(finding(3)); // and passes when run alone
      const single = await startCaseRun(app, caseIds[0]!);
      expect(single.statusCode).toBe(202);
      await waitIdle(app, agentId);

      const entry = (await listCases(app, agentId)).find((c) => c.case.id === caseIds[0])!;
      expect(entry.last_result).toBe('pass');
      expect(entry.last_run_id).toBe((single.json() as { run_id: string }).run_id);
      expect(entry.last_run_id).not.toBe(suite.run_id);
    });

    it('AC55: a one-case run stays out of the run list and the dashboard', async () => {
      const llm = new ScriptedLLM();
      llm.fixture = reviewOf(finding(3));
      const app = await makeApp(llm);
      const { agentId, caseIds } = await agentWithCases(app);
      const suite = await runAndWait(app, agentId);

      const single = await startCaseRun(app, caseIds[0]!);
      expect(single.statusCode).toBe(202);
      const singleRunId = (single.json() as { run_id: string }).run_id;
      await waitIdle(app, agentId);

      const runs = (await app.inject({ url: `/agents/${agentId}/eval-runs` })).json() as Suite[];
      expect(runs.map((r) => r.run_id)).toEqual([suite.run_id]);

      const dash = (await app.inject({ url: '/eval/dashboard' })).json() as {
        agents: { agent_id: string; latest: { run_id: string } | null }[];
        recent_runs: { run_id: string }[];
      };
      expect(dash.recent_runs.map((r) => r.run_id)).not.toContain(singleRunId);
      expect(dash.agents.find((a) => a.agent_id === agentId)!.latest!.run_id).toBe(suite.run_id);
    });

    it('AC56: run detail and compare answer 404 for a one-case run', async () => {
      const llm = new ScriptedLLM();
      llm.fixture = reviewOf(finding(3));
      const app = await makeApp(llm);
      const { agentId, caseIds } = await agentWithCases(app);
      const suite = await runAndWait(app, agentId);
      const single = await startCaseRun(app, caseIds[0]!);
      expect(single.statusCode).toBe(202);
      const singleRunId = (single.json() as { run_id: string }).run_id;
      await waitIdle(app, agentId);

      expect((await app.inject({ url: `/eval-runs/${singleRunId}` })).statusCode).toBe(404);
      const cmp = await app.inject({ url: `/eval-runs/compare?a=${suite.run_id}&b=${singleRunId}` });
      expect(cmp.statusCode).toBe(404);
    });

    it('AC54: an unknown case, or another workspace’s case, is a 404', async () => {
      const app = await makeApp();
      const { caseIds } = await agentWithCases(app);
      expect((await startCaseRun(app, crypto.randomUUID())).statusCode).toBe(404);

      const appB = await makeApp(new ScriptedLLM(), workspaceB);
      expect((await startCaseRun(appB, caseIds[0]!)).statusCode).toBe(404);
    });
  });

  // ------------------------------------------------------ dry run and run lock

  describe('case editor: dry run and run lock', () => {
    it('AC59: a valid draft is run once and answered with the scored result', async () => {
      const llm = new ScriptedLLM();
      llm.fixture = reviewOf(finding(3));
      const app = await makeApp(llm);
      const agentId = await newAgent();

      const res = await dryRun(app, agentId, aFields(3));
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({ pass: true, grounding_kept: 1, grounding_dropped: 0, agent_version: 1 });
      expect(body.findings).toHaveLength(1);
      expect(body.findings[0]).toMatchObject({ file: 'src/a.ts', start_line: 3, matched: true });
      expect(typeof body.cost_usd).toBe('number');
      expect(typeof body.duration_ms).toBe('number');
      expect(llm.callCount).toBe(1);
    });

    it('AC60: a dry run writes no row to the case, run, review or trace tables', async () => {
      const llm = new ScriptedLLM();
      llm.fixture = reviewOf(finding(3));
      const app = await makeApp(llm);
      const agentId = await newAgent();
      const before = await Promise.all(await storeCounts());

      const res = await dryRun(app, agentId, aFields(3));
      expect(res.statusCode).toBe(200);
      expect(await Promise.all(await storeCounts())).toEqual(before);
    });

    it('AC45: a dry run refuses a bare hunk (invalid_diff) and an ungrounded expectation, and accepts an empty name', async () => {
      const llm = new ScriptedLLM();
      llm.fixture = reviewOf(finding(3));
      const app = await makeApp(llm);
      const agentId = await newAgent();

      const bare = await dryRun(app, agentId, aFields(3, { input_diff: '@@ -1 +1 @@\n+x' }));
      expect(bare.statusCode).toBe(422);
      expect(errorCode(bare)).toBe('invalid_diff');

      const outside = await dryRun(app, agentId, aFields(90));
      expect(outside.statusCode).toBe(422);
      expect(errorCode(outside)).toBe('expectation_not_grounded');

      const unnamed = await dryRun(app, agentId, aFields(3, { name: '' }));
      expect(unnamed.statusCode).toBe(200);
      expect(llm.callCount).toBe(1);
    });

    it('AC62: a failing provider answers 502 dry_run_failed with the sanitised reason', async () => {
      const llm = new ScriptedLLM();
      llm.failCalls.add(1);
      const app = await makeApp(llm);

      const res = await dryRun(app, await newAgent(), aFields(3));
      expect(res.statusCode).toBe(502);
      expect(res.json().error).toMatchObject({
        code: 'dry_run_failed',
        message: 'Error: scripted failure on call 1',
      });
    });

    it('AC63: a held suite run blocks a one-case run and a dry run (409 run_in_flight)', async () => {
      const { llm, release } = gatedLLM();
      const app = await makeApp(llm);
      const { agentId, caseIds } = await agentWithCases(app);
      try {
        const started = await startRun(app, agentId);
        expect(started.statusCode).toBe(202);

        const single = await startCaseRun(app, caseIds[0]!);
        expect(single.statusCode).toBe(409);
        expect(errorCode(single)).toBe('run_in_flight');
        const dry = await dryRun(app, agentId, aFields(3));
        expect(dry.statusCode).toBe(409);
        expect(errorCode(dry)).toBe('run_in_flight');

        release();
        await waitCompleted(app, (started.json() as { run_id: string }).run_id);
      } finally {
        release();
      }
    });

    it('AC63: a held one-case run blocks a suite run and a dry run (409 run_in_flight)', async () => {
      const { llm, release } = gatedLLM();
      const app = await makeApp(llm);
      const { agentId, caseIds } = await agentWithCases(app);
      try {
        expect((await startCaseRun(app, caseIds[0]!)).statusCode).toBe(202);

        const suite = await startRun(app, agentId);
        expect(suite.statusCode).toBe(409);
        expect(errorCode(suite)).toBe('run_in_flight');
        const dry = await dryRun(app, agentId, aFields(3));
        expect(dry.statusCode).toBe(409);
        expect(errorCode(dry)).toBe('run_in_flight');
      } finally {
        release();
      }
      await waitIdle(app, agentId);
    });

    it('AC63: a held dry run blocks a suite run and a one-case run (409 run_in_flight)', async () => {
      const { llm, release } = gatedLLM();
      llm.fixture = reviewOf(finding(3));
      const app = await makeApp(llm);
      const { agentId, caseIds } = await agentWithCases(app);
      const held = dryRun(app, agentId, aFields(3)); // not awaited: it sits on the gate
      try {
        await waitForProviderCall(llm);

        const suite = await startRun(app, agentId);
        expect(suite.statusCode).toBe(409);
        expect(errorCode(suite)).toBe('run_in_flight');
        const single = await startCaseRun(app, caseIds[0]!);
        expect(single.statusCode).toBe(409);
        expect(errorCode(single)).toBe('run_in_flight');
      } finally {
        release();
      }
      expect((await held).statusCode).toBe(200);
    });

    it('AC64: run-all lists an agent whose one-case run is held as refused (run_in_flight)', async () => {
      const [fresh] = await pg.handle.db.insert(t.workspaces).values({ name: `lock-${Date.now()}` }).returning();
      const { llm, release } = gatedLLM();
      const app = await makeApp(llm, fresh!.id);
      const agentId = await newAgent('openrouter', fresh!.id);
      await addCases(app, agentId, fresh!.id, [3]);
      const [only] = await listCases(app, agentId);
      try {
        expect((await startCaseRun(app, only!.case.id)).statusCode).toBe(202);

        const res = await app.inject({ method: 'POST', url: '/eval/runs/all', payload: { confirm: true } });
        expect(res.statusCode).toBe(202);
        const { started } = res.json() as { started: RunAllEntry[] };
        expect(started.find((e) => e.agent_id === agentId)).toMatchObject({
          run_id: null,
          refused_reason: 'run_in_flight',
        });
      } finally {
        release();
      }
      await waitIdle(app, agentId);
    });

    it('AC63: an agent whose provider has no usable key gets 422 provider_not_configured for a one-case run and a dry run', async () => {
      const app = await makeApp(); // only openrouter is injected
      const agentId = await newAgent('openai');
      const { res, body } = await freeze(app, await newFinding({ agentId, triage: 'accepted' }));
      expect(res.statusCode).toBe(201);

      const single = await startCaseRun(app, body.id);
      expect(single.statusCode).toBe(422);
      expect(errorCode(single)).toBe('provider_not_configured');
      const dry = await dryRun(app, agentId, aFields(3));
      expect(dry.statusCode).toBe(422);
      expect(errorCode(dry)).toBe('provider_not_configured');
    });

    it('AC65: the suite, one-case and dry-run starts share one 5-per-minute budget', async () => {
      const app = await makeApp(new ScriptedLLM(), workspaceA, 'development');
      const noCases = await newAgent();
      const suiteStart = () => app.inject({ method: 'POST', url: `/agents/${noCases}/eval-runs` });
      const caseStart = () => startCaseRun(app, crypto.randomUUID());
      const dryStart = () => dryRun(app, noCases, aFields(3, { input_diff: '@@ -1 +1 @@\n+x' }));

      // Five requests spent across the three routes, none of which reaches a model.
      expect((await suiteStart()).statusCode).toBe(422);
      expect((await suiteStart()).statusCode).toBe(422);
      expect((await caseStart()).statusCode).toBe(404);
      expect((await caseStart()).statusCode).toBe(404);
      expect((await dryStart()).statusCode).toBe(422);

      // The 6th POST to any of the three is limited.
      expect((await suiteStart()).statusCode).toBe(429);
      expect((await caseStart()).statusCode).toBe(429);
      expect((await dryStart()).statusCode).toBe(429);
    });
  });

  // -------------------------------------------------------------- fix round 2

  describe('case editor: fix round 2 (lenient read-back, field caps, lock order, locked_field)', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const INVALID_EXPECTATION = expectationAt(3, { category: 'docs' });

    /** A case inserted with an arbitrary (possibly unparseable) `expected_output`. */
    async function insertCaseWith(agentId: string, expectedOutput: unknown, inputMeta: Record<string, unknown> = {}) {
      seq += 1;
      const [row] = await pg.handle.db
        .insert(t.evalCases)
        .values({
          workspaceId: workspaceA,
          ownerKind: 'agent',
          ownerId: agentId,
          name: `fix2-case-${seq}`,
          inputDiff: A_DIFF,
          inputFiles: ['src/a.ts'],
          inputMeta: { pr_title: 'Hand PR', pr_body: 'Hand body', ...inputMeta },
          expectedOutput,
          notes: null,
        })
        .returning();
      return row!.id;
    }

    /** A completed legacy row (no stored expectation) with one finding at line 3. */
    async function insertLegacyRow(agentId: string, caseId: string, runId: string, pass: boolean, ageMs: number) {
      const at = new Date(Date.now() - ageMs);
      const [row] = await pg.handle.db
        .insert(t.evalRuns)
        .values({
          caseId,
          ranAt: at,
          actualOutput: {
            run_id: runId,
            agent_id: agentId,
            agent_version: 1,
            status: 'completed',
            findings: pass
              ? [{ file: 'src/a.ts', start_line: 3, end_line: 3, severity: 'WARNING', category: 'test', title: 'f' }]
              : [],
            grounding_kept: pass ? 1 : 0,
            grounding_dropped: 0,
            finished_at: at.toISOString(),
          },
          pass,
          recall: pass ? 1 : 0,
          precision: pass ? 1 : null,
          citationAccuracy: 1,
          durationMs: 10,
          costUsd: 0.001,
        })
        .returning();
      return row!.id;
    }

    const putCase = (app: FastifyInstance, caseId: string, payload: unknown) =>
      app.inject({ method: 'PUT', url: `/eval-cases/${caseId}`, payload: payload as object });

    it('a case whose expected_output is invalid can be edited; its past rows stay in the run detail and Compare with their stored metrics, while a parseable case still pins its old expectation', async () => {
      const app = await makeApp();
      const agentId = await newAgent();
      const badCase = await insertCaseWith(agentId, INVALID_EXPECTATION);
      const goodCase = await insertCaseWith(agentId, expectationAt(3));
      const runOld = crypto.randomUUID();
      const runNew = crypto.randomUUID();
      const badRow = await insertLegacyRow(agentId, badCase, runOld, true, 2 * DAY);
      const goodRow = await insertLegacyRow(agentId, goodCase, runOld, true, 2 * DAY);
      await insertLegacyRow(agentId, badCase, runNew, false, DAY);
      await insertLegacyRow(agentId, goodCase, runNew, false, DAY);

      const storedBefore = await pg.handle.db.select().from(t.evalRuns).where(inArray(t.evalRuns.caseId, [badCase, goodCase]));

      // Both are moved to line 9, so a row that fell back to the current expectation would no longer match line 3.
      expect((await putCase(app, badCase, aFields(9, { name: 'bad-moved' }))).statusCode).toBe(200);
      expect((await putCase(app, goodCase, aFields(9, { name: 'good-moved' }))).statusCode).toBe(200);

      const detail = await getRun(app, runOld);
      expect(detail.per_case.map((c) => c.case_id).sort()).toEqual([badCase, goodCase].sort());
      const outcome = (id: string) =>
        detail.per_case.find((c) => c.case_id === id) as unknown as { pass: boolean; findings: { matched: boolean }[] };
      // Valid case: the expectation pinned by the edit still scores the old finding. Invalid case: the row is
      // kept, scored against what the case expects now (line 9), so the finding at line 3 no longer matches.
      expect(outcome(goodCase)).toMatchObject({ pass: true, findings: [{ matched: true }] });
      expect(outcome(badCase)).toMatchObject({ pass: true, findings: [{ matched: false }] });

      const cmp = await app.inject({ url: `/eval-runs/compare?a=${runOld}&b=${runNew}` });
      expect(cmp.statusCode).toBe(200);
      const flips = cmp.json().flips as { case_id: string; a_pass: boolean; b_pass: boolean; direction: string }[];
      expect(flips.map((f) => f.case_id).sort()).toEqual([badCase, goodCase].sort());
      for (const f of flips) expect(f).toMatchObject({ a_pass: true, b_pass: false, direction: 'pass_to_fail' });
      expect(cmp.json().only_in_a).toEqual([]);
      expect(cmp.json().only_in_b).toEqual([]);

      // The stored per-row verdicts are untouched by the edit.
      const storedAfter = await pg.handle.db.select().from(t.evalRuns).where(inArray(t.evalRuns.caseId, [badCase, goodCase]));
      const verdict = (rows: typeof storedAfter, id: string) =>
        rows.find((r) => r.id === id) && (({ pass, recall, precision, citationAccuracy }) => ({ pass, recall, precision, citationAccuracy }))(rows.find((r) => r.id === id)!);
      for (const id of [badRow, goodRow]) {
        expect(verdict(storedAfter, id)).toEqual(verdict(storedBefore, id));
        expect(verdict(storedAfter, id)).toMatchObject({ pass: true, recall: 1, precision: 1 });
      }
      // The good case's row now carries the pinned expectation; the bad one carries what was stored (unparseable).
      const pinned = (id: string) => (storedAfter.find((r) => r.id === id)!.actualOutput as { expectation?: unknown }).expectation;
      expect(pinned(goodRow)).toMatchObject({ start_line: 3, category: 'test' });
      expect(pinned(badRow)).toMatchObject({ category: 'docs' });
    });

    it('over-length fields are refused with no row stored, while a pr_body exactly at the cap is stored', async () => {
      const app = await makeApp();
      const agentId = await newAgent();
      const post = (over: Record<string, unknown>) =>
        app.inject({ method: 'POST', url: `/agents/${agentId}/eval-cases`, payload: handFields(over) });

      const before = await countOf(t.evalCases);
      const atCap = await post({ pr_body: 'b'.repeat(65536) });
      expect(atCap.statusCode).toBe(201);
      expect(await countOf(t.evalCases)).toBe(before + 1);

      for (const over of [{ pr_body: 'b'.repeat(65537) }, { pr_title: 't'.repeat(301) }, { notes: 'n'.repeat(4097) }]) {
        const res = await post(over);
        // The app maps every request-validation failure to one status (app.ts error handler).
        expect(res.statusCode).toBe(422);
        expect(errorCode(res)).toBe('validation_error');
      }
      expect(await countOf(t.evalCases)).toBe(before + 1);
    });

    it('a PUT and a DELETE fired together on one case both settle without a 500 or a deadlock, and the case ends up gone; concurrent PUTs both land', async () => {
      const app = await makeApp();
      const agentId = await newAgent();

      for (let i = 0; i < 6; i++) {
        const caseId = await insertHandCase(agentId, 3);
        await insertLegacyRow(agentId, caseId, crypto.randomUUID(), true, DAY); // gives the pin something to update
        const [put, del] = await Promise.all([
          putCase(app, caseId, aFields(9, { name: `raced-${i}` })),
          app.inject({ method: 'DELETE', url: `/eval-cases/${caseId}` }),
        ]);
        expect([200, 404]).toContain(put.statusCode);
        expect(del.statusCode).toBe(204);
        const rest = await pg.handle.db.select().from(t.evalCases).where(eq(t.evalCases.id, caseId));
        expect(rest).toHaveLength(0);
        const rows = await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.caseId, caseId));
        expect(rows).toHaveLength(0);
      }

      // The other end state: two edits of the same case serialize, both succeed, one wins.
      const caseId = await insertHandCase(agentId, 3);
      await insertLegacyRow(agentId, caseId, crypto.randomUUID(), true, DAY);
      const both = await Promise.all([
        putCase(app, caseId, aFields(4, { name: 'edit-one' })),
        putCase(app, caseId, aFields(5, { name: 'edit-two' })),
      ]);
      expect(both.map((r) => r.statusCode)).toEqual([200, 200]);
      expect(['edit-one', 'edit-two']).toContain((await caseRow(caseId)).name);
    });

    it('a PUT on a case that no longer exists is a 404, a PUT on a live one is a 200', async () => {
      const app = await makeApp();
      const agentId = await newAgent();
      const caseId = await insertHandCase(agentId, 3);
      expect((await putCase(app, caseId, aFields(4, { name: 'still-here' }))).statusCode).toBe(200);

      expect((await app.inject({ method: 'DELETE', url: `/eval-cases/${caseId}` })).statusCode).toBe(204);
      const gone = await putCase(app, caseId, aFields(4, { name: 'too-late' }));
      expect(gone.statusCode).toBe(404);
      expect(await pg.handle.db.select().from(t.evalCases).where(eq(t.evalCases.id, caseId))).toHaveLength(0);
    });

    it('locked_field: a from-finding case whose expectation does not parse can change type, but not its diff; a parseable one still cannot change type', async () => {
      const app = await makeApp();
      const agentId = await newAgent();
      const sourceId = crypto.randomUUID();
      const unparseable = await insertCaseWith(agentId, INVALID_EXPECTATION, { source_finding_id: sourceId });
      const body = (over: Record<string, unknown>) => aFields(3, { name: 'kept-name', ...over });

      // Same diff, any type: no longer refused.
      const flipped = await putCase(app, unparseable, body({ expectation: expectationAt(3, { type: 'must_not_flag' }) }));
      expect(flipped.statusCode).toBe(200);
      expect(await caseRow(unparseable)).toMatchObject({ expectedOutput: { type: 'must_not_flag', category: 'test' } });
      expect((await caseRow(unparseable)).inputMeta).toMatchObject({ source_finding_id: sourceId });

      // The diff is still frozen for such a case.
      const rediffed = await putCase(app, unparseable, body({ input_diff: `${A_DIFF}\n+extra` }));
      expect(rediffed.statusCode).toBe(422);
      expect(errorCode(rediffed)).toBe('locked_field');

      // A parseable from-finding case keeps its type lock.
      const parseable = await insertCaseWith(agentId, expectationAt(3), { source_finding_id: crypto.randomUUID() });
      const refused = await putCase(app, parseable, body({ expectation: expectationAt(3, { type: 'must_not_flag' }) }));
      expect(refused.statusCode).toBe(422);
      expect(errorCode(refused)).toBe('locked_field');
      expect((await caseRow(parseable)).expectedOutput).toMatchObject({ type: 'must_find' });
    });
  });
});
