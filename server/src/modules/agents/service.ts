import type { Container } from '../../platform/container.js';
import type {
  Agent,
  AgentLinkedSkill,
  AgentVersion,
  CiFailOn,
  ModelInfo,
  Provider,
  ReviewStrategy,
} from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { AgentsRepository, type SkillLinkInput } from './repository.js';
import { toAgentDto, toAgentVersionDto } from './helpers.js';

/**
 * A2 — agents service. Business logic for the Agents tab + Agent Editor.
 * Provider/model selection uses the LLM adapter's dynamic model list.
 *
 * An Agent = provider + model + system_prompt + linked skills + output_schema +
 * enabled. Config changes are versioned via `agent_versions` (repository).
 */

// Re-exported for backwards compatibility; implementation lives in ./helpers.
export { toAgentDto } from './helpers.js';

export interface CreateAgentInput {
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  system_prompt: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  ci_fail_on?: CiFailOn;
  repo_intel?: boolean;
  enabled?: boolean;
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  system_prompt?: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  ci_fail_on?: CiFailOn;
  repo_intel?: boolean;
  enabled?: boolean;
}

export class AgentsService {
  private repo: AgentsRepository;

  constructor(private container: Container) {
    this.repo = new AgentsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Agent[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toAgentDto);
  }

  async get(workspaceId: string, id: string): Promise<Agent | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toAgentDto(row) : undefined;
  }

  /** Delete an agent (and its versions/skill-links, via cascade). */
  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  async create(workspaceId: string, input: CreateAgentInput, userId?: string): Promise<Agent> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      provider: input.provider,
      model: input.model,
      systemPrompt: input.system_prompt,
      outputSchema: input.output_schema,
      ...(input.strategy !== undefined ? { strategy: input.strategy } : {}),
      ...(input.ci_fail_on !== undefined ? { ciFailOn: input.ci_fail_on } : {}),
      ...(input.repo_intel !== undefined ? { repoIntel: input.repo_intel } : {}),
      enabled: input.enabled,
      createdBy: userId ?? null,
    });
    return toAgentDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateAgentInput,
  ): Promise<Agent | undefined> {
    const row = await this.repo.update(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
      ...(patch.model !== undefined ? { model: patch.model } : {}),
      ...(patch.system_prompt !== undefined ? { systemPrompt: patch.system_prompt } : {}),
      ...(patch.output_schema !== undefined ? { outputSchema: patch.output_schema } : {}),
      ...(patch.strategy !== undefined ? { strategy: patch.strategy } : {}),
      ...(patch.ci_fail_on !== undefined ? { ciFailOn: patch.ci_fail_on } : {}),
      ...(patch.repo_intel !== undefined ? { repoIntel: patch.repo_intel } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    });
    return row ? toAgentDto(row) : undefined;
  }

  /**
   * Config history for an agent, newest version first. Workspace-scoped: returns
   * undefined when the agent isn't in this workspace (the route maps that to 404)
   * so version snapshots can't be read across tenants.
   */
  async listVersions(workspaceId: string, agentId: string): Promise<AgentVersion[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const rows = await this.repo.listVersions(agentId);
    return rows.map(toAgentVersionDto);
  }

  /**
   * A single config snapshot for an agent. Returns undefined when the agent isn't
   * in this workspace OR that version was never recorded (route → 404).
   */
  async getVersion(
    workspaceId: string,
    agentId: string,
    version: number,
  ): Promise<AgentVersion | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const row = await this.repo.getVersion(agentId, version);
    return row ? toAgentVersionDto(row) : undefined;
  }

  /** Linked skills for an agent, ordered, with the fields the Skills tab renders. */
  async skillLinks(agentId: string): Promise<AgentLinkedSkill[]> {
    const links = await this.repo.linkedSkills(agentId);
    return links.map((l) => ({
      agent_id: agentId,
      skill_id: l.skillId,
      order: l.order,
      enabled: l.enabled,
      name: l.name,
      description: l.description,
      type: l.type,
      version: l.version,
      skill_enabled: l.skillEnabled,
    }));
  }

  /**
   * Set / reorder the agent's linked skills: replaces the whole set in the given
   * order (index = order). An item without `enabled` keeps its current value.
   * Throws NotFoundError when any skill is not in this workspace; returns
   * undefined when the agent isn't.
   */
  async setSkills(
    workspaceId: string,
    agentId: string,
    items: SkillLinkInput[],
  ): Promise<AgentLinkedSkill[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    await this.assertSkillsInWorkspace(workspaceId, items.map((i) => i.skillId));
    await this.repo.setSkills(agentId, items);
    return this.skillLinks(agentId);
  }

  /** Link a single skill (append or set order) — additive to existing links. */
  async linkSkill(
    workspaceId: string,
    agentId: string,
    skillId: string,
    order?: number,
  ): Promise<AgentLinkedSkill[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    await this.assertSkillsInWorkspace(workspaceId, [skillId]);
    const existing = await this.repo.linkedSkills(agentId);
    const resolvedOrder = order ?? existing.length;
    await this.repo.linkSkill(agentId, skillId, resolvedOrder);
    return this.skillLinks(agentId);
  }

  /**
   * Patch one link (`enabled` / `order`). Returns undefined when the agent isn't in
   * this workspace or doesn't link that skill (route → 404).
   */
  async updateSkillLink(
    workspaceId: string,
    agentId: string,
    skillId: string,
    patch: { enabled?: boolean; order?: number },
  ): Promise<AgentLinkedSkill[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const found = await this.repo.updateLink(agentId, skillId, patch);
    return found ? this.skillLinks(agentId) : undefined;
  }

  private async assertSkillsInWorkspace(workspaceId: string, skillIds: string[]): Promise<void> {
    const wanted = [...new Set(skillIds)];
    const found = await this.repo.skillIdsInWorkspace(workspaceId, wanted);
    if (wanted.some((id) => !found.has(id))) throw new NotFoundError('Skill not found');
  }

  /**
   * Dynamic model list from the provider adapter's /models. Degrades gracefully
   * to [] if the provider key is not configured (the editor still renders).
   */
  async listModels(provider: Provider): Promise<ModelInfo[]> {
    try {
      const llm = await this.container.llm(provider);
      return await llm.listModels();
    } catch {
      return [];
    }
  }
}
