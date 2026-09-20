import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
import type { SkillType } from '@devdigest/shared';
import { INITIAL_SKILL_VERSION } from './constants.js';

/**
 * Ring 2 — skills data access. Owns `skills` and `skill_versions`; the `agent_skills` link
 * table belongs to modules/agents (links vanish here only through the FK cascade).
 * Every read and write is scoped by workspace, so a foreign id is indistinguishable from
 * a missing one.
 */
export type { SkillRow, SkillVersionRow };

export interface ListSkillsFilter {
  q?: string;
  type?: SkillType;
}

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description: string;
  type: SkillType;
  source: SkillRow['source'];
  body: string;
  enabled: boolean;
  evidenceFiles?: string[] | null;
}

export interface SkillFields {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
}

/** What one save does, decided by the service from the row it is about to replace. */
export interface SkillPlan {
  fields: SkillFields;
  /** Present when the body changes: snapshot the current body, then bump the version. */
  snapshot?: { note: string | null };
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');

export class SkillsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string, filter: ListSkillsFilter = {}): Promise<SkillRow[]> {
    const conditions = [eq(t.skills.workspaceId, workspaceId)];
    if (filter.type) conditions.push(eq(t.skills.type, filter.type));
    if (filter.q) {
      const pattern = `%${escapeLike(filter.q)}%`;
      conditions.push(or(ilike(t.skills.name, pattern), ilike(t.skills.description, pattern))!);
    }
    return this.db
      .select()
      .from(t.skills)
      .where(and(...conditions))
      .orderBy(desc(t.skills.createdAt), desc(t.skills.id));
  }

  async getById(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  async insert(values: InsertSkill): Promise<SkillRow> {
    const [row] = await this.db
      .insert(t.skills)
      .values({ ...values, version: INITIAL_SKILL_VERSION })
      .returning();
    return row!;
  }

  /**
   * Apply one save atomically: lock the row, let `plan` decide from its current state, then
   * snapshot + bump + write. The lock is what keeps two concurrent body edits from both
   * snapshotting the same version.
   */
  async update(
    workspaceId: string,
    id: string,
    plan: (current: SkillRow) => SkillPlan,
  ): Promise<SkillRow | undefined> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(t.skills)
        .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
        .for('update');
      if (!current) return undefined;

      const { fields, snapshot } = plan(current);
      if (snapshot) {
        await tx.insert(t.skillVersions).values({
          skillId: id,
          version: current.version,
          body: current.body,
          note: snapshot.note,
        });
      }
      if (Object.keys(fields).length === 0 && !snapshot) return current;

      const [row] = await tx
        .update(t.skills)
        .set({ ...fields, ...(snapshot ? { version: sql`${t.skills.version} + 1` } : {}) })
        .where(eq(t.skills.id, id))
        .returning();
      return row;
    });
  }

  /** Delete a skill; `skill_versions` and `agent_skills` rows go with it (FK cascade). */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  /** Snapshots of past versions, newest first. The current version has no row here. */
  async listSnapshots(skillId: string): Promise<SkillVersionRow[]> {
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
  }

  async getSnapshot(skillId: string, version: number): Promise<SkillVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skillVersions)
      .where(and(eq(t.skillVersions.skillId, skillId), eq(t.skillVersions.version, version)));
    return row;
  }
}
