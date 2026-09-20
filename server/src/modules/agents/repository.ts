import { and, asc, desc, eq, inArray, notInArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { CiFailOn, Provider, ReviewStrategy, SkillType } from '@devdigest/shared';
import { DEFAULT_AGENT_DESCRIPTION, INITIAL_AGENT_VERSION } from './constants.js';
import { isConfigChange } from './helpers.js';

/**
 * A2 — agents data-access. Owns `agents`, `agent_versions`, and the
 * `agent_skills` link table (shared with A1's skills repository, but A2 owns the
 * agent side: link/reorder/list for an agent). Workspace-scoped throughout.
 */

import type { AgentRow, AgentVersionRow } from '../../db/rows.js';
export type { AgentRow, AgentVersionRow };

export interface InsertAgent {
  workspaceId: string;
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  systemPrompt: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
  enabled?: boolean;
  createdBy?: string | null;
}

export interface UpdateAgent {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  systemPrompt?: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
  enabled?: boolean;
}

/** One `agent_skills` link joined with the skill's display fields (no body). */
export interface LinkedSkillRow {
  skillId: string;
  order: number;
  /** Per-agent toggle (the link's own flag). */
  enabled: boolean;
  name: string;
  description: string;
  type: SkillType;
  version: number;
  /** The skill's global flag — the second gate. */
  skillEnabled: boolean;
}

/** One entry of the ordered set handed to `setSkills`; `enabled` undefined = keep as is. */
export interface SkillLinkInput {
  skillId: string;
  enabled?: boolean;
}

export class AgentsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<AgentRow[]> {
    return this.db.select().from(t.agents).where(eq(t.agents.workspaceId, workspaceId));
  }

  async listEnabled(workspaceId: string): Promise<AgentRow[]> {
    return this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.enabled, true)));
  }

  async getById(workspaceId: string, id: string): Promise<AgentRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)));
    return row;
  }

  /** Delete an agent (scoped to workspace). Versions/skill-links cascade;
   *  agent_runs keep their history with agent_id set null. Returns false if
   *  no such agent existed in the workspace. */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
      .returning({ id: t.agents.id });
    return rows.length > 0;
  }

  /** Insert an agent AND record version 1 in agent_versions (immutable snapshot). */
  async insert(values: InsertAgent): Promise<AgentRow> {
    const [row] = await this.db
      .insert(t.agents)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description ?? DEFAULT_AGENT_DESCRIPTION,
        provider: values.provider,
        model: values.model,
        systemPrompt: values.systemPrompt,
        outputSchema: (values.outputSchema as object | undefined) ?? null,
        ...(values.strategy !== undefined ? { strategy: values.strategy } : {}),
        ...(values.ciFailOn !== undefined ? { ciFailOn: values.ciFailOn } : {}),
        ...(values.repoIntel !== undefined ? { repoIntel: values.repoIntel } : {}),
        enabled: values.enabled ?? true,
        version: INITIAL_AGENT_VERSION,
        createdBy: values.createdBy ?? null,
      })
      .returning();
    await this.snapshotVersion(row!, INITIAL_AGENT_VERSION);
    return row!;
  }

  /**
   * Update an agent. Any config change bumps the version and snapshots the new
   * config into agent_versions (reproducibility for eval).
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateAgent,
  ): Promise<AgentRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    // A config-affecting change (anything except just toggling enabled) bumps version.
    const configChanged = isConfigChange(existing, patch);
    const nextVersion = configChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.agents)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
        ...(patch.model !== undefined ? { model: patch.model } : {}),
        ...(patch.systemPrompt !== undefined ? { systemPrompt: patch.systemPrompt } : {}),
        ...(patch.outputSchema !== undefined
          ? { outputSchema: patch.outputSchema as object }
          : {}),
        ...(patch.strategy !== undefined ? { strategy: patch.strategy } : {}),
        ...(patch.ciFailOn !== undefined ? { ciFailOn: patch.ciFailOn } : {}),
        ...(patch.repoIntel !== undefined ? { repoIntel: patch.repoIntel } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(configChanged ? { version: nextVersion } : {}),
      })
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
      .returning();

    if (configChanged && row) await this.snapshotVersion(row, nextVersion);
    return row;
  }

  private async snapshotVersion(row: AgentRow, version: number): Promise<void> {
    const skills = await this.skillIdsForAgent(row.id);
    await this.db
      .insert(t.agentVersions)
      .values({
        agentId: row.id,
        version,
        configJson: {
          provider: row.provider,
          model: row.model,
          system_prompt: row.systemPrompt,
          output_schema: row.outputSchema,
          strategy: row.strategy,
          ci_fail_on: row.ciFailOn,
          repo_intel: row.repoIntel,
          skills,
        },
      })
      .onConflictDoNothing();
  }

  // ---- agent_versions (immutable config snapshots) ------------------------

  /** All config snapshots for an agent, newest version first. */
  async listVersions(agentId: string): Promise<AgentVersionRow[]> {
    return this.db
      .select()
      .from(t.agentVersions)
      .where(eq(t.agentVersions.agentId, agentId))
      .orderBy(desc(t.agentVersions.version));
  }

  /** A single config snapshot, or undefined if that version was never recorded. */
  async getVersion(agentId: string, version: number): Promise<AgentVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.agentVersions)
      .where(and(eq(t.agentVersions.agentId, agentId), eq(t.agentVersions.version, version)));
    return row;
  }

  // ---- agent_skills link table (A2 owns the agent side) -------------------

  /** Skills linked to an agent, in `order` ascending — one joined query. */
  async linkedSkills(agentId: string): Promise<LinkedSkillRow[]> {
    return this.db
      .select({
        skillId: t.skills.id,
        order: t.agentSkills.order,
        enabled: t.agentSkills.enabled,
        name: t.skills.name,
        description: t.skills.description,
        type: t.skills.type,
        version: t.skills.version,
        skillEnabled: t.skills.enabled,
      })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(eq(t.agentSkills.agentId, agentId))
      .orderBy(asc(t.agentSkills.order), asc(t.skills.name));
  }

  async skillIdsForAgent(agentId: string): Promise<string[]> {
    const links = await this.linkedSkills(agentId);
    return links.map((l) => l.skillId);
  }

  /** The subset of `skillIds` that exist in `workspaceId` — the tenancy check for linking. */
  async skillIdsInWorkspace(workspaceId: string, skillIds: string[]): Promise<Set<string>> {
    if (skillIds.length === 0) return new Set();
    const rows = await this.db
      .select({ id: t.skills.id })
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), inArray(t.skills.id, skillIds)));
    return new Set(rows.map((r) => r.id));
  }

  /** Link a skill to an agent at a given order (idempotent: upserts order, never touches `enabled`). */
  async linkSkill(agentId: string, skillId: string, order: number): Promise<void> {
    await this.db
      .insert(t.agentSkills)
      .values({ agentId, skillId, order })
      .onConflictDoUpdate({
        target: [t.agentSkills.agentId, t.agentSkills.skillId],
        set: { order },
      });
  }

  async unlinkSkill(agentId: string, skillId: string): Promise<void> {
    await this.db
      .delete(t.agentSkills)
      .where(and(eq(t.agentSkills.agentId, agentId), eq(t.agentSkills.skillId, skillId)));
  }

  /** Patch one link. Returns false when the agent does not link that skill. */
  async updateLink(
    agentId: string,
    skillId: string,
    patch: { enabled?: boolean; order?: number },
  ): Promise<boolean> {
    const set = {
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.order !== undefined ? { order: patch.order } : {}),
    };
    const where = and(eq(t.agentSkills.agentId, agentId), eq(t.agentSkills.skillId, skillId));
    if (Object.keys(set).length === 0) {
      const [row] = await this.db.select({ id: t.agentSkills.skillId }).from(t.agentSkills).where(where);
      return row !== undefined;
    }
    const rows = await this.db
      .update(t.agentSkills)
      .set(set)
      .where(where)
      .returning({ id: t.agentSkills.skillId });
    return rows.length > 0;
  }

  /**
   * Replace the full set of linked skills for an agent, assigning order = index
   * (first occurrence wins on duplicates). Links that remain are UPDATED in place,
   * never deleted and re-inserted, so their `enabled` survives a reorder; an item
   * with no `enabled` keeps the link's current value, a new link defaults to true.
   * Skills not in the list are unlinked.
   */
  async setSkills(agentId: string, items: SkillLinkInput[]): Promise<void> {
    const seen = new Set<string>();
    const unique = items.filter((i) => !seen.has(i.skillId) && seen.add(i.skillId));

    await this.db.transaction(async (tx) => {
      const current = await tx
        .select({ skillId: t.agentSkills.skillId, enabled: t.agentSkills.enabled })
        .from(t.agentSkills)
        .where(eq(t.agentSkills.agentId, agentId));
      const currentEnabled = new Map(current.map((c) => [c.skillId, c.enabled]));

      await tx
        .delete(t.agentSkills)
        .where(
          unique.length === 0
            ? eq(t.agentSkills.agentId, agentId)
            : and(
                eq(t.agentSkills.agentId, agentId),
                notInArray(
                  t.agentSkills.skillId,
                  unique.map((i) => i.skillId),
                ),
              ),
        );
      if (unique.length === 0) return;

      for (const [order, item] of unique.entries()) {
        const enabled = item.enabled ?? currentEnabled.get(item.skillId) ?? true;
        await tx
          .insert(t.agentSkills)
          .values({ agentId, skillId: item.skillId, order, enabled })
          .onConflictDoUpdate({
            target: [t.agentSkills.agentId, t.agentSkills.skillId],
            set: { order, enabled },
          });
      }
    });
  }
}
