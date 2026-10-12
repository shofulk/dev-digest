// RING 3 — composition wiring. The only CI file allowed to see `Container`; it builds
// `CiServiceDeps` from it (precedent: `modules/brief/deps.ts`). `service.ts` never does.
import type { Container } from '../../platform/container.js';
import { CiRepository } from './repository.js';
import type { CiRepoInfo, CiServiceDeps } from './service.js';

export function buildCiServiceDeps(container: Container): CiServiceDeps {
  const repo = new CiRepository(container.db);
  const toRepo = (r: {
    id: string;
    owner: string;
    name: string;
    fullName: string;
    defaultBranch: string;
  }): CiRepoInfo => ({
    id: r.id,
    owner: r.owner,
    name: r.name,
    fullName: r.fullName,
    defaultBranch: r.defaultBranch,
  });

  return {
    getAgent: async (workspaceId, agentId) => {
      const a = await container.agentsRepo.getById(workspaceId, agentId);
      return a
        ? {
            id: a.id,
            name: a.name,
            version: a.version,
            provider: a.provider,
            model: a.model,
            systemPrompt: a.systemPrompt,
            strategy: a.strategy,
            ciFailOn: a.ciFailOn,
          }
        : null;
    },
    getRepoById: async (workspaceId, repoId) => {
      const r = await container.reposRepo.getById(workspaceId, repoId);
      return r ? toRepo(r) : null;
    },
    getRepoByFullName: async (workspaceId, fullName) => {
      const r = await container.reposRepo.findByFullName(workspaceId, fullName);
      return r ? toRepo(r) : null;
    },
    listSkills: async (agentId) => (await container.agentSkills.resolveAgentSkillSet(agentId)).skills,
    repoMemory: (workspaceId, repoId) => repo.repoMemory(workspaceId, repoId),
    readRunner: () => container.runnerBundle.read(),
    github: () => container.github(),
    upsertInstallation: (v) => repo.upsertInstallation(v),
    listAgentInstallations: (agentId) => repo.listAgentInstallations(agentId),
    listWorkspaceInstallations: (workspaceId) => repo.listWorkspaceInstallations(workspaceId),
    listRuns: (workspaceId, agentId, limit) => repo.listRuns(workspaceId, agentId, limit),
    storedInstallations: (githubRunId, ids) => repo.storedInstallations(githubRunId, ids),
    writeCiRun: (v) => repo.writeCiRun(v),
  };
}
