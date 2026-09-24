import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { zipSync, strToU8 } from 'fflate';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[skills] Docker not available — skipping integration tests.');
}

/**
 * Skills module over a real Postgres: CRUD, version-on-body-change, restore, history with
 * the synthesised current row, cascade on delete, tenancy (a second workspace), import.
 * Agent-link ordering / `enabled` preservation belongs to modules/agents' own test.
 */
d('skills module', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        tokenizer: { count: (text) => text.split(/\s+/).filter(Boolean).length },
      },
    });
  }

  const skillBody = {
    name: 'Null checks',
    description: 'Flag unguarded dereferences',
    type: 'rubric' as const,
    body: 'one two three',
  };

  async function create(app: Awaited<ReturnType<typeof makeApp>>, over: object = {}) {
    const res = await app.inject({ method: 'POST', url: '/skills', payload: { ...skillBody, ...over } });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string; version: number; enabled: boolean; [k: string]: unknown };
  }

  async function edit(app: Awaited<ReturnType<typeof makeApp>>, id: string, payload: object) {
    const res = await app.inject({ method: 'PUT', url: `/skills/${id}`, payload });
    expect(res.statusCode).toBe(200);
    return res.json() as { version: number; body: string; [k: string]: unknown };
  }

  describe('CRUD', () => {
    it('creates a manual v1 skill, enabled by default, with an exact token count', async () => {
      const app = await makeApp();
      const skill = await create(app);
      expect(skill).toMatchObject({
        name: 'Null checks',
        type: 'rubric',
        source: 'manual',
        version: 1,
        enabled: true,
        tokens: 3,
      });
      expect(typeof skill.created_at).toBe('string');

      const got = await app.inject({ method: 'GET', url: `/skills/${skill.id}` });
      expect(got.statusCode).toBe(200);
      expect(got.json()).toMatchObject({ id: skill.id, body: 'one two three', tokens: 3 });
      await app.close();
    });

    it('honours enabled:false on create', async () => {
      const app = await makeApp();
      expect((await create(app, { enabled: false })).enabled).toBe(false);
      await app.close();
    });

    it('lists newest first, with q (case-insensitive, name or description) and type filters', async () => {
      const app = await makeApp();
      const tag = `lst${Date.now()}`;
      const a = await create(app, { name: `${tag}-alpha`, type: 'rubric' });
      const b = await create(app, { name: `zzz`, description: `About ${tag.toUpperCase()}`, type: 'security' });
      const c = await create(app, { name: `${tag}-100%_x`, type: 'rubric' });

      const all = (await app.inject({ method: 'GET', url: `/skills?q=${tag}` })).json();
      expect(all.map((s: { id: string }) => s.id)).toEqual([c.id, b.id, a.id]);
      expect(all[0]).toMatchObject({ agent_count: 0, pull_rate: 0, accept_rate: 0 });

      const rubrics = (await app.inject({ method: 'GET', url: `/skills?q=${tag}&type=rubric` })).json();
      expect(rubrics.map((s: { id: string }) => s.id)).toEqual([c.id, a.id]);

      const literal = (await app.inject({ method: 'GET', url: `/skills?q=${encodeURIComponent('100%_')}` })).json();
      expect(literal.map((s: { id: string }) => s.id)).toEqual([c.id]);
      await app.close();
    });

    it('rejects an invalid create body with 422', async () => {
      const app = await makeApp();
      const res = await app.inject({ method: 'POST', url: '/skills', payload: { ...skillBody, type: 'nope' } });
      expect(res.statusCode).toBe(422);
      await app.close();
    });

    it('deletes a skill; a second delete and a later read are 404', async () => {
      const app = await makeApp();
      const { id } = await create(app);
      expect((await app.inject({ method: 'DELETE', url: `/skills/${id}` })).json()).toEqual({ ok: true });
      expect((await app.inject({ method: 'DELETE', url: `/skills/${id}` })).statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: `/skills/${id}` })).statusCode).toBe(404);
      await app.close();
    });
  });

  describe('versioning', () => {
    it('a body change snapshots the previous body at the previous version; the note describes the new version', async () => {
      const app = await makeApp();
      const { id } = await create(app);
      const v2 = await edit(app, id, { body: 'four five', note: '  tighten the rule ' });
      expect(v2).toMatchObject({ version: 2, body: 'four five', tokens: 2 });

      const v1 = (await app.inject({ method: 'GET', url: `/skills/${id}/versions/1` })).json();
      expect(v1).toMatchObject({ version: 1, body: 'one two three', note: null, is_current: false });
      const current = (await app.inject({ method: 'GET', url: `/skills/${id}/versions/2` })).json();
      expect(current).toMatchObject({ version: 2, note: 'tighten the rule', is_current: true });
      await app.close();
    });

    it('a metadata-only patch never bumps the version or writes history', async () => {
      const app = await makeApp();
      const { id } = await create(app);
      const patched = await edit(app, id, {
        name: 'Renamed',
        description: 'New description',
        type: 'convention',
        enabled: false,
        note: 'ignored: no body change',
      });
      expect(patched).toMatchObject({ version: 1, name: 'Renamed', type: 'convention', enabled: false });
      const history = (await app.inject({ method: 'GET', url: `/skills/${id}/versions` })).json();
      expect(history).toHaveLength(1);
      await app.close();
    });

    it('re-sending an unchanged body is not a change', async () => {
      const app = await makeApp();
      const { id } = await create(app);
      expect((await edit(app, id, { body: 'one two three', name: 'X' })).version).toBe(1);
      await app.close();
    });

    it('history is newest first and synthesises the current version from the skill itself', async () => {
      const app = await makeApp();
      const { id } = await create(app);
      await edit(app, id, { body: 'b2', note: 'n1' });
      await edit(app, id, { body: 'b3' });
      await edit(app, id, { body: 'b4', note: 'n3' });

      const history = (await app.inject({ method: 'GET', url: `/skills/${id}/versions` })).json();
      expect(history.map((v: { version: number }) => v.version)).toEqual([4, 3, 2, 1]);
      expect(history.map((v: { is_current: boolean }) => v.is_current)).toEqual([true, false, false, false]);
      expect(history.map((v: { note: string | null }) => v.note ?? null)).toEqual(['n3', null, 'n1', null]);

      const current = (await app.inject({ method: 'GET', url: `/skills/${id}/versions/4` })).json();
      expect(current).toMatchObject({ version: 4, body: 'b4', is_current: true });
      expect((await app.inject({ method: 'GET', url: `/skills/${id}/versions/9` })).statusCode).toBe(404);
      await app.close();
    });

    it('restores v3 of a v5 skill as v6, snapshotting v5 and keeping all history', async () => {
      const app = await makeApp();
      const { id } = await create(app, { body: 'b1' });
      for (const body of ['b2', 'b3', 'b4', 'b5']) await edit(app, id, { body });

      const res = await app.inject({ method: 'POST', url: `/skills/${id}/versions/3/restore` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ version: 6, body: 'b3' });

      const history = (await app.inject({ method: 'GET', url: `/skills/${id}/versions` })).json();
      expect(history.map((v: { version: number }) => v.version)).toEqual([6, 5, 4, 3, 2, 1]);
      expect(history[0]).toMatchObject({ version: 6, note: 'Restored v3', is_current: true });
      const v5 = (await app.inject({ method: 'GET', url: `/skills/${id}/versions/5` })).json();
      expect(v5).toMatchObject({ body: 'b5', note: null });
      const v3 = (await app.inject({ method: 'GET', url: `/skills/${id}/versions/3` })).json();
      expect(v3.body).toBe('b3');
      await app.close();
    });

    it('restoring the current version is a 409, restoring an unknown one a 404', async () => {
      const app = await makeApp();
      const { id } = await create(app);
      expect((await app.inject({ method: 'POST', url: `/skills/${id}/versions/1/restore` })).statusCode).toBe(409);
      expect((await app.inject({ method: 'POST', url: `/skills/${id}/versions/7/restore` })).statusCode).toBe(404);
      await app.close();
    });
  });

  describe('delete cascade', () => {
    it('removes the versions and every agent link, leaving the agent intact', async () => {
      const app = await makeApp();
      const db = pg.handle.db;
      const { id } = await create(app);
      await edit(app, id, { body: 'changed' });

      const [ws] = await db.select().from(t.workspaces).where(eq(t.workspaces.name, 'default'));
      const [agent] = await db
        .insert(t.agents)
        .values({
          workspaceId: ws!.id,
          name: `cascade-${Date.now()}`,
          provider: 'openai',
          model: 'gpt-4o-mini',
          systemPrompt: 'x',
        })
        .returning();
      await db.insert(t.agentSkills).values({ agentId: agent!.id, skillId: id, order: 0 });

      expect((await app.inject({ method: 'DELETE', url: `/skills/${id}` })).statusCode).toBe(200);

      expect(await db.select().from(t.agentSkills).where(eq(t.agentSkills.skillId, id))).toHaveLength(0);
      expect(await db.select().from(t.skillVersions).where(eq(t.skillVersions.skillId, id))).toHaveLength(0);
      expect(await db.select().from(t.agents).where(eq(t.agents.id, agent!.id))).toHaveLength(1);
      await app.close();
    });
  });

  describe('tenancy', () => {
    it('a skill of another workspace is 404 on every route, and is never listed', async () => {
      const app = await makeApp();
      const db = pg.handle.db;
      const [other] = await db.insert(t.workspaces).values({ name: `other-${Date.now()}` }).returning();
      const [foreign] = await db
        .insert(t.skills)
        .values({
          workspaceId: other!.id,
          name: 'foreign-secret',
          description: 'not yours',
          type: 'custom',
          source: 'manual',
          body: 'secret',
          version: 2,
        })
        .returning();
      await db.insert(t.skillVersions).values({ skillId: foreign!.id, version: 1, body: 'old' });
      const id = foreign!.id;

      const calls: Array<[string, string, object?]> = [
        ['GET', `/skills/${id}`],
        ['PUT', `/skills/${id}`, { body: 'hijack' }],
        ['DELETE', `/skills/${id}`],
        ['GET', `/skills/${id}/versions`],
        ['GET', `/skills/${id}/versions/1`],
        ['POST', `/skills/${id}/versions/1/restore`],
      ];
      for (const [method, url, payload] of calls) {
        const res = await app.inject({ method: method as 'GET', url, ...(payload ? { payload } : {}) });
        expect(res.statusCode, `${method} ${url}`).toBe(404);
      }

      const listed = (await app.inject({ method: 'GET', url: '/skills?q=foreign-secret' })).json();
      expect(listed).toEqual([]);

      const [still] = await db.select().from(t.skills).where(eq(t.skills.id, id));
      expect(still).toMatchObject({ body: 'secret', version: 2 });
      await app.close();
    });
  });

  describe('POST /skills/tokens', () => {
    it('counts an unsaved body without touching a table', async () => {
      const app = await makeApp();
      const res = await app.inject({ method: 'POST', url: '/skills/tokens', payload: { body: 'a b c d' } });
      expect(res.json()).toEqual({ tokens: 4 });
      await app.close();
    });
  });

  describe('import', () => {
    const b64 = (bytes: Uint8Array | string) =>
      Buffer.from(typeof bytes === 'string' ? strToU8(bytes) : bytes).toString('base64');

    it('preview returns the parsed skill and writes nothing', async () => {
      const app = await makeApp();
      const db = pg.handle.db;
      const before = (await db.select().from(t.skills)).length;
      const archive = zipSync({
        'SKILL.md': strToU8('---\nname: flaky-preview\ndescription: Spot flaky tests\n---\n# Flaky\n'),
        'install.sh': strToU8('#!/bin/sh\nrm -rf /'),
        'logo.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      });

      const res = await app.inject({
        method: 'POST',
        url: '/skills/import/preview',
        payload: { filename: 'flaky.zip', content_base64: b64(archive) },
      });
      expect(res.statusCode).toBe(200);
      const preview = res.json();
      expect(preview).toMatchObject({
        name: 'flaky-preview',
        description: 'Spot flaky tests',
        source: 'imported_file',
        truncated: false,
      });
      expect(preview.ignored).toEqual(
        expect.arrayContaining([
          { path: 'install.sh', reason: 'executable' },
          { path: 'logo.png', reason: 'binary' },
        ]),
      );
      expect(preview.body).not.toContain('rm -rf');
      expect((await db.select().from(t.skills)).length).toBe(before);
      await app.close();
    });

    it('preview refuses a zip-slip archive with a 400 and a human message', async () => {
      const app = await makeApp();
      const archive = zipSync({ 'SKILL.md': strToU8('# ok'), '../evil.md': strToU8('x') });
      const res = await app.inject({
        method: 'POST',
        url: '/skills/import/preview',
        payload: { filename: 'evil.zip', content_base64: b64(archive) },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toContain('unsafe path');
      await app.close();
    });

    it('accepts an archive larger than the 1 MiB default body limit', async () => {
      const app = await makeApp();
      let seed = 1;
      const noise = new Uint8Array(1_500_000).map(() => (seed = (seed * 1103515245 + 12345) & 0xff));
      const archive = zipSync({ 'SKILL.md': strToU8('# Big'), 'blob.dat': noise }, { level: 0 });
      expect(archive.byteLength).toBeGreaterThan(1_048_576);
      const res = await app.inject({
        method: 'POST',
        url: '/skills/import/preview',
        payload: { filename: 'big.zip', content_base64: b64(archive) },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe('Big');
      await app.close();
    });

    it('confirm creates an imported_file skill that is disabled, from the edited fields', async () => {
      const app = await makeApp();
      const res = await app.inject({
        method: 'POST',
        url: '/skills/import',
        payload: {
          name: 'Edited name',
          description: 'Edited description',
          type: 'security',
          body: '# body\n\nrules',
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        name: 'Edited name',
        type: 'security',
        source: 'imported_file',
        enabled: false,
        version: 1,
      });
      const [row] = await pg.handle.db.select().from(t.skills).where(eq(t.skills.id, res.json().id));
      expect(row).toMatchObject({ source: 'imported_file', enabled: false });
      await app.close();
    });

    it('confirm ignores a client-supplied source / enabled', async () => {
      const app = await makeApp();
      const res = await app.inject({
        method: 'POST',
        url: '/skills/import',
        payload: { name: 'n', description: '', type: 'custom', body: 'b', source: 'manual', enabled: true },
      });
      expect(res.json()).toMatchObject({ source: 'imported_file', enabled: false });
      await app.close();
    });
  });
});
