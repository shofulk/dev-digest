import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import { seedProjectContextDemo } from '../src/db/seed-project-context.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[seed-project-context] Docker not available — skipping integration tests.');
}

/**
 * F17 (fix round 3) — re-seeding must not overwrite a user's later edit to
 * `repos.clone_path` or the Security Reviewer agent's `context_docs`: both
 * are written only on the first seed.
 */
d('seedProjectContextDemo — does not overwrite a user edit on re-seed', () => {
  let pg: PgFixture;
  let tmpDir1: string;
  let tmpDir2: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    tmpDir1 = await mkdtemp(join(tmpdir(), 'devdigest-seed-fix17-first-'));
    tmpDir2 = await mkdtemp(join(tmpdir(), 'devdigest-seed-fix17-second-'));
  });
  afterAll(async () => {
    await pg?.stop();
    await rm(tmpDir1, { recursive: true, force: true });
    await rm(tmpDir2, { recursive: true, force: true });
  });

  it('keeps a user edit to clone_path and context_docs across a second seed', async () => {
    await seedProjectContextDemo(pg.handle.db, tmpDir1);

    const [repoAfterFirst] = await pg.handle.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.fullName, 'acme/payments-api'));
    expect(repoAfterFirst!.clonePath).toBe(`${tmpDir1}/acme/payments-api`);

    // The first seed on a fresh DB must attach the demo context doc to the
    // Security Reviewer agent (D10) — plan-verifier flagged no test asserted this.
    const [agentAfterFirst] = await pg.handle.db
      .select()
      .from(t.agents)
      .where(
        and(
          eq(t.agents.workspaceId, repoAfterFirst!.workspaceId),
          eq(t.agents.name, 'Security Reviewer'),
        ),
      );
    expect(agentAfterFirst!.contextDocs).toEqual(['docs/architecture.md']);

    // Simulate the user's own edits after the first seed.
    const userClonePath = '/home/user/my-custom-checkout';
    await pg.handle.db
      .update(t.repos)
      .set({ clonePath: userClonePath })
      .where(eq(t.repos.id, repoAfterFirst!.id));

    const [agent] = await pg.handle.db
      .select()
      .from(t.agents)
      .where(
        and(
          eq(t.agents.workspaceId, repoAfterFirst!.workspaceId),
          eq(t.agents.name, 'Security Reviewer'),
        ),
      );
    const userContextDocs = ['specs/rate-limiting.spec.md', 'insights/INSIGHTS.md'];
    await pg.handle.db
      .update(t.agents)
      .set({ contextDocs: userContextDocs })
      .where(eq(t.agents.id, agent!.id));

    // Re-seed with a DIFFERENT clone dir — if the guard were absent, this
    // would both move clone_path back and reset context_docs.
    await seedProjectContextDemo(pg.handle.db, tmpDir2);

    const [repoAfterSecond] = await pg.handle.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.fullName, 'acme/payments-api'));
    expect(repoAfterSecond!.clonePath).toBe(userClonePath);

    const [agentAfterSecond] = await pg.handle.db
      .select()
      .from(t.agents)
      .where(eq(t.agents.id, agent!.id));
    expect(agentAfterSecond!.contextDocs).toEqual(userContextDocs);
  });
});
