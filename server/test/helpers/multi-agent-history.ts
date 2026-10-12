import * as t from '../../src/db/schema.js';
import type { PgFixture } from './pg.js';

/**
 * Seed helpers for the SPEC-06 run-list suites. Unlike `seedMultiRun`
 * (helpers/multi-agent.ts) these control the multi-run's own `ran_at` and `id`,
 * which the list order and tie-break tests need, and can write rows in bulk.
 */

type Db = PgFixture['handle']['db'];

export interface ListedRun {
  agentId: string | null;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  ranAt?: Date;
  durationMs?: number | null;
  costUsd?: number | null;
  /** Workspace of the agent-run row; default: the multi-run's workspace. */
  workspaceId?: string;
}

export interface ListedMultiRun {
  workspaceId: string;
  prId: string;
  ranAt: Date;
  id?: string;
  runs?: ListedRun[];
}

/** One multi-run plus its agent runs, written straight to the DB. */
export async function seedListedMultiRun(db: Db, args: ListedMultiRun): Promise<{ multiRunId: string; runIds: string[] }> {
  const [row] = await db
    .insert(t.multiAgentRuns)
    .values({ ...(args.id ? { id: args.id } : {}), workspaceId: args.workspaceId, prId: args.prId, ranAt: args.ranAt, headSha: 'a1b2c3d4' })
    .returning();
  const runIds: string[] = [];
  let offset = 0;
  for (const r of args.runs ?? []) {
    offset += 1;
    const [run] = await db
      .insert(t.agentRuns)
      .values({
        workspaceId: r.workspaceId ?? args.workspaceId,
        agentId: r.agentId,
        prId: args.prId,
        ranAt: r.ranAt ?? new Date(args.ranAt.getTime() + offset),
        provider: 'openai',
        model: 'seeded-model',
        durationMs: r.durationMs === undefined ? 1000 : r.durationMs,
        costUsd: r.costUsd === undefined ? 0.01 : r.costUsd,
        status: r.status,
        score: r.status === 'done' ? 80 : null,
        findingsCount: 0,
        multiAgentRunId: row!.id,
      })
      .returning();
    runIds.push(run!.id);
  }
  return { multiRunId: row!.id, runIds };
}

/** `count` multi-runs of one PR, each with `agentIds.length` done runs, in two bulk inserts. */
export async function bulkSeedMultiRuns(
  db: Db,
  args: { workspaceId: string; prId: string; agentIds: string[]; count: number; startAt: Date },
): Promise<string[]> {
  const multiRows = Array.from({ length: args.count }, (_, i) => ({
    workspaceId: args.workspaceId,
    prId: args.prId,
    ranAt: new Date(args.startAt.getTime() + i * 1000),
    headSha: 'a1b2c3d4',
  }));
  const multis = await db.insert(t.multiAgentRuns).values(multiRows).returning();
  const runRows = multis.flatMap((m, i) =>
    args.agentIds.map((agentId, j) => ({
      workspaceId: args.workspaceId,
      agentId,
      prId: args.prId,
      ranAt: new Date(m.ranAt.getTime() + j + 1),
      provider: 'openai' as const,
      model: 'seeded-model',
      durationMs: 1000 + i + j,
      costUsd: 0.01,
      status: 'done' as const,
      score: 80,
      findingsCount: 0,
      multiAgentRunId: m.id,
    })),
  );
  for (let at = 0; at < runRows.length; at += 500) {
    await db.insert(t.agentRuns).values(runRows.slice(at, at + 500));
  }
  return multis.map((m) => m.id);
}
