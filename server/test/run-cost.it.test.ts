/**
 * Run cost — the PR-list aggregate is the one genuinely new seam: cost is summed
 * across EVERY run of a PR (re-reviews accumulate), and a PR with no priced run
 * must read as "unknown" (null), never as $0.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { PrMeta } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('run cost aggregate (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;
  let pricedPrId: string;
  let unpricedPrId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'cost-api', fullName: 'acme/cost-api' })
      .returning();
    repoId = repo!.id;

    const mkPr = async (number: number) => {
      const [pr] = await pg.handle.db
        .insert(t.pullRequests)
        .values({
          workspaceId,
          repoId,
          number,
          title: `PR ${number}`,
          author: 'marisa.koch',
          branch: `feat/${number}`,
          base: 'main',
          headSha: `sha${number}`,
          status: 'needs_review',
        })
        .returning();
      return pr!.id;
    };
    pricedPrId = await mkPr(1);
    unpricedPrId = await mkPr(2);

    // Two settled runs on the same PR: the total must be their SUM, not the
    // latest. A third, unpriced run must not drag the total to null.
    await pg.handle.db.insert(t.agentRuns).values([
      { workspaceId, prId: pricedPrId, status: 'done', costUsd: 0.01, model: 'gpt-4.1' },
      { workspaceId, prId: pricedPrId, status: 'done', costUsd: 0.004, model: 'gpt-4.1' },
      { workspaceId, prId: pricedPrId, status: 'failed', costUsd: null, model: 'mystery' },
      // The other PR has a run, but nothing priceable.
      { workspaceId, prId: unpricedPrId, status: 'done', costUsd: null, model: 'mystery' },
    ]);
  });

  afterAll(async () => {
    await pg?.stop();
  });

  async function listPulls(): Promise<PrMeta[]> {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { embedder: new MockEmbedder(), git: new MockGitClient({ diff: '' }) },
    });
    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/pulls` });
    expect(res.statusCode).toBe(200);
    return res.json() as PrMeta[];
  }

  it('sums cost across every run of a PR, skipping unpriced ones', async () => {
    const pulls = await listPulls();
    const priced = pulls.find((p) => p.number === 1);
    expect(priced?.cost_usd).toBeCloseTo(0.014, 6);
  });

  it('reports null — not 0 — when a PR has no priced run', async () => {
    const pulls = await listPulls();
    expect(pulls.find((p) => p.number === 2)?.cost_usd).toBeNull();
  });

  it('reports null for a PR that has never been run', async () => {
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 3,
        title: 'Never reviewed',
        author: 'deepak.r',
        branch: 'feat/3',
        base: 'main',
        headSha: 'sha3',
        status: 'needs_review',
      })
      .returning();
    expect(pr).toBeDefined();
    const pulls = await listPulls();
    expect(pulls.find((p) => p.number === 3)?.cost_usd).toBeNull();
  });
});
