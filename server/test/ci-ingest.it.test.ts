import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { CiAgentResult, CiResultArtifact } from '@devdigest/shared/contracts/eval-ci';
import type { WorkflowRunMeta, ArtifactRead } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import {
  MockGitClient,
  MockGitHubClient,
  MockLLMProvider,
  MockRunnerBundleSource,
  MockSecretsProvider,
  type MockGitHubOptions,
} from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) console.warn('[ci-ingest] Docker not available — skipping integration tests.');

const REPO_A = 'acme/payments-api';
const REPO_B = 'acme/other';
const SECRET = 'sk-or-very-secret-value';
const DAY = 86_400_000;

d('CI ingest and lists', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let prId: string;
  let repoAId: string;
  let agentA: string;
  let agentB: string;
  let foreignAgent: string;
  let instAA: string;
  let instBB: string;
  const llm = new MockLLMProvider('openrouter');

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
    const db = pg.handle.db;
    const [repoA] = await db.select().from(t.repos).where(eq(t.repos.fullName, REPO_A));
    repoAId = repoA!.id;
    await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'other', fullName: REPO_B, defaultBranch: 'main' });
    const [pr] = await db.select().from(t.pullRequests).where(eq(t.pullRequests.repoId, repoAId));
    prId = pr!.id;
    const mk = (name: string, ws = workspaceId) =>
      db
        .insert(t.agents)
        .values({ workspaceId: ws, name, provider: 'openrouter', model: 'm', systemPrompt: 'x' })
        .returning();
    agentA = (await mk('Agent A'))[0]!.id;
    agentB = (await mk('Agent B'))[0]!.id;
    const [ws2] = await db.insert(t.workspaces).values({ name: 'other ws' }).returning();
    foreignAgent = (await mk('Foreign', ws2!.id))[0]!.id;
    const inst = async (agentId: string, repo: string) =>
      (await db.insert(t.ciInstallations).values({ agentId, repo, targetType: 'gha' }).returning())[0]!.id;
    instAA = await inst(agentA, REPO_A);
    instBB = await inst(agentB, REPO_B);
    await inst(agentA, REPO_B);
    // a local run on the PR, the only thing the PR feed may count
    await db.insert(t.agentRuns).values({ workspaceId, agentId: agentA, prId, status: 'done', costUsd: 1 });
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function makeApp(gh: MockGitHubOptions | 'none') {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const github = gh === 'none' ? undefined : new MockGitHubClient(gh);
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        secrets: new MockSecretsProvider(gh === 'none' ? {} : { GITHUB_TOKEN: SECRET, OPENROUTER_API_KEY: SECRET }),
        runnerBundle: new MockRunnerBundleSource('// runner\n'),
        llm: { openrouter: llm },
        ...(github ? { github } : {}),
      },
    });
    return { app, github };
  }

  const result = (agent_id: string, over: Partial<CiAgentResult> = {}): CiAgentResult => ({
    agent_id,
    agent_version: 2,
    verdict: 'blocked',
    critical: 1,
    warning: 1,
    suggestion: 0,
    findings_count: 2,
    blockers: 1,
    cost_usd: 0.25,
    duration_ms: 4200,
    model: 'openai/gpt-4o',
    error_code: null,
    ...over,
  });
  const artifact = (results: CiAgentResult[], pr = 7): ArtifactRead => ({
    status: 'ok',
    text: JSON.stringify({ version: 1, pr_number: pr, head_sha: 'abc', results } satisfies CiResultArtifact),
  });
  const run = (id: number, repo = REPO_A, over: Partial<WorkflowRunMeta> = {}): WorkflowRunMeta => ({
    id,
    htmlUrl: `https://github.com/${repo}/actions/runs/${id}`,
    headRepoFullName: repo,
    prNumber: 7,
    createdAt: new Date(Date.now() - DAY).toISOString(),
    ...over,
  });
  const ciRunRows = () => pg.handle.db.select().from(t.ciRuns);
  const ciAgentRuns = () =>
    pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.source, 'ci'));

  const firstRefresh = (): MockGitHubOptions => ({
    workflowRuns: {
      [REPO_A]: [
        run(101),
        run(102, REPO_A, { headRepoFullName: 'fork/payments-api' }),
        run(103),
        run(104),
        run(105),
        run(106),
        run(107),
      ],
      [REPO_B]: 'error',
    },
    artifacts: {
      101: artifact([result(agentA), result('ghost'), result(agentB)]),
      104: { status: 'too_large' },
      105: { status: 'invalid' },
      106: { status: 'ok', text: 'not json' },
      107: { status: 'ok', text: JSON.stringify({ version: 1, pr_number: 7 }) },
    },
  });

  it('AC-16 / AC-17 / AC-18 / AC-19 / AC-20 / AC-21 / AC-24 / NFR-1 / NFR-4: refresh stores one valid run and counts the rest', async () => {
    const first = firstRefresh();
    const { app, github } = await makeApp(first);
    const res = await app.inject({ method: 'POST', url: '/ci/refresh' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      stored: 1,
      skipped: 5,
      degraded: [{ repo: REPO_B, reason: 'github_error' }],
    });

    expect(github!.listRunsCalls.map((c) => `${c.repo.owner}/${c.repo.name}`).sort()).toEqual([REPO_B, REPO_A]);
    for (const c of github!.listRunsCalls) {
      expect(c.workflowFile).toBe('devdigest-review.yml');
      expect(c.opts.perPage).toBe(100);
      const age = Date.now() - new Date(c.opts.createdSince).getTime();
      expect(Math.abs(age - 30 * DAY)).toBeLessThan(60_000);
    }
    // the foreign head repo (102) is never downloaded
    expect(github!.artifactCalls.map((c) => c.runId)).toEqual([101, 103, 104, 105, 106, 107]);
    for (const c of github!.artifactCalls) {
      expect(c.opts).toEqual({ name: 'devdigest-result', entry: 'devdigest-result.json', maxBytes: 1_048_576 });
    }

    const runs = await ciAgentRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      workspaceId,
      agentId: agentA,
      prId: null,
      source: 'ci',
      provider: 'openrouter',
      model: 'openai/gpt-4o',
      status: 'done',
      durationMs: 4200,
      costUsd: 0.25,
      findingsCount: 2,
      blockers: 1,
    });
    const rows = await ciRunRows();
    expect(rows).toHaveLength(1);
    // AC-19: both ran_at columns carry the GitHub run's createdAt
    const createdAt = new Date((first.workflowRuns![REPO_A] as WorkflowRunMeta[])[0]!.createdAt);
    expect(runs[0]!.ranAt).toEqual(createdAt);
    expect(rows[0]!.ranAt).toEqual(createdAt);
    expect(rows[0]).toMatchObject({
      ciInstallationId: instAA,
      agentRunId: runs[0]!.id,
      prNumber: 7,
      githubRunId: 101,
      verdict: 'blocked',
      githubUrl: `https://github.com/${REPO_A}/actions/runs/101`,
    });
    const [aa] = await pg.handle.db.select().from(t.ciInstallations).where(eq(t.ciInstallations.id, instAA));
    expect(aa!.status).toBe('active');
    const [bb] = await pg.handle.db.select().from(t.ciInstallations).where(eq(t.ciInstallations.id, instBB));
    expect(bb!.status).toBe('manual');
    expect(llm.calls).toHaveLength(0);
    await app.close();
  });

  it('AC-17: a second refresh adds no rows and does not download a stored run again', async () => {
    const { app, github } = await makeApp(firstRefresh());
    const res = await app.inject({ method: 'POST', url: '/ci/refresh' });
    expect(res.json().stored).toBe(0);
    expect(github!.artifactCalls.map((c) => c.runId)).not.toContain(101);
    expect(await ciRunRows()).toHaveLength(1);
    expect(await ciAgentRuns()).toHaveLength(1);
    await app.close();
  });

  it('AC-21: a repository whose listing fails writes nothing while the others are stored', async () => {
    const { app } = await makeApp({
      workflowRuns: { [REPO_A]: 'error', [REPO_B]: [run(201, REPO_B)] },
      artifacts: { 201: artifact([result(agentB, { verdict: 'passed', blockers: 0, findings_count: 1 })], 9) },
    });
    const res = await app.inject({ method: 'POST', url: '/ci/refresh' });
    expect(res.json()).toEqual({ stored: 1, skipped: 0, degraded: [{ repo: REPO_A, reason: 'github_error' }] });
    const rows = await ciRunRows();
    expect(rows.map((r) => r.githubRunId).sort()).toEqual([101, 201]);
    await app.close();
  });

  it('AC-21: without a GitHub token every installed repository is degraded', async () => {
    const { app } = await makeApp('none');
    const res = await app.inject({ method: 'POST', url: '/ci/refresh' });
    expect(res.statusCode).toBe(200);
    expect(res.json().stored).toBe(0);
    expect(res.json().degraded).toEqual(
      expect.arrayContaining([
        { repo: REPO_A, reason: 'github_not_configured' },
        { repo: REPO_B, reason: 'github_not_configured' },
      ]),
    );
    await app.close();
  });

  it('AC-14 / AC-15: the lists return the installation fields and the newest runs, capped at 20 and 100', async () => {
    const db = pg.handle.db;
    // 120 older runs of agent A on repo A
    for (let i = 0; i < 120; i++) {
      const ranAt = new Date(Date.now() - 2 * DAY - i * 60_000);
      const [ar] = await db
        .insert(t.agentRuns)
        .values({ workspaceId, agentId: agentA, source: 'ci', ranAt, status: 'done', findingsCount: 0 })
        .returning();
      await db.insert(t.ciRuns).values({
        ciInstallationId: instAA,
        agentRunId: ar!.id,
        githubRunId: 1000 + i,
        verdict: 'no_findings',
        ranAt,
      });
    }
    // a foreign workspace's run never shows up
    const [fi] = await db
      .insert(t.ciInstallations)
      .values({ agentId: foreignAgent, repo: 'x/y', targetType: 'gha' })
      .returning();
    const [fws] = await db.select().from(t.agents).where(eq(t.agents.id, foreignAgent));
    const [far] = await db
      .insert(t.agentRuns)
      .values({ workspaceId: fws!.workspaceId, agentId: foreignAgent, source: 'ci', status: 'done' })
      .returning();
    await db.insert(t.ciRuns).values({ ciInstallationId: fi!.id, agentRunId: far!.id, githubRunId: 9, verdict: 'passed' });

    const { app } = await makeApp({});
    const one = await app.inject({ method: 'GET', url: `/agents/${agentA}/ci` });
    expect(one.statusCode).toBe(200);
    const body = one.json();
    expect(body.installations).toHaveLength(2);
    const aa = body.installations.find((i: { repo: string }) => i.repo === REPO_A);
    expect(aa).toMatchObject({
      id: instAA,
      agent_id: agentA,
      repo: REPO_A,
      target_type: 'gha',
      status: 'active',
      installed_agent_version: 1,
      pr_url: null,
      triggers: ['opened', 'synchronize'],
      post_as: 'github_review',
      last_run: { verdict: 'blocked' },
    });
    expect(body.runs).toHaveLength(20);
    const times = body.runs.map((r: { ran_at: string }) => r.ran_at);
    expect([...times].sort().reverse()).toEqual(times);
    expect(body.runs[0]).toMatchObject({
      repo: REPO_A,
      pr_number: 7,
      pr_url: `https://github.com/${REPO_A}/pull/7`,
      agent_id: agentA,
      agent_name: 'Agent A',
      verdict: 'blocked',
      findings_count: 2,
      cost_usd: 0.25,
      duration_ms: 4200,
      github_url: `https://github.com/${REPO_A}/actions/runs/101`,
    });

    const all = await app.inject({ method: 'GET', url: '/ci/runs' });
    const items = all.json().items as { id: string; ran_at: string; agent_id: string }[];
    expect(items.find((i) => (i as { github_url?: string }).github_url?.endsWith('/runs/101'))).toEqual({
      id: expect.any(String),
      repo: REPO_A,
      pr_number: 7,
      pr_url: `https://github.com/${REPO_A}/pull/7`,
      agent_id: agentA,
      agent_name: 'Agent A',
      verdict: 'blocked',
      findings_count: 2,
      cost_usd: 0.25,
      duration_ms: 4200,
      github_url: `https://github.com/${REPO_A}/actions/runs/101`,
      ran_at: expect.any(String),
    });
    expect(items).toHaveLength(100);
    const allTimes = items.map((i) => i.ran_at);
    expect([...allTimes].sort().reverse()).toEqual(allTimes);
    expect(items.some((i) => i.agent_id === foreignAgent)).toBe(false);
    await app.close();
  });

  it('AC-22: CI runs stay out of GET /pulls/:id/runs and the PR list cost', async () => {
    const { app } = await makeApp('none');
    const runs = await app.inject({ method: 'GET', url: `/pulls/${prId}/runs` });
    expect(runs.statusCode).toBe(200);
    expect(runs.json()).toHaveLength(1);
    const list = await app.inject({ method: 'GET', url: `/repos/${repoAId}/pulls` });
    const pr = (list.json() as { id: string; cost_usd: number | null }[]).find((p) => p.id === prId);
    expect(pr!.cost_usd).toBe(1);
    // the CI rows exist in the same workspace, yet neither endpoint sees them
    const ci = await pg.handle.db
      .select({ id: t.agentRuns.id })
      .from(t.agentRuns)
      .where(and(eq(t.agentRuns.source, 'ci'), eq(t.agentRuns.workspaceId, workspaceId)));
    expect(ci.length).toBeGreaterThan(0);
    await app.close();
  });

  it('NFR-6: GET /agents/:id/ci answers 404 for an agent of another workspace', async () => {
    const { app } = await makeApp({});
    const res = await app.inject({ method: 'GET', url: `/agents/${foreignAgent}/ci` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
