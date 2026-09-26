/**
 * T5 — DB-backed route test over the seeded PR #482, plus a cross-workspace 404.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import type { SmartDiff } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('GET /pulls/:id/smart-diff (Testcontainers pg)', () => {
  let pg: PgFixture;
  let pr482Id: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [repo] = await pg.handle.db.select().from(t.repos);
    const [pr] = await pg.handle.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.repoId, repo!.id), eq(t.pullRequests.number, 482)));
    pr482Id = pr!.id;
  });

  afterAll(async () => {
    await pg.stop();
  });

  it('PR #482 → 200, one core group with the 4 seeded files in order, correct finding_lines', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr482Id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SmartDiff;
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0]!.role).toBe('core');
    expect(body.groups[0]!.files.map((f) => f.path)).toEqual([
      'src/middleware/ratelimit.ts',
      'src/api/public/webhooks.ts',
      'src/config.ts',
      'src/api/users.ts',
    ]);
    const configFile = body.groups[0]!.files.find((f) => f.path === 'src/config.ts')!;
    expect(configFile.finding_lines).toEqual([12]);
    const usersFile = body.groups[0]!.files.find((f) => f.path === 'src/api/users.ts')!;
    expect(usersFile.finding_lines).toEqual([45, 46, 47, 48, 49, 50, 51, 52]);
    await app.close();
  });

  it('after dismissing the config finding, its finding_lines is empty', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const [finding] = await pg.handle.db
      .select()
      .from(t.findings)
      .where(eq(t.findings.file, 'src/config.ts'));
    const dismiss = await app.inject({ method: 'POST', url: `/findings/${finding!.id}/dismiss` });
    expect(dismiss.statusCode).toBe(200);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr482Id}/smart-diff` });
    const body = res.json() as SmartDiff;
    const configFile = body.groups[0]!.files.find((f) => f.path === 'src/config.ts')!;
    expect(configFile.finding_lines).toEqual([]);
    await app.close();
  });

  it('a PR id from another workspace → 404', async () => {
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'other-smart-diff' }).returning();
    const [otherRepo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: otherWs!.id, owner: 'other', name: 'x', fullName: 'other/x' })
      .returning();
    const [otherPr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: otherWs!.id,
        repoId: otherRepo!.id,
        number: 1,
        title: 'Other workspace PR',
        author: 'nobody',
        branch: 'feat/x',
        base: 'main',
        headSha: 'shax',
        status: 'needs_review',
      })
      .returning();

    const app = await buildApp({ config: config(), db: pg.handle.db });
    const res = await app.inject({ method: 'GET', url: `/pulls/${otherPr!.id}/smart-diff` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
