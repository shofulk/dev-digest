// RING 2 — infrastructure. The only place that reads/writes the `agents` and
// `skills` `context_docs` columns (`onion-architecture`). Deliberately
// separate from `AgentsRepository`/`SkillsRepository`: this write path never
// touches `version` or writes an `agent_versions` / `skill_versions` row.
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export class ProjectContextRepository {
  constructor(private db: Db) {}

  /** `undefined` when the agent isn't in the workspace (404 is the caller's job). */
  async getAgentContextDocs(workspaceId: string, agentId: string): Promise<string[] | undefined> {
    const [row] = await this.db
      .select({ contextDocs: t.agents.contextDocs })
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, agentId)));
    return row?.contextDocs;
  }

  /** Stores the ordered paths only — no `version` bump, no `agent_versions` row. */
  async setAgentContextDocs(
    workspaceId: string,
    agentId: string,
    contextDocs: string[],
  ): Promise<string[] | undefined> {
    const [row] = await this.db
      .update(t.agents)
      .set({ contextDocs })
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, agentId)))
      .returning({ contextDocs: t.agents.contextDocs });
    return row?.contextDocs;
  }

  /** `undefined` when the skill isn't in the workspace. */
  async getSkillContextDocs(workspaceId: string, skillId: string): Promise<string[] | undefined> {
    const [row] = await this.db
      .select({ contextDocs: t.skills.contextDocs })
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, skillId)));
    return row?.contextDocs;
  }

  /** Stores the ordered paths only — no `version` bump, no `skill_versions` row. */
  async setSkillContextDocs(
    workspaceId: string,
    skillId: string,
    contextDocs: string[],
  ): Promise<string[] | undefined> {
    const [row] = await this.db
      .update(t.skills)
      .set({ contextDocs })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, skillId)))
      .returning({ contextDocs: t.skills.contextDocs });
    return row?.contextDocs;
  }
}
