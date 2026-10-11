import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { MemoryRow } from '../../../db/rows.js';

/**
 * Ring 2 (infrastructure). The first writer of the `memory` table: the Learn
 * action stores one `learning` row per finding. A row is tied to its finding by
 * `sources: [{ pr, context: "finding:<id>" }]`.
 */

export type NewLearning = {
  workspaceId: string;
  repoId: string;
  content: string;
  prNumber: number;
  findingId: string;
};

const findingContext = (findingId: string): string => `finding:${findingId}`;

const learningSourceMatch = (findingId: string) =>
  sql`${t.memory.sources} @> ${JSON.stringify([{ context: findingContext(findingId) }])}::jsonb`;

/** The ids (among `findingIds`) that already have a Learn memory row — one query. */
export async function findLearnings(
  db: Db,
  workspaceId: string,
  findingIds: string[],
): Promise<Set<string>> {
  if (findingIds.length === 0) return new Set();
  const contexts = findingIds.map(findingContext);
  const list = sql.join(contexts.map((c) => sql`${c}`), sql`, `);
  const rows = await db
    .select({ sources: t.memory.sources })
    .from(t.memory)
    .where(
      and(
        eq(t.memory.workspaceId, workspaceId),
        eq(t.memory.kind, 'learning'),
        sql`case when jsonb_typeof(${t.memory.sources}) = 'array'
          then exists (select 1 from jsonb_array_elements(${t.memory.sources}) e where e->>'context' in (${list}))
          else false end`,
      ),
    );
  const wanted = new Set(contexts);
  const learned = new Set<string>();
  for (const row of rows) {
    for (const src of (row.sources as { context?: string }[] | null) ?? []) {
      if (src.context && wanted.has(src.context)) learned.add(src.context.slice('finding:'.length));
    }
  }
  return learned;
}

/** Insert one `learning` memory row (scope `repo`, no embedding, no confidence). */
export async function insertLearning(db: Pick<Db, 'insert'>, v: NewLearning): Promise<MemoryRow> {
  const [row] = await db
    .insert(t.memory)
    .values({
      workspaceId: v.workspaceId,
      repoId: v.repoId,
      scope: 'repo',
      kind: 'learning',
      content: v.content,
      sources: [{ pr: v.prNumber, context: findingContext(v.findingId) }],
      embedding: null,
      confidence: null,
    })
    .returning();
  return row!;
}

/**
 * Idempotent Learn: check for an existing row for the finding and insert when
 * absent, in one transaction. (No unique constraint: two concurrent first
 * clicks can still both insert.)
 */
export async function learnOnce(db: Db, v: NewLearning): Promise<{ row: MemoryRow; created: boolean }> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(t.memory)
      .where(
        and(
          eq(t.memory.workspaceId, v.workspaceId),
          eq(t.memory.kind, 'learning'),
          learningSourceMatch(v.findingId),
        ),
      )
      .limit(1);
    if (existing) return { row: existing, created: false };
    return { row: await insertLearning(tx, v), created: true };
  });
}
