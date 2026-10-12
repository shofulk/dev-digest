import type { Db } from '../../../db/client.js';
import { toSkillSet, type AgentSkillSet, type AgentSkillsPort } from '../agent-skills.js';
import { linkedSkillRowsForAgent, linkedSkillRowsForAgents, type AgentSkillRow } from './agent-skills.repo.js';

/**
 * Ring-2 implementation of {@link AgentSkillsPort}. Sits next to
 * `agent-skills.repo.ts` rather than inside it, so the row-fetchers there stay
 * free to be imported by `../agent-skills.ts` without a cycle: this file is
 * the one side that depends on both the rows (ring 2) and the pure gate/order
 * logic (ring 1's `toSkillSet`), never the other way around.
 *
 * Constructed once in `platform/container.ts` — services resolve the
 * `AgentSkillsPort` interface in their constructor, never this class.
 */
export class AgentSkillsRepository implements AgentSkillsPort {
  constructor(private db: Db) {}

  async resolveAgentSkillSet(agentId: string): Promise<AgentSkillSet> {
    const rows = await linkedSkillRowsForAgent(this.db, agentId);
    return toSkillSet(rows);
  }

  /**
   * Batched form: one query for every agent in `agentIds` instead of one
   * round trip per agent (the N+1 `docUsage` used to make on every
   * `GET /project-context`). An agent absent from the result map links no
   * skills.
   */
  async resolveAgentSkillSets(agentIds: string[]): Promise<Map<string, AgentSkillSet>> {
    const rows = await linkedSkillRowsForAgents(this.db, agentIds);
    const byAgent = new Map<string, AgentSkillRow[]>();
    for (const row of rows) {
      const bucket = byAgent.get(row.agentId);
      if (bucket) bucket.push(row);
      else byAgent.set(row.agentId, [row]);
    }
    const out = new Map<string, AgentSkillSet>();
    for (const agentId of agentIds) {
      out.set(agentId, toSkillSet(byAgent.get(agentId) ?? []));
    }
    return out;
  }
}
