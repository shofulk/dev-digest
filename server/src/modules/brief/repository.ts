// RING 2 — persistence. Workspace-scoped PR/file lookup for the brief use
// case and the `pr_brief` row mapping (D1). Drizzle/`db/schema.js` stays
// behind this file; `BriefService` (ring 1) only ever sees `BriefPull` /
// `BriefPrFile` / `PrBrief` (`onion-architecture`).
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { PrBrief } from '@devdigest/shared';
import type { BriefPrFile, BriefPull } from './service.js';

export class BriefRepository {
  constructor(private db: Db) {}

  /** Workspace-scoped PR lookup, joined to its repo for `clone_path` (D6's
   *  checkout root for project-context documents). `undefined` when the PR
   *  is not in this workspace — the service turns that into a 404. */
  async getPull(workspaceId: string, prId: string): Promise<BriefPull | undefined> {
    const [row] = await this.db
      .select({
        id: t.pullRequests.id,
        title: t.pullRequests.title,
        body: t.pullRequests.body,
        headSha: t.pullRequests.headSha,
        lastReviewedSha: t.pullRequests.lastReviewedSha,
        clonePath: t.repos.clonePath,
      })
      .from(t.pullRequests)
      .innerJoin(t.repos, eq(t.repos.id, t.pullRequests.repoId))
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    if (!row) return undefined;
    return {
      id: row.id,
      title: row.title,
      body: row.body,
      headSha: row.headSha,
      lastReviewedSha: row.lastReviewedSha,
      clonePath: row.clonePath,
    };
  }

  async getPrFiles(prId: string): Promise<BriefPrFile[]> {
    const rows = await this.db
      .select({
        path: t.prFiles.path,
        additions: t.prFiles.additions,
        deletions: t.prFiles.deletions,
        patch: t.prFiles.patch,
      })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId));
    return rows;
  }

  /** D1: a row that fails to parse against the `PrBrief` contract is treated
   *  as "no brief" (forward-compat guard for any future field). */
  async getBrief(prId: string): Promise<PrBrief | null> {
    const [row] = await this.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    if (!row) return null;
    const json = row.json as Record<string, unknown>;
    const [provider, ...modelParts] = (row.model ?? '').split('/');
    const candidate = {
      ...json,
      pr_id: prId,
      head_sha: row.headSha,
      model: modelParts.join('/'),
      provider,
      generated_at: row.generatedAt.toISOString(),
      stats: row.stats,
    };
    const parsed = PrBrief.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  }

  async saveBrief(brief: PrBrief): Promise<void> {
    const { pr_id, head_sha, provider, model, generated_at, stats, ...json } = brief;
    const values = {
      prId: pr_id,
      json,
      headSha: head_sha,
      model: `${provider}/${model}`,
      generatedAt: new Date(generated_at),
      stats,
    };
    await this.db
      .insert(t.prBrief)
      .values(values)
      .onConflictDoUpdate({ target: t.prBrief.prId, set: values });
  }
}
