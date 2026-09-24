import type { Db } from '../../db/client.js';
import { linkedSkillRowsForAgent, type AgentSkillRow } from './repository/agent-skills.repo.js';

/**
 * Skill resolution for a review run (ring 1, cross-module). Reviews read it here
 * instead of importing the skills service. The gate, ordering and `### <name>`
 * prefix are pure functions over rows so they are testable without a database.
 *
 * Resolved bodies are injected into the prompt as INSTRUCTIONS, deliberately NOT
 * wrapped in `<untrusted>` (spec criterion 31): that is what a skill is for. The
 * mitigations are editorial — imported skills arrive disabled and are previewed
 * before save — not syntactic.
 */

export type { AgentSkillRow };

export interface ResolvedSkill {
  id: string;
  name: string;
  version: number;
  body: string;
}

export interface AgentSkillSet {
  /** Included skills: `agent_skills.enabled AND skills.enabled`, by `order` then name. */
  skills: ResolvedSkill[];
  /** Every skill the agent links, enabled or not (the `m` of "k of m linked enabled"). */
  linkedCount: number;
}

/** Apply the two-gate rule and the (order, name) ordering to an agent's linked rows. */
export function selectIncludedSkills(rows: AgentSkillRow[]): ResolvedSkill[] {
  return rows
    .filter((r) => r.linkEnabled && r.skillEnabled)
    .sort((a, b) => a.order - b.order || cmp(a.name, b.name) || cmp(a.id, b.id))
    .map(({ id, name, version, body }) => ({ id, name, version, body }));
}

/** A skill's prompt block: `### <name>` so the assembled section stays attributable. */
export function formatSkillBlock(skill: Pick<ResolvedSkill, 'name' | 'body'>): string {
  return `### ${skill.name}\n\n${skill.body}`;
}

/**
 * The `skills` argument for `reviewPullRequest`. `undefined` for none, so the
 * prompt has no `## Skills / rules` section and stays byte-identical to a run
 * that never heard of skills.
 */
export function skillsForPrompt(skills: ResolvedSkill[]): string[] | undefined {
  return skills.length > 0 ? skills.map(formatSkillBlock) : undefined;
}

export async function resolveAgentSkillSet(db: Db, agentId: string): Promise<AgentSkillSet> {
  const rows = await linkedSkillRowsForAgent(db, agentId);
  return { skills: selectIncludedSkills(rows), linkedCount: rows.length };
}

/** The included skills of one agent, ordered — see {@link selectIncludedSkills}. */
export async function resolveAgentSkills(db: Db, agentId: string): Promise<ResolvedSkill[]> {
  return (await resolveAgentSkillSet(db, agentId)).skills;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
