import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { AgentRunRow, FindingRow, MultiAgentRunRow } from '../../../db/rows.js';
import type { ReviewRow } from './review.repo.js';

/**
 * Ring 2 (infrastructure). Multi-agent run persistence: the `multi_agent_runs`
 * row, its linked `agent_runs`, and the batched reads behind the multi-run view
 * and run estimates. Every read is workspace-scoped (findings through
 * `reviews.workspace_id`, since `findings` has no workspace column).
 */

export type MultiRunAgentRun = { run: AgentRunRow; agentName: string | null };

/** Insert the multi-run (with the PR head SHA) and one `running` run per agent, in one transaction. */
export async function createMultiRunWithRuns(
  db: Db,
  values: {
    workspaceId: string;
    prId: string;
    headSha: string | null;
    runs: { agentId: string; provider: string | null; model: string | null }[];
  },
): Promise<{ multiRunId: string; runs: { runId: string; agentId: string }[] }> {
  return db.transaction(async (tx) => {
    const [multi] = await tx
      .insert(t.multiAgentRuns)
      .values({ workspaceId: values.workspaceId, prId: values.prId, headSha: values.headSha })
      .returning({ id: t.multiAgentRuns.id });
    const multiRunId = multi!.id;
    if (values.runs.length === 0) return { multiRunId, runs: [] };
    const rows = await tx
      .insert(t.agentRuns)
      .values(
        values.runs.map((r) => ({
          workspaceId: values.workspaceId,
          agentId: r.agentId,
          prId: values.prId,
          provider: r.provider,
          model: r.model,
          status: 'running',
          source: 'local' as const,
          multiAgentRunId: multiRunId,
        })),
      )
      .returning({ id: t.agentRuns.id, agentId: t.agentRuns.agentId });
    // Keep the caller's agent order (insert ... returning order is not guaranteed).
    const byAgent = new Map(rows.map((r) => [r.agentId, r.id]));
    return {
      multiRunId,
      runs: values.runs.map((r) => ({ runId: byAgent.get(r.agentId)!, agentId: r.agentId })),
    };
  });
}

/** A multi-run in this workspace, or undefined. */
export async function getMultiRun(
  db: Db,
  workspaceId: string,
  multiRunId: string,
): Promise<MultiAgentRunRow | undefined> {
  const [row] = await db
    .select()
    .from(t.multiAgentRuns)
    .where(and(eq(t.multiAgentRuns.id, multiRunId), eq(t.multiAgentRuns.workspaceId, workspaceId)));
  return row;
}

/** Every agent run linked to a multi-run (newest first), with the agent name. */
export async function runsForMultiRun(
  db: Db,
  workspaceId: string,
  multiRunId: string,
): Promise<MultiRunAgentRun[]> {
  const rows = await db
    .select({ run: t.agentRuns, agentName: t.agents.name })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(and(eq(t.agentRuns.multiAgentRunId, multiRunId), eq(t.agentRuns.workspaceId, workspaceId)))
    .orderBy(desc(t.agentRuns.ranAt), desc(t.agentRuns.id));
  return rows.map((r) => ({ run: r.run, agentName: r.agentName ?? null }));
}

/** Reviews for the given runs and their findings — two queries, scoped by `reviews.workspace_id`. */
export async function reviewsWithFindingsForRuns(
  db: Db,
  workspaceId: string,
  runIds: string[],
): Promise<{ review: ReviewRow; findings: FindingRow[] }[]> {
  if (runIds.length === 0) return [];
  const reviews = await db
    .select()
    .from(t.reviews)
    .where(and(eq(t.reviews.workspaceId, workspaceId), inArray(t.reviews.runId, runIds)))
    .orderBy(desc(t.reviews.createdAt));
  if (reviews.length === 0) return [];
  const findings = await db
    .select()
    .from(t.findings)
    .where(
      inArray(
        t.findings.reviewId,
        reviews.map((r) => r.id),
      ),
    );
  const byReview = new Map<string, FindingRow[]>();
  for (const f of findings) {
    const list = byReview.get(f.reviewId) ?? [];
    list.push(f);
    byReview.set(f.reviewId, list);
  }
  return reviews.map((review) => ({ review, findings: byReview.get(review.id) ?? [] }));
}

/**
 * The last 10 `done` runs of each agent in the workspace (any PR), newest first,
 * as plain duration/cost rows — one window-function query for all agents.
 */
export async function estimateRunRows(
  db: Db,
  workspaceId: string,
): Promise<{ agent_id: string; duration_ms: number | null; cost_usd: number | null }[]> {
  const rows = await db.execute(sql`
    select agent_id, duration_ms, cost_usd
    from (
      select agent_id, duration_ms, cost_usd,
             row_number() over (partition by agent_id order by ran_at desc, id desc) as rn
      from agent_runs
      where workspace_id = ${workspaceId} and status = 'done' and agent_id is not null
    ) ranked
    where rn <= 10
  `);
  return (rows as unknown as { agent_id: string; duration_ms: number | null; cost_usd: number | null }[]).map(
    (r) => ({ agent_id: r.agent_id, duration_ms: r.duration_ms, cost_usd: r.cost_usd }),
  );
}

/** One multi-run of the run list, with its PR's number and title. */
export type MultiRunListRow = { id: string; prId: string; ranAt: Date; prNumber: number; prTitle: string };

/** One agent run of a listed multi-run: just the fields the summary needs. */
export type MultiRunListRunRow = {
  id: string;
  multiAgentRunId: string;
  agentId: string | null;
  status: string | null;
  durationMs: number | null;
  costUsd: number | null;
};

/**
 * The newest `limit` multi-runs of a repo (or of one PR) plus their agent runs.
 * `runs` are ordered `ran_at` desc, then `id` desc. Workspace-scoped in the query.
 */
export async function listMultiRunSummaryRows(
  db: Db,
  workspaceId: string,
  repoId: string,
  prId: string | undefined,
  limit: number,
): Promise<{ multiRuns: MultiRunListRow[]; runs: MultiRunListRunRow[] }> {
  const multiRuns = await db
    .select({
      id: t.multiAgentRuns.id,
      prId: t.multiAgentRuns.prId,
      ranAt: t.multiAgentRuns.ranAt,
      prNumber: t.pullRequests.number,
      prTitle: t.pullRequests.title,
    })
    .from(t.multiAgentRuns)
    .innerJoin(t.pullRequests, eq(t.pullRequests.id, t.multiAgentRuns.prId))
    .where(
      and(
        eq(t.multiAgentRuns.workspaceId, workspaceId),
        eq(t.pullRequests.workspaceId, workspaceId),
        eq(t.pullRequests.repoId, repoId),
        prId ? eq(t.multiAgentRuns.prId, prId) : undefined,
      ),
    )
    .orderBy(desc(t.multiAgentRuns.ranAt), desc(t.multiAgentRuns.id))
    .limit(limit);
  if (multiRuns.length === 0) return { multiRuns, runs: [] };

  const rows = await db
    .select({
      id: t.agentRuns.id,
      multiAgentRunId: t.agentRuns.multiAgentRunId,
      agentId: t.agentRuns.agentId,
      status: t.agentRuns.status,
      durationMs: t.agentRuns.durationMs,
      costUsd: t.agentRuns.costUsd,
    })
    .from(t.agentRuns)
    .where(
      and(
        eq(t.agentRuns.workspaceId, workspaceId),
        inArray(
          t.agentRuns.multiAgentRunId,
          multiRuns.map((m) => m.id),
        ),
      ),
    )
    .orderBy(desc(t.agentRuns.ranAt), desc(t.agentRuns.id));
  const runs = rows.flatMap((r) => (r.multiAgentRunId ? [{ ...r, multiAgentRunId: r.multiAgentRunId }] : []));
  return { multiRuns, runs };
}
