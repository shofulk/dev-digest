import { eq } from 'drizzle-orm';
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
}

export async function linkedSkillRowsForAgent(db: Db, agentId: string): Promise<AgentSkillRow[]> {
  return db
    .select({
      id: t.skills.id,
      name: t.skills.name,
      version: t.skills.version,
      body: t.skills.body,
      order: t.agentSkills.order,
      linkEnabled: t.agentSkills.enabled,
      skillEnabled: t.skills.enabled,
    })
    .from(t.agentSkills)
    .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
    .where(eq(t.agentSkills.agentId, agentId));
}
