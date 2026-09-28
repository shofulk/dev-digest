/**
 * T6 — DB-backed route test over the seeded PR #482, plus a cross-workspace 404.
 * Exercises the real `getResolvedCallers` SQL (with `declFile`) end to end.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { INDEXER_VERSION } from '../src/modules/repo-intel/constants.js';
import type { BlastRadius } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('GET /pulls/:id/blast (Testcontainers pg)', () => {
  let pg: PgFixture;
  let pr482Id: string;
  let repoId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [repo] = await pg.handle.db.select().from(t.repos);
    repoId = repo!.id;
    const [pr] = await pg.handle.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.repoId, repo!.id), eq(t.pullRequests.number, 482)));
    pr482Id = pr!.id;
  });

  afterAll(async () => {
    await pg.stop();
  });

  it('(a) no index -> 200, degraded no_data, empty downstream, limits present', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr482Id}/blast` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as BlastRadius;
    expect(body.degraded).toBe(true);
    expect(body.reason).toBe('no_data');
    expect(body.downstream).toEqual([]);
    expect(body.limits).toEqual({ max_callers_per_symbol: 20, bfs_depth: 2 });
    await app.close();
  });

  it('(b) full index -> direct + depth-2 callers, endpoints/crons attributed, self-file caller excluded', async () => {
    await pg.handle.db.insert(t.repoIndexState).values({
      repoId,
      lastIndexedSha: 'sha-blast',
      indexerVersion: INDEXER_VERSION,
      status: 'full',
      filesIndexed: 5,
      filesSkipped: 0,
    });

    await pg.handle.db.insert(t.symbols).values([
      { repoId, path: 'src/middleware/ratelimit.ts', name: 'rateLimit', kind: 'function', line: 1, exported: true },
      { repoId, path: 'src/api/public/data.ts', name: 'dataHandler', kind: 'function', line: 20, exported: true },
      { repoId, path: 'src/api/admin.ts', name: 'guard', kind: 'function', line: 35, exported: true },
      { repoId, path: 'src/jobs/cleanup.ts', name: 'cleanupJob', kind: 'function', line: 10, exported: true },
      { repoId, path: 'src/api/routes.ts', name: 'routeHandler', kind: 'function', line: 5, exported: true },
    ]);

    await pg.handle.db.insert(t.references).values([
      { repoId, fromPath: 'src/api/public/data.ts', toSymbol: 'rateLimit', line: 23, declFile: 'src/middleware/ratelimit.ts' },
      { repoId, fromPath: 'src/api/admin.ts', toSymbol: 'rateLimit', line: 40, declFile: 'src/middleware/ratelimit.ts' },
      { repoId, fromPath: 'src/jobs/cleanup.ts', toSymbol: 'rateLimit', line: 12, declFile: 'src/middleware/ratelimit.ts' },
      // self-file reference to the declaring file itself -> must never appear as a caller
      { repoId, fromPath: 'src/middleware/ratelimit.ts', toSymbol: 'rateLimit', line: 5, declFile: 'src/middleware/ratelimit.ts' },
      // depth-2 chain: routes.ts calls the exported `guard` (declared in admin.ts, itself a hop-1 caller of rateLimit)
      { repoId, fromPath: 'src/api/routes.ts', toSymbol: 'guard', line: 8, declFile: 'src/api/admin.ts' },
    ]);

    const files = [
      'src/middleware/ratelimit.ts',
      'src/api/public/data.ts',
      'src/api/admin.ts',
      'src/jobs/cleanup.ts',
      'src/api/routes.ts',
    ];
    await pg.handle.db.insert(t.fileRank).values(
      files.map((filePath, i) => ({
        repoId,
        filePath,
        pagerank: 1 - i * 0.1,
        hotness: 0,
        rank: 1 - i * 0.1,
        percentile: 90 - i,
      })),
    );

    await pg.handle.db.insert(t.fileFacts).values([
      { repoId, filePath: 'src/api/public/data.ts', endpoints: ['GET /public/data'], crons: [] },
      { repoId, filePath: 'src/api/routes.ts', endpoints: ['GET /admin'], crons: [] },
      { repoId, filePath: 'src/jobs/cleanup.ts', endpoints: [], crons: ['job:cleanup'] },
    ]);

    const app = await buildApp({ config: config(), db: pg.handle.db });
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr482Id}/blast` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as BlastRadius;
    expect(body.degraded).toBe(false);
    expect(body.downstream).toHaveLength(1);
    const rateLimit = body.downstream[0]!;
    expect(rateLimit.symbol).toBe('rateLimit');

    expect(rateLimit.callers.find((c) => c.file === 'src/middleware/ratelimit.ts')).toBeUndefined();

    const direct = rateLimit.callers.filter((c) => !c.depth || c.depth === 1);
    expect(direct.map((c) => `${c.file}:${c.line}`).sort()).toEqual(
      ['src/api/admin.ts:40', 'src/api/public/data.ts:23', 'src/jobs/cleanup.ts:12'].sort(),
    );
    const hop2 = rateLimit.callers.filter((c) => c.depth === 2);
    expect(hop2).toHaveLength(1);
    expect(hop2[0]).toMatchObject({ file: 'src/api/routes.ts', line: 8, via: 'guard' });

    expect(rateLimit.endpoints_affected.sort()).toEqual(['GET /admin', 'GET /public/data'].sort());
    expect(rateLimit.crons_affected).toEqual(['job:cleanup']);

    await app.close();
  });

  it('(c) partial index -> same map, reason index_partial', async () => {
    await pg.handle.db
      .update(t.repoIndexState)
      .set({ status: 'partial' })
      .where(eq(t.repoIndexState.repoId, repoId));
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr482Id}/blast` });
    const body = res.json() as BlastRadius;
    expect(body.reason).toBe('index_partial');
    expect(body.downstream).toHaveLength(1);
    await app.close();
  });

  it('(d) flag off -> flag_off', async () => {
    const flagOffConfig = loadConfig({ ...process.env, NODE_ENV: 'test', REPO_INTEL_ENABLED: 'false' } as NodeJS.ProcessEnv);
    const app = await buildApp({ config: flagOffConfig, db: pg.handle.db });
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr482Id}/blast` });
    const body = res.json() as BlastRadius;
    expect(body.reason).toBe('flag_off');
    await app.close();
  });

  it('(e) a PR id from another workspace -> 404', async () => {
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'other-blast' }).returning();
    const [otherRepo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: otherWs!.id, owner: 'other', name: 'x', fullName: 'other/x-blast' })
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
    const res = await app.inject({ method: 'GET', url: `/pulls/${otherPr!.id}/blast` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
