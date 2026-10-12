// RING 2 — infrastructure. The only CI file that talks to Drizzle: repo-scoped memory
// reads, the installation upsert, the run lists and the CI-run write. Returns row types from `db/rows.ts`.
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { CiInstallationRow } from '../../db/rows.js';

export type { CiInstallationRow };

export interface CiRunListRow {
  id: string;
  repo: string;
  prNumber: number | null;
  agentId: string;
  agentName: string | null;
  verdict: 'blocked' | 'passed' | 'no_findings' | 'failed';
  findingsCount: number | null;
  costUsd: number | null;
  durationMs: number | null;
  githubUrl: string | null;
  ranAt: Date;
}

export interface WriteCiRun {
  workspaceId: string;
  installationId: string;
  agentId: string;
  githubRunId: number;
  prNumber: number | null;
  githubUrl: string | null;
  ranAt: Date;
  verdict: 'blocked' | 'passed' | 'no_findings' | 'failed';
  model: string | null;
  status: 'done' | 'failed';
  error: string | null;
  durationMs: number | null;
  costUsd: number | null;
  findingsCount: number;
  blockers: number;
}

/** Thrown inside the write transaction to roll it back when the run is already stored. */
class AlreadyStored extends Error {}

export interface UpsertInstallation {
  agentId: string;
  repo: string;
  /** Status for a new row, or for an existing one that is not `active`. */
  status: 'pr_open' | 'manual';
  agentVersion: number;
  triggers: string[];
  postAs: 'github_review' | 'pr_comment' | 'none';
  /** Written only when set (the `open_pr` action). */
  prUrl?: string;
}

export class CiRepository {
  constructor(private readonly db: Db) {}

  /** The `kind`/`content` of every repo-scoped memory row of the workspace for `repoId`. */
  async repoMemory(workspaceId: string, repoId: string): Promise<{ kind: string; content: string }[]> {
    return this.db
      .select({ kind: t.memory.kind, content: t.memory.content })
      .from(t.memory)
      .where(
        and(eq(t.memory.workspaceId, workspaceId), eq(t.memory.scope, 'repo'), eq(t.memory.repoId, repoId)),
      )
      .orderBy(asc(t.memory.createdAt), asc(t.memory.id));
  }

  /** Create the installation for (agent, repo), or update it keeping an `active` status. */
  async upsertInstallation(v: UpsertInstallation): Promise<CiInstallationRow> {
    const set = {
      status: sql`CASE WHEN ${t.ciInstallations.status} = 'active' THEN 'active' ELSE ${v.status} END`,
      installedAgentVersion: v.agentVersion,
      triggers: v.triggers,
      postAs: v.postAs,
      ...(v.prUrl !== undefined ? { prUrl: v.prUrl } : {}),
    };
    const [row] = await this.db
      .insert(t.ciInstallations)
      .values({
        agentId: v.agentId,
        repo: v.repo,
        targetType: 'gha',
        status: v.status,
        installedAgentVersion: v.agentVersion,
        triggers: v.triggers,
        postAs: v.postAs,
        prUrl: v.prUrl ?? null,
      })
      .onConflictDoUpdate({ target: [t.ciInstallations.agentId, t.ciInstallations.repo], set })
      .returning();
    return row!;
  }

  /** The workspace's installations whose repository is still one of the workspace's repos. */
  async listWorkspaceInstallations(workspaceId: string): Promise<CiInstallationRow[]> {
    const rows = await this.db
      .select({ inst: t.ciInstallations })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .innerJoin(
        t.repos,
        and(eq(t.repos.fullName, t.ciInstallations.repo), eq(t.repos.workspaceId, workspaceId)),
      )
      .where(eq(t.agents.workspaceId, workspaceId))
      .orderBy(asc(t.ciInstallations.installedAt), asc(t.ciInstallations.id));
    return rows.map((r) => r.inst);
  }

  /** The agent's installations, each with its newest CI run (verdict + time), or null. */
  async listAgentInstallations(
    agentId: string,
  ): Promise<(CiInstallationRow & { lastRun: { verdict: CiRunListRow['verdict']; ranAt: Date } | null })[]> {
    const installs = await this.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agentId))
      .orderBy(asc(t.ciInstallations.installedAt), asc(t.ciInstallations.id));
    if (installs.length === 0) return [];
    const runs = await this.db
      .select({ installationId: t.ciRuns.ciInstallationId, verdict: t.ciRuns.verdict, ranAt: t.agentRuns.ranAt })
      .from(t.ciRuns)
      .innerJoin(t.agentRuns, eq(t.agentRuns.id, t.ciRuns.agentRunId))
      .where(
        inArray(
          t.ciRuns.ciInstallationId,
          installs.map((i) => i.id),
        ),
      )
      .orderBy(desc(t.agentRuns.ranAt), desc(t.ciRuns.id));
    return installs.map((i) => {
      const last = runs.find((r) => r.installationId === i.id);
      return { ...i, lastRun: last ? { verdict: last.verdict, ranAt: last.ranAt } : null };
    });
  }

  /** CI runs of the workspace, newest first; limited to one agent when `agentId` is given. */
  async listRuns(workspaceId: string, agentId: string | null, limit: number): Promise<CiRunListRow[]> {
    return this.db
      .select({
        id: t.ciRuns.id,
        repo: t.ciInstallations.repo,
        prNumber: t.ciRuns.prNumber,
        agentId: t.ciInstallations.agentId,
        agentName: t.agents.name,
        verdict: t.ciRuns.verdict,
        findingsCount: t.agentRuns.findingsCount,
        costUsd: t.agentRuns.costUsd,
        durationMs: t.agentRuns.durationMs,
        githubUrl: t.ciRuns.githubUrl,
        ranAt: t.agentRuns.ranAt,
      })
      .from(t.ciRuns)
      .innerJoin(
        t.agentRuns,
        and(eq(t.agentRuns.id, t.ciRuns.agentRunId), eq(t.agentRuns.workspaceId, workspaceId)),
      )
      .innerJoin(t.ciInstallations, eq(t.ciInstallations.id, t.ciRuns.ciInstallationId))
      .leftJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .where(agentId ? eq(t.ciInstallations.agentId, agentId) : undefined)
      .orderBy(desc(t.agentRuns.ranAt), desc(t.ciRuns.id))
      .limit(limit);
  }

  /** Ids of those installations that already have a `ci_runs` row for the GitHub run. */
  async storedInstallations(githubRunId: number, installationIds: string[]): Promise<string[]> {
    if (installationIds.length === 0) return [];
    const rows = await this.db
      .select({ id: t.ciRuns.ciInstallationId })
      .from(t.ciRuns)
      .where(and(eq(t.ciRuns.githubRunId, githubRunId), inArray(t.ciRuns.ciInstallationId, installationIds)));
    return rows.flatMap((r) => (r.id ? [r.id] : []));
  }

  /**
   * Write the `agent_runs` + `ci_runs` pair and mark the installation `active`, in one
   * transaction. Returns false (and writes nothing) when the run is already stored.
   */
  async writeCiRun(v: WriteCiRun): Promise<boolean> {
    try {
      await this.db.transaction(async (tx) => {
        const [ar] = await tx
          .insert(t.agentRuns)
          .values({
            workspaceId: v.workspaceId,
            agentId: v.agentId,
            prId: null,
            source: 'ci',
            provider: 'openrouter',
            model: v.model,
            status: v.status,
            error: v.error,
            durationMs: v.durationMs,
            costUsd: v.costUsd,
            findingsCount: v.findingsCount,
            blockers: v.blockers,
            ranAt: v.ranAt,
          })
          .returning({ id: t.agentRuns.id });
        const inserted = await tx
          .insert(t.ciRuns)
          .values({
            ciInstallationId: v.installationId,
            agentRunId: ar!.id,
            githubRunId: v.githubRunId,
            prNumber: v.prNumber,
            githubUrl: v.githubUrl,
            verdict: v.verdict,
            ranAt: v.ranAt,
          })
          .onConflictDoNothing()
          .returning({ id: t.ciRuns.id });
        if (inserted.length === 0) throw new AlreadyStored();
        await tx
          .update(t.ciInstallations)
          .set({ status: 'active' })
          .where(eq(t.ciInstallations.id, v.installationId));
      });
      return true;
    } catch (err) {
      if (err instanceof AlreadyStored) return false;
      throw err;
    }
  }
}
