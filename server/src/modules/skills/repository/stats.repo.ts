import { and, asc, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { CategoryCount, RunAggregate } from '../stats.js';

/**
 * Ring 2 — the read queries behind skill stats. Semantics are documented in `../stats.ts`.
 *
 * `findings` carries no `workspace_id` of its own (server/INSIGHTS.md, 2026-09-17), so every
 * read of it goes through `reviews` and filters `reviews.workspace_id`. Runs are filtered on
 * `agent_runs.workspace_id`, agents on `agents.workspace_id`.
 */
export class SkillStatsRepository {
  constructor(private db: Db) {}

  /** Query 1 of `GET /skills`: agents currently linking each skill, one grouped read. */
  async agentCounts(workspaceId: string, skillIds: string[]): Promise<Map<string, number>> {
    if (skillIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        skillId: t.agentSkills.skillId,
        agentCount: sql<number>`count(*)::int`,
      })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agents.id, t.agentSkills.agentId))
      .where(and(eq(t.agents.workspaceId, workspaceId), inArray(t.agentSkills.skillId, skillIds)))
      .groupBy(t.agentSkills.skillId);
    return new Map(rows.map((r) => [r.skillId, r.agentCount]));
  }

  /** The "Agents using this skill" list of one skill. */
  async linkedAgents(workspaceId: string, skillId: string): Promise<{ id: string; name: string }[]> {
    return this.db
      .select({ id: t.agents.id, name: t.agents.name })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agents.id, t.agentSkills.agentId))
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agentSkills.skillId, skillId)))
      .orderBy(asc(t.agents.name), asc(t.agents.id));
  }

  /**
   * Query 2 of `GET /skills`: runs, inclusion, findings and verdicts for every requested
   * skill in one grouped read. A skill with no completed run in the window has no entry.
   */
  async runAggregates(
    workspaceId: string,
    skillIds: string[],
    since: Date,
  ): Promise<Map<string, RunAggregate>> {
    if (skillIds.length === 0) return new Map();
    const included = sql`${t.agentRuns.skillsUsed} @> jsonb_build_array(${t.agentSkills.skillId}::text)`;
    const rows = await this.db
      .select({
        skillId: t.agentSkills.skillId,
        runs: sql<number>`count(distinct ${t.agentRuns.id})::int`,
        runsIncluded: sql<number>`(count(distinct ${t.agentRuns.id}) filter (where ${included}))::int`,
        findings: sql<number>`(count(${t.findings.id}) filter (where ${included}))::int`,
        accepted: sql<number>`(count(${t.findings.id}) filter (where ${included} and ${t.findings.acceptedAt} is not null))::int`,
        dismissed: sql<number>`(count(${t.findings.id}) filter (where ${included} and ${t.findings.dismissedAt} is not null))::int`,
      })
      .from(t.agentSkills)
      .innerJoin(
        t.agentRuns,
        and(
          eq(t.agentRuns.agentId, t.agentSkills.agentId),
          eq(t.agentRuns.workspaceId, workspaceId),
          gte(t.agentRuns.ranAt, since),
          isNotNull(t.agentRuns.skillsUsed),
        ),
      )
      .leftJoin(
        t.reviews,
        and(eq(t.reviews.runId, t.agentRuns.id), eq(t.reviews.workspaceId, workspaceId)),
      )
      .leftJoin(t.findings, eq(t.findings.reviewId, t.reviews.id))
      .where(inArray(t.agentSkills.skillId, skillIds))
      .groupBy(t.agentSkills.skillId);
    return new Map(rows.map(({ skillId, ...agg }) => [skillId, agg]));
  }

  /** The donut: findings of the runs that included the skill, per category. */
  async categoryCounts(workspaceId: string, skillId: string, since: Date): Promise<CategoryCount[]> {
    const count = sql<number>`count(*)::int`;
    return this.db
      .select({ category: t.findings.category, count })
      .from(t.agentSkills)
      .innerJoin(
        t.agentRuns,
        and(
          eq(t.agentRuns.agentId, t.agentSkills.agentId),
          eq(t.agentRuns.workspaceId, workspaceId),
          gte(t.agentRuns.ranAt, since),
          sql`${t.agentRuns.skillsUsed} @> jsonb_build_array(${skillId}::text)`,
        ),
      )
      .innerJoin(
        t.reviews,
        and(eq(t.reviews.runId, t.agentRuns.id), eq(t.reviews.workspaceId, workspaceId)),
      )
      .innerJoin(t.findings, eq(t.findings.reviewId, t.reviews.id))
      .where(eq(t.agentSkills.skillId, skillId))
      .groupBy(t.findings.category)
      .orderBy(desc(count), asc(t.findings.category));
  }
}
