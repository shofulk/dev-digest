import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[skills-stats] Docker not available — skipping integration tests.');
}

const DAY = 24 * 60 * 60 * 1000;

interface Stats {
  agent_count: number;
  pull_rate: number;
  accept_rate: number;
  findings_30d: number;
  agents: { id: string; name: string }[];
  by_category: { category: string; count: number }[];
}

/**
 * Skill stats over a real Postgres (spec F, criteria 32-34). Everything is seeded straight
 * through Drizzle: runs, reviews and findings are exactly what run-executor would have
 * written, without a review having to run.
 */
d('skills stats', () => {
  let pg: PgFixture;
  let db: PgFixture['handle']['db'];
  let wsId: string;
  let otherWsId: string;

  beforeAll(async () => {
    pg = await startPg();
    db = pg.handle.db;
    await seed(db);
    const [ws] = await db.select().from(t.workspaces).where(eq(t.workspaces.name, 'default'));
    wsId = ws!.id;
    const [other] = await db.insert(t.workspaces).values({ name: 'stats-other' }).returning();
    otherWsId = other!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  let seq = 0;
  const uniq = (p: string) => `${p}-${++seq}`;

  async function insertSkill(workspaceId: string, name: string) {
    const [row] = await db
      .insert(t.skills)
      .values({ workspaceId, name, description: `${name} d`, type: 'rubric', source: 'manual', body: 'b' })
      .returning();
    return row!;
  }

  async function insertAgent(workspaceId: string, name: string) {
    const [row] = await db
      .insert(t.agents)
      .values({ workspaceId, name, provider: 'openai', model: 'gpt-4.1', systemPrompt: 'x' })
      .returning();
    return row!;
  }

  async function insertPr(workspaceId: string) {
    const name = uniq('repo');
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 1,
        title: 'pr',
        author: 'a',
        branch: 'f',
        base: 'main',
        headSha: 'abc',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: '',
      })
      .returning();
    return pr!;
  }

  type Verdict = 'accepted' | 'dismissed' | 'none';

  /** One agent_run (+ its review and findings when `findings` is given). */
  async function insertRun(opts: {
    workspaceId: string;
    agentId: string;
    prId: string;
    skillsUsed: string[] | null;
    ageDays?: number;
    status?: string;
    findings?: { category: string; verdict?: Verdict }[];
    reviewWorkspaceId?: string;
  }) {
    const [run] = await db
      .insert(t.agentRuns)
      .values({
        workspaceId: opts.workspaceId,
        agentId: opts.agentId,
        prId: opts.prId,
        ranAt: new Date(Date.now() - (opts.ageDays ?? 1) * DAY),
        status: opts.status ?? (opts.skillsUsed ? 'done' : 'failed'),
        skillsUsed: opts.skillsUsed,
      })
      .returning();
    if (opts.findings) {
      const [review] = await db
        .insert(t.reviews)
        .values({
          workspaceId: opts.reviewWorkspaceId ?? opts.workspaceId,
          prId: opts.prId,
          agentId: opts.agentId,
          runId: run!.id,
          kind: 'review',
        })
        .returning();
      await db.insert(t.findings).values(
        opts.findings.map((f, i) => ({
          reviewId: review!.id,
          file: 'a.ts',
          startLine: i + 1,
          endLine: i + 1,
          severity: 'warning',
          category: f.category,
          title: 'f',
          rationale: 'r',
          confidence: 0.9,
          acceptedAt: f.verdict === 'accepted' ? new Date() : null,
          dismissedAt: f.verdict === 'dismissed' ? new Date() : null,
        })),
      );
    }
    return run!;
  }

  async function getJson<T>(app: Awaited<ReturnType<typeof makeApp>>, url: string): Promise<T> {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode, url).toBe(200);
    return res.json() as T;
  }

  it('attributes stats per run: disabled-at-run-time counts in the denominator only, foreign and stale data never leaks', async () => {
    const app = await makeApp();
    const skill = await insertSkill(wsId, uniq('stats-skill'));
    const unused = await insertSkill(wsId, uniq('stats-unused'));
    const agentA = await insertAgent(wsId, uniq('A-agent'));
    const agentB = await insertAgent(wsId, uniq('B-agent'));
    const unlinked = await insertAgent(wsId, uniq('C-unlinked'));
    await db.insert(t.agentSkills).values([
      { agentId: agentA.id, skillId: skill.id, order: 0, enabled: true },
      { agentId: agentB.id, skillId: skill.id, order: 0, enabled: false },
    ]);
    const pr = await insertPr(wsId);

    // included: 3 findings (bug accepted, bug untouched, security dismissed)
    const run1 = await insertRun({
      workspaceId: wsId,
      agentId: agentA.id,
      prId: pr.id,
      skillsUsed: [skill.id],
      findings: [
        { category: 'bug', verdict: 'accepted' },
        { category: 'bug' },
        { category: 'security', verdict: 'dismissed' },
      ],
    });
    // included: 1 finding (style accepted)
    await insertRun({
      workspaceId: wsId,
      agentId: agentA.id,
      prId: pr.id,
      skillsUsed: [skill.id],
      findings: [{ category: 'style', verdict: 'accepted' }],
    });
    // (1) agent B links the skill but had it DISABLED at run time: in the denominator only.
    await insertRun({
      workspaceId: wsId,
      agentId: agentB.id,
      prId: pr.id,
      skillsUsed: [],
      findings: [
        { category: 'bug', verdict: 'accepted' },
        { category: 'bug', verdict: 'accepted' },
      ],
    });
    // failed run (skills_used NULL): not in the denominator.
    await insertRun({ workspaceId: wsId, agentId: agentA.id, prId: pr.id, skillsUsed: null });
    // outside the 30-day window.
    await insertRun({
      workspaceId: wsId,
      agentId: agentA.id,
      prId: pr.id,
      skillsUsed: [skill.id],
      ageDays: 45,
      findings: [{ category: 'perf', verdict: 'dismissed' }],
    });
    // an agent that no longer links the skill: out of scope, by design.
    await insertRun({
      workspaceId: wsId,
      agentId: unlinked.id,
      prId: pr.id,
      skillsUsed: [skill.id],
      findings: [{ category: 'perf', verdict: 'dismissed' }],
    });

    // (3) A SECOND workspace with the same skill-id-shaped data. findings has no
    // workspace_id, so each of these would leak through a query that trusts review ids.
    const otherPr = await insertPr(otherWsId);
    const foreignAgent = await insertAgent(otherWsId, uniq('X-foreign'));
    await db.insert(t.agentSkills).values({ agentId: foreignAgent.id, skillId: skill.id, order: 0 });
    await insertRun({
      workspaceId: otherWsId,
      agentId: foreignAgent.id,
      prId: otherPr.id,
      skillsUsed: [skill.id],
      findings: [{ category: 'foreign', verdict: 'accepted' }],
    });
    // a foreign-workspace run of OUR linked agent
    await insertRun({
      workspaceId: otherWsId,
      agentId: agentA.id,
      prId: otherPr.id,
      skillsUsed: [skill.id],
      findings: [{ category: 'foreign', verdict: 'accepted' }],
    });
    // a foreign-workspace review pointing at OUR run
    const [foreignReview] = await db
      .insert(t.reviews)
      .values({ workspaceId: otherWsId, prId: otherPr.id, runId: run1.id, kind: 'review' })
      .returning();
    await db.insert(t.findings).values(
      Array.from({ length: 5 }, (_, i) => ({
        reviewId: foreignReview!.id,
        file: 'a.ts',
        startLine: i + 1,
        endLine: i + 1,
        severity: 'warning',
        category: 'foreign',
        title: 'f',
        rationale: 'r',
        confidence: 0.9,
        acceptedAt: new Date(),
      })),
    );

    const stats = await getJson<Stats>(app, `/skills/${skill.id}/stats`);
    expect(stats.agent_count).toBe(2);
    expect(stats.agents.map((a) => a.id).sort()).toEqual([agentA.id, agentB.id].sort());
    expect(stats.agents.map((a) => a.name)).toEqual(
      [...stats.agents.map((a) => a.name)].sort(),
    );
    // 3 completed runs of linking agents in the window, 2 of them included the skill
    expect(stats.pull_rate).toBe(0.6667);
    // 4 findings in the included runs; 2 accepted, 1 dismissed, 1 untouched
    expect(stats.findings_30d).toBe(4);
    expect(stats.accept_rate).toBe(0.6667);
    expect(stats.by_category).toEqual([
      { category: 'bug', count: 2 },
      { category: 'security', count: 1 },
      { category: 'style', count: 1 },
    ]);

    // (5) the list card reads the same numbers as the per-skill route
    const list = await getJson<Array<{ id: string; agent_count: number; pull_rate: number; accept_rate: number }>>(
      app,
      '/skills',
    );
    const card = list.find((s) => s.id === skill.id)!;
    expect(card).toMatchObject({
      agent_count: stats.agent_count,
      pull_rate: stats.pull_rate,
      accept_rate: stats.accept_rate,
    });

    // (4) a never-used skill reads honest zeros
    const zeros: Stats = {
      agent_count: 0,
      pull_rate: 0,
      accept_rate: 0,
      findings_30d: 0,
      agents: [],
      by_category: [],
    };
    expect(await getJson<Stats>(app, `/skills/${unused.id}/stats`)).toEqual(zeros);
    expect(list.find((s) => s.id === unused.id)).toMatchObject({
      agent_count: 0,
      pull_rate: 0,
      accept_rate: 0,
    });
    await app.close();
  });

  it('a skill linked but never run: agents are listed, rates are zero', async () => {
    const app = await makeApp();
    const skill = await insertSkill(wsId, uniq('stats-linked-idle'));
    const agent = await insertAgent(wsId, uniq('idle-agent'));
    await db.insert(t.agentSkills).values({ agentId: agent.id, skillId: skill.id, order: 0 });
    const stats = await getJson<Stats>(app, `/skills/${skill.id}/stats`);
    expect(stats).toEqual({
      agent_count: 1,
      pull_rate: 0,
      accept_rate: 0,
      findings_30d: 0,
      agents: [{ id: agent.id, name: agent.name }],
      by_category: [],
    });
    await app.close();
  });

  it('a run that used the skill but has no judged finding is accept_rate 0, pull_rate 1', async () => {
    const app = await makeApp();
    const skill = await insertSkill(wsId, uniq('stats-unjudged'));
    const agent = await insertAgent(wsId, uniq('unjudged-agent'));
    await db.insert(t.agentSkills).values({ agentId: agent.id, skillId: skill.id, order: 0 });
    const pr = await insertPr(wsId);
    await insertRun({
      workspaceId: wsId,
      agentId: agent.id,
      prId: pr.id,
      skillsUsed: [skill.id],
      findings: [{ category: 'bug' }],
    });
    const stats = await getJson<Stats>(app, `/skills/${skill.id}/stats`);
    expect(stats).toMatchObject({ pull_rate: 1, accept_rate: 0, findings_30d: 1 });
    await app.close();
  });

  it('a skill of another workspace is 404 on the stats route and absent from the list', async () => {
    const app = await makeApp();
    const foreign = await insertSkill(otherWsId, uniq('stats-foreign-skill'));
    const res = await app.inject({ method: 'GET', url: `/skills/${foreign.id}/stats` });
    expect(res.statusCode).toBe(404);
    const missing = await app.inject({
      method: 'GET',
      url: '/skills/00000000-0000-4000-8000-000000000000/stats',
    });
    expect(missing.statusCode).toBe(404);
    const list = await getJson<Array<{ id: string }>>(app, '/skills');
    expect(list.some((s) => s.id === foreign.id)).toBe(false);
    await app.close();
  });
});
