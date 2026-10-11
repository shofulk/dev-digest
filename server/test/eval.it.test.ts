import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
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
        rationale: 'The branch is never asserted.',
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
});
