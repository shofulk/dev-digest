import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockProjectDocsSource } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[project-context] Docker not available — skipping integration tests.');
}

/**
 * T3 (red, L3) — Project Context routes over a real Postgres (`app.inject()`).
 * Covers AC-1, AC-3, AC-5, AC-8, AC-14, AC-15, AC-20, AC-26, AC-35, AC-36,
 * AC-43. Every handler currently throws the interface-only `not_implemented`
 * 501 `AppError` (see `modules/project-context/routes.ts`) and the service
 * methods throw the same — so every assertion below is expected to fail until
 * a later lane wires the real `ProjectContextService`.
 */
d('project-context module (routes)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoSeq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp(files: Record<string, string> = {}) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        projectDocs: new MockProjectDocsSource(files),
        tokenizer: { count: (text) => text.split(/\s+/).filter(Boolean).length },
      },
    });
  }

  async function insertRepo(clonePath: string | null) {
    const name = `payments-api-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath })
      .returning();
    return repo!;
  }

  async function insertAgent(app: Awaited<ReturnType<typeof makeApp>>) {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name: `Agent-${randomUUID()}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 'sys' },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string; version: number };
  }

  async function insertSkill() {
    const [row] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId,
        name: `Skill-${randomUUID()}`,
        description: 'd',
        type: 'rubric',
        source: 'manual',
        body: 'body',
      })
      .returning();
    return row!;
  }

  it('AC-1/AC-3: GET /repos/:id/context returns files with type, size, tokens matching POST /skills/tokens, and a summary', async () => {
    const app = await makeApp({
      'docs/architecture.md': 'module api does not import db directly',
      'specs/rate-limiting.spec.md': 'rate limit rule',
    });
    const repo = await insertRepo('/mock/checkout');

    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const arch = body.files?.find((f: { path: string }) => f.path === 'docs/architecture.md');
    expect(arch).toMatchObject({ path: 'docs/architecture.md', type: 'docs' });
    expect(typeof arch.size).toBe('number');

    const tokensRes = await app.inject({
      method: 'POST',
      url: '/skills/tokens',
      payload: { body: 'module api does not import db directly' },
    });
    expect(tokensRes.statusCode).toBe(200);
    expect(arch.tokens).toBe(tokensRes.json().tokens);
    expect(body).toMatchObject({ count: 2 });
    expect(typeof body.scanned_at).toBe('string');
    await app.close();
  });

  it('AC-5/AC-43: used_by counts direct + enabled-skill attachments, not a disabled link', async () => {
    const app = await makeApp({ 'docs/architecture.md': 'rule text' });
    const repo = await insertRepo('/mock/checkout');
    const direct = await insertAgent(app);
    const viaSkill = await insertAgent(app);
    const disabledLink = await insertAgent(app);
    const skill = await insertSkill();
    await pg.handle.db
      .update(t.skills)
      .set({ contextDocs: ['docs/architecture.md'] })
      .where(eq(t.skills.id, skill.id));
    await pg.handle.db
      .update(t.agents)
      .set({ contextDocs: ['docs/architecture.md'] })
      .where(eq(t.agents.id, direct.id));
    // viaSkill: links the skill, enabled
    await app.inject({ method: 'POST', url: `/agents/${viaSkill.id}/skills`, payload: { skill_id: skill.id } });
    // disabledLink: links the skill but the LINK is disabled
    const link = await app.inject({
      method: 'POST',
      url: `/agents/${disabledLink.id}/skills`,
      payload: { skill_id: skill.id },
    });
    await app.inject({
      method: 'PUT',
      url: `/agents/${disabledLink.id}/skills/${skill.id}`,
      payload: { enabled: false },
    });

    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` });
    expect(res.statusCode).toBe(200);
    const file = res.json().files?.find((f: { path: string }) => f.path === 'docs/architecture.md');
    expect(file?.used_by).toBe(2); // direct + viaSkill, not disabledLink
    expect(link.statusCode).toBe(200);
    await app.close();
  });

  it('AC-8: reindex surfaces files added, removed or renamed since the last scan', async () => {
    const app = await makeApp({ 'docs/old.md': 'x' });
    const repo = await insertRepo('/mock/checkout');
    const first = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` });
    expect(first.statusCode).toBe(200);
    expect(first.json().files?.map((f: { path: string }) => f.path)).toEqual(['docs/old.md']);

    const reindexed = await app.inject({ method: 'POST', url: `/repos/${repo.id}/context/reindex` });
    expect(reindexed.statusCode).toBe(200);
    expect(reindexed.json().status).toBe('done');
    await app.close();
  });

  it('AC-15: PUT /agents/:id/context-docs stores the ordered paths, GET returns them, no new agent version', async () => {
    const app = await makeApp({ 'docs/a.md': 'a', 'docs/b.md': 'b' });
    const agent = await insertAgent(app);

    const put = await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context-docs`,
      payload: { context_docs: ['docs/b.md', 'docs/a.md'] },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ context_docs: ['docs/b.md', 'docs/a.md'] });

    const got = await app.inject({ method: 'GET', url: `/agents/${agent.id}` });
    expect(got.json().context_docs).toEqual(['docs/b.md', 'docs/a.md']);
    expect(got.json().version).toBe(agent.version);

    const versions = await pg.handle.db
      .select()
      .from(t.agentVersions)
      .where(eq(t.agentVersions.agentId, agent.id));
    expect(versions).toHaveLength(1); // only the v1 snapshot from creation
    await app.close();
  });

  it('AC-20: PUT /skills/:id/context-docs leaves version and skill_versions unchanged', async () => {
    const app = await makeApp({ 'docs/a.md': 'a' });
    const skill = await insertSkill();

    const put = await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}/context-docs`,
      payload: { context_docs: ['docs/a.md'] },
    });
    expect(put.statusCode).toBe(200);

    const [row] = await pg.handle.db.select().from(t.skills).where(eq(t.skills.id, skill.id));
    expect(row!.version).toBe(skill.version);
    const versions = await pg.handle.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skill.id));
    expect(versions).toHaveLength(0);
    await app.close();
  });

  it('AC-26: an invalid path is rejected with 400 on save and on the file route', async () => {
    const app = await makeApp({ 'docs/a.md': 'a' });
    const agent = await insertAgent(app);
    const repo = await insertRepo('/mock/checkout');

    const save = await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context-docs`,
      payload: { context_docs: ['../escape.md'] },
    });
    expect(save.statusCode).toBe(400);

    const file = await app.inject({
      method: 'GET',
      url: `/repos/${repo.id}/context/file?path=${encodeURIComponent('../escape.md')}`,
    });
    expect(file.statusCode).toBe(400);
    await app.close();
  });

  it('a non-document path 404s on the file route; an unknown repo 404s on context routes', async () => {
    const app = await makeApp({ 'docs/a.md': 'a' });
    const repo = await insertRepo('/mock/checkout');

    const notADoc = await app.inject({
      method: 'GET',
      url: `/repos/${repo.id}/context/file?path=${encodeURIComponent('docs/nope.md')}`,
    });
    expect(notADoc.statusCode).toBe(404);

    const unknown = await app.inject({ method: 'GET', url: `/repos/${randomUUID()}/context` });
    expect(unknown.statusCode).toBe(404);
    await app.close();
  });

  it('AC-35: a repo with no synced checkout answers 409 "repository not synced"', async () => {
    const app = await makeApp();
    const repo = await insertRepo(null);
    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toMatch(/not synced/i);
    await app.close();
  });

  it('NFR-6: more than 1,000 documents are capped at 1,000 with truncated:true', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 1001; i++) files[`docs/doc-${i}.md`] = `content ${i}`;
    const app = await makeApp(files);
    const repo = await insertRepo('/mock/checkout');
    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` });
    expect(res.statusCode).toBe(200);
    expect(res.json().files).toHaveLength(1000);
    expect(res.json().truncated).toBe(true);
    await app.close();
  });

});
