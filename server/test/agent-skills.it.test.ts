import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[agent-skills] Docker not available — skipping integration tests.');
}

type Link = {
  agent_id: string;
  skill_id: string;
  order: number;
  enabled: boolean;
  name: string;
  description: string;
  type: string;
  version: number;
  skill_enabled: boolean;
};

/**
 * Agent side of the skill link table (spec D, criteria 20-24). Skills are inserted
 * straight through Drizzle so this suite does not depend on the skills module.
 */
d('/agents/:id/skills', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let app: Awaited<ReturnType<typeof makeApp>>;

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    app = await makeApp();
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  async function insertSkill(
    name: string,
    over: Partial<typeof t.skills.$inferInsert> = {},
  ): Promise<typeof t.skills.$inferSelect> {
    const [row] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId,
        name,
        description: `${name} description`,
        type: 'rubric',
        source: 'manual',
        body: `body of ${name}`,
        ...over,
      })
      .returning();
    return row!;
  }

  let agentSeq = 0;
  async function createAgent(): Promise<{ id: string; version: number }> {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: `Linker ${agentSeq++}`,
        provider: 'openai',
        model: 'gpt-4.1',
        system_prompt: 'sys',
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  const post = (agentId: string, payload: unknown) =>
    app.inject({ method: 'POST', url: `/agents/${agentId}/skills`, payload: payload as object });
  const get = async (agentId: string) =>
    (await app.inject({ method: 'GET', url: `/agents/${agentId}/skills` })).json() as Link[];

  it('GET returns the links ordered, with the joined skill fields and both gates', async () => {
    const agent = await createAgent();
    const a = await insertSkill('get-a', { version: 4, type: 'convention' });
    const b = await insertSkill('get-b', { enabled: false });
    const c = await insertSkill('get-c');

    // Insert out of order on purpose; `order` must decide the response order.
    await pg.handle.db.insert(t.agentSkills).values([
      { agentId: agent.id, skillId: c.id, order: 2 },
      { agentId: agent.id, skillId: a.id, order: 0 },
      { agentId: agent.id, skillId: b.id, order: 1, enabled: false },
    ]);

    const links = await get(agent.id);
    expect(links.map((l) => l.skill_id)).toEqual([a.id, b.id, c.id]);
    expect(links[0]).toEqual({
      agent_id: agent.id,
      skill_id: a.id,
      order: 0,
      enabled: true,
      name: 'get-a',
      description: 'get-a description',
      type: 'convention',
      version: 4,
      skill_enabled: true,
    });
    expect(links[1]).toMatchObject({ enabled: false, skill_enabled: false });
    expect(links[2]).toMatchObject({ enabled: true, skill_enabled: true });
  });

  it('POST { items } sets the ordered set with per-item enabled; new links default to enabled', async () => {
    const agent = await createAgent();
    const a = await insertSkill('items-a');
    const b = await insertSkill('items-b');
    const c = await insertSkill('items-c');

    const res = await post(agent.id, {
      items: [{ skill_id: b.id }, { skill_id: a.id, enabled: false }, { skill_id: c.id, enabled: true }],
    });
    expect(res.statusCode).toBe(200);
    const links = res.json() as Link[];
    expect(links.map((l) => [l.skill_id, l.order, l.enabled])).toEqual([
      [b.id, 0, true],
      [a.id, 1, false],
      [c.id, 2, true],
    ]);
  });

  it('replacing / reordering the set PRESERVES enabled of links that remain (criterion 22)', async () => {
    const agent = await createAgent();
    const a = await insertSkill('keep-a');
    const b = await insertSkill('keep-b');
    const c = await insertSkill('keep-c');
    await post(agent.id, {
      items: [{ skill_id: a.id }, { skill_id: b.id, enabled: false }, { skill_id: c.id }],
    });

    // Reorder with the legacy body: no `enabled` anywhere.
    const reordered = (await post(agent.id, { skill_ids: [c.id, b.id, a.id] })).json() as Link[];
    expect(reordered.map((l) => [l.skill_id, l.order, l.enabled])).toEqual([
      [c.id, 0, true],
      [b.id, 1, false],
      [a.id, 2, true],
    ]);

    // Reorder + drop one + add a new one via `items` without `enabled`: b stays off, the new one is on.
    const d2 = await insertSkill('keep-d');
    const replaced = (
      await post(agent.id, { items: [{ skill_id: b.id }, { skill_id: d2.id }, { skill_id: a.id }] })
    ).json() as Link[];
    expect(replaced.map((l) => [l.skill_id, l.order, l.enabled])).toEqual([
      [b.id, 0, false],
      [d2.id, 1, true],
      [a.id, 2, true],
    ]);
    expect(await get(agent.id)).toHaveLength(3);
  });

  it('an explicit enabled in items overrides the stored value', async () => {
    const agent = await createAgent();
    const a = await insertSkill('override-a');
    await post(agent.id, { items: [{ skill_id: a.id, enabled: false }] });
    const links = (await post(agent.id, { items: [{ skill_id: a.id, enabled: true }] })).json() as Link[];
    expect(links[0]!.enabled).toBe(true);
  });

  it('an empty set unlinks everything', async () => {
    const agent = await createAgent();
    await post(agent.id, { items: [{ skill_id: (await insertSkill('empty-a')).id }] });
    expect((await post(agent.id, { items: [] })).json()).toEqual([]);
    expect(await get(agent.id)).toEqual([]);
  });

  it('POST { skill_id } links one, appended, without touching the others', async () => {
    const agent = await createAgent();
    const a = await insertSkill('one-a');
    const b = await insertSkill('one-b');
    await post(agent.id, { items: [{ skill_id: a.id, enabled: false }] });

    const links = (await post(agent.id, { skill_id: b.id })).json() as Link[];
    expect(links.map((l) => [l.skill_id, l.order, l.enabled])).toEqual([
      [a.id, 0, false],
      [b.id, 1, true],
    ]);
  });

  it('PUT /agents/:id/skills/:skillId patches enabled and order of one link', async () => {
    const agent = await createAgent();
    const a = await insertSkill('put-a');
    const b = await insertSkill('put-b');
    await post(agent.id, { items: [{ skill_id: a.id }, { skill_id: b.id }] });

    const off = await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/skills/${a.id}`,
      payload: { enabled: false },
    });
    expect(off.statusCode).toBe(200);
    expect((off.json() as Link[]).map((l) => [l.skill_id, l.order, l.enabled])).toEqual([
      [a.id, 0, false],
      [b.id, 1, true],
    ]);

    const moved = (
      await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}/skills/${a.id}`,
        payload: { order: 5 },
      })
    ).json() as Link[];
    expect(moved.map((l) => [l.skill_id, l.order, l.enabled])).toEqual([
      [b.id, 1, true],
      [a.id, 5, false],
    ]);
  });

  it('PUT 404s for an unlinked skill, an unknown agent and a malformed id', async () => {
    const agent = await createAgent();
    const stray = await insertSkill('put-stray');
    const unlinked = await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/skills/${stray.id}`,
      payload: { enabled: false },
    });
    expect(unlinked.statusCode).toBe(404);

    const noAgent = await app.inject({
      method: 'PUT',
      url: `/agents/00000000-0000-4000-8000-000000000000/skills/${stray.id}`,
      payload: { enabled: false },
    });
    expect(noAgent.statusCode).toBe(404);

    const bad = await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/skills/not-a-uuid`,
      payload: { enabled: false },
    });
    expect(bad.statusCode).toBe(422);
  });

  it('linking a skill of another workspace is 404 and links nothing (criterion 24)', async () => {
    const agent = await createAgent();
    const mine = await insertSkill('ws-mine');
    const [other] = await pg.handle.db.insert(t.workspaces).values({ name: 'Other WS' }).returning();
    const foreign = await insertSkill('ws-foreign', { workspaceId: other!.id });

    const setRes = await post(agent.id, { items: [{ skill_id: mine.id }, { skill_id: foreign.id }] });
    expect(setRes.statusCode).toBe(404);
    const legacy = await post(agent.id, { skill_ids: [foreign.id] });
    expect(legacy.statusCode).toBe(404);
    const single = await post(agent.id, { skill_id: foreign.id });
    expect(single.statusCode).toBe(404);

    const rows = await pg.handle.db
      .select()
      .from(t.agentSkills)
      .where(eq(t.agentSkills.agentId, agent.id));
    expect(rows).toEqual([]);
  });

  it('a nonexistent skill id is 404 too', async () => {
    const agent = await createAgent();
    const res = await post(agent.id, { skill_id: '00000000-0000-4000-8000-000000000000' });
    expect(res.statusCode).toBe(404);
  });

  it('a body with none of items / skill_ids / skill_id is rejected', async () => {
    const agent = await createAgent();
    expect((await post(agent.id, {})).statusCode).toBe(422);
  });

  it('link changes do not bump agents.version', async () => {
    const agent = await createAgent();
    const a = await insertSkill('version-a');
    await post(agent.id, { items: [{ skill_id: a.id }] });
    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/skills/${a.id}`,
      payload: { enabled: false },
    });
    const [row] = await pg.handle.db
      .select({ version: t.agents.version })
      .from(t.agents)
      .where(and(eq(t.agents.id, agent.id)));
    expect(row!.version).toBe(agent.version);
  });
});
