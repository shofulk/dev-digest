/**
 * PR-list findings tally — the new seam is the severity rollup: it sums over
 * EVERY review of a PR (so the list agrees with the PR header, which does the
 * same), it is not filtered by review kind, and because `findings` carries no
 * workspace_id of its own the tenancy check rides on the join to `reviews`.
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

d('PR list findings-by-severity aggregate (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;

  const finding = (reviewId: string, severity: string) => ({
    reviewId,
    file: 'src/config.ts',
    startLine: 12,
    endLine: 12,
    severity,
    category: 'security',
    title: `${severity} finding`,
    rationale: 'Because.',
    confidence: 0.9,
  });

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'sev-api', fullName: 'acme/sev-api' })
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
    const mkReview = async (prId: string, kind: 'review' | 'summary', score: number | null) => {
      const [review] = await pg.handle.db
        .insert(t.reviews)
        .values({ workspaceId, prId, kind, score, verdict: 'comment', summary: 'x' })
        .returning();
      return review!.id;
    };

    // PR 1 — two review runs plus a 'summary' record, so the tally must add up
    // across all three rather than take the latest one.
    const twoRunsPr = await mkPr(1);
    const first = await mkReview(twoRunsPr, 'review', 61);
    const second = await mkReview(twoRunsPr, 'review', 74);
    const summary = await mkReview(twoRunsPr, 'summary', null);
    await pg.handle.db.insert(t.findings).values([
      finding(first, 'CRITICAL'),
      finding(first, 'WARNING'),
      finding(second, 'CRITICAL'),
      finding(second, 'SUGGESTION'),
      finding(summary, 'WARNING'),
      // Severity is a plain text column; anything off-contract is ignored.
      finding(second, 'WEIRD'),
    ]);

    // PR 2 — reviewed, found nothing.
    const cleanPr = await mkPr(2);
    await mkReview(cleanPr, 'review', 100);

    // PR 3 — never reviewed.
    await mkPr(3);

    // Another workspace with its own repo, PR and findings: none of it may leak
    // into this repo's list (findings are only reachable through `reviews`).
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other' })
      .returning();
    const [otherRepo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: otherWs!.id,
        owner: 'other',
        name: 'sev-api',
        fullName: 'other/sev-api',
      })
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
    const [otherReview] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId: otherWs!.id,
        prId: otherPr!.id,
        kind: 'review',
        score: 10,
        verdict: 'request_changes',
        summary: 'x',
      })
      .returning();
    await pg.handle.db
      .insert(t.findings)
      .values([finding(otherReview!.id, 'CRITICAL'), finding(otherReview!.id, 'CRITICAL')]);
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

  it('sums findings over every review of the PR, ignoring unknown severities', async () => {
    const pulls = await listPulls();
    expect(pulls.find((p) => p.number === 1)?.findings_by_severity).toEqual({
      CRITICAL: 2,
      WARNING: 2,
      SUGGESTION: 1,
    });
  });

  it('reports zeros for a PR that was reviewed and came back clean', async () => {
    const pulls = await listPulls();
    const clean = pulls.find((p) => p.number === 2);
    expect(clean?.findings_by_severity).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 });
    // The list's "never reviewed" signal stays the score, not the tally.
    expect(clean?.score).toBe(100);
  });

  it('reports zeros and a null score for a PR that was never reviewed', async () => {
    const pulls = await listPulls();
    const fresh = pulls.find((p) => p.number === 3);
    expect(fresh?.findings_by_severity).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 });
    expect(fresh?.score).toBeNull();
  });

  it('does not count another workspace findings', async () => {
    const pulls = await listPulls();
    for (const p of pulls) {
      expect(p.findings_by_severity?.CRITICAL).toBeLessThanOrEqual(2);
    }
    expect(pulls.map((p) => p.number).sort()).toEqual([1, 2, 3]);
  });
});
