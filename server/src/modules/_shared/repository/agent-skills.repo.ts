import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';

/**
 * Persistence half of skill resolution (ring 2): every skill an agent links,
 * both gates' flags included and ordering left to the caller. Kept apart from
 * `../agent-skills.ts` so the gate/order/prefix rules stay pure.
 */
export interface AgentSkillRow {
  id: string;
  name: string;
  version: number;
  body: string;
  order: number;
  /** `agent_skills.enabled` — the per-agent toggle. */
  linkEnabled: boolean;
  /** `skills.enabled` — the skill's own global flag. */
  skillEnabled: boolean;
  /** Repository-relative paths of the skill's own attached Project Context documents. */
  contextDocs: string[];
}

/**
 * Own row type for the batched query: it joins several agents' rows together,
 * so (unlike {@link AgentSkillRow}) it must carry `agentId` to group by — and
 * does so as a required field, never a non-null-asserted optional one.
 */
export interface BatchedAgentSkillRow extends AgentSkillRow {
  agentId: string;
}

export async function linkedSkillRowsForAgent(db: Db, agentId: string): Promise<AgentSkillRow[]> {
  return linkedSkillRowsForAgents(db, [agentId]);
}

/** Batched form: one query for every id in `agentIds` instead of one per agent. */
export async function linkedSkillRowsForAgents(
  db: Db,
  agentIds: string[],
): Promise<BatchedAgentSkillRow[]> {
  if (agentIds.length === 0) return [];
  return db
    .select({
      agentId: t.agentSkills.agentId,
      id: t.skills.id,
      name: t.skills.name,
      version: t.skills.version,
      body: t.skills.body,
      order: t.agentSkills.order,
      linkEnabled: t.agentSkills.enabled,
      skillEnabled: t.skills.enabled,
      contextDocs: t.skills.contextDocs,
    })
    .from(t.agentSkills)
    .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
    .where(inArray(t.agentSkills.agentId, agentIds));
}
