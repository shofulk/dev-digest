// RING 2 — persistence. Data access for the intent layer: workspace-scoped PR
// lookup, the `pr_intent` row, and the changed-file list the classifier reads
// counts/hunk-headers from. Lives under `_shared/` (not `modules/intent/`) so
// `modules/reviews` can use it without importing another module's internals
// (`no-cross-module-internals`), on the precedent of `_shared/agent-skills.ts`.
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { IntentSource } from '@devdigest/shared';
import type { PrIntentRow, PullRow } from '../../../db/rows.js';

export async function getPullWithRepo(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<{ pull: PullRow; repo: typeof t.repos.$inferSelect } | undefined> {
  const [pull] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
  if (!pull) return undefined;
  const [repo] = await db.select().from(t.repos).where(eq(t.repos.id, pull.repoId));
  if (!repo) return undefined;
  return { pull, repo };
}

export async function getIntentRow(db: Db, prId: string): Promise<PrIntentRow | undefined> {
  const [row] = await db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
  return row;
}

export interface UpsertIntentValues {
  intent: string;
  inScope: string[];
  outOfScope: string[];
  confidence: 'low' | 'medium' | 'high';
  sources: IntentSource[];
  headSha: string;
  model: string;
  stats: unknown;
}

export async function upsertIntentRow(
  db: Db,
  prId: string,
  values: UpsertIntentValues,
): Promise<PrIntentRow> {
  const set = {
    intent: values.intent,
    inScope: values.inScope,
    outOfScope: values.outOfScope,
    confidence: values.confidence,
    sources: values.sources,
    headSha: values.headSha,
    model: values.model,
    stats: values.stats,
    derivedAt: new Date(),
  };
  const [row] = await db
    .insert(t.prIntent)
    .values({ prId, ...set })
    .onConflictDoUpdate({ target: t.prIntent.prId, set })
    .returning();
  return row!;
}

/** Changed-file list the classifier reads counts + hunk-header lines from
 *  (never full patch bodies — that extraction is `intent/helpers.ts`). */
export async function getPrFilesForIntent(
  db: Db,
  prId: string,
): Promise<{ path: string; additions: number; deletions: number; patch: string | null }[]> {
  const rows = await db
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
