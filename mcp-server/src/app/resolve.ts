// Ring 1 — application. Use cases over the DevDigestApi port that turn a user's
// repo/pr/agent address into the concrete row the API returned. No user-facing text here
// (that lives in src/tools/errors.ts) — these throw domain errors only.
import type { Agent, PrMeta, Repo } from '../domain/contracts.js';
import { AgentAmbiguous, AgentNotFound, PrNotImported, RepoAmbiguous, RepoNotFound } from '../domain/errors.js';
import type { DevDigestApi } from '../domain/ports.js';

const MAX_KNOWN_REPOS = 20;

/**
 * `repo` is `owner/name`, matched case-insensitively against `full_name`; a bare `name`
 * resolves when it is unique among the workspace's repos.
 */
export async function resolveRepo(api: DevDigestApi, repo: string): Promise<Repo> {
  const repos = await api.listRepos();
  const query = repo.toLowerCase();

  const byFullName = repos.filter((r) => r.full_name.toLowerCase() === query);
  if (byFullName.length === 1) return byFullName[0]!;

  const byName = repos.filter((r) => r.name.toLowerCase() === query);
  if (byName.length === 1) return byName[0]!;
  if (byName.length > 1) {
    throw new RepoAmbiguous(
      repo,
      byName.map((r) => r.full_name),
    );
  }

  throw new RepoNotFound(repo, repos.map((r) => r.full_name).slice(0, MAX_KNOWN_REPOS));
}

/** A `PrMeta` known to carry a non-null `id` — what `resolvePr` guarantees on success. */
export type ImportedPr = PrMeta & { id: string };

/** `pr` is the GitHub PR number; a match with no `id` is not imported in DevDigest. */
export async function resolvePr(api: DevDigestApi, repoId: string, repo: string, pr: number): Promise<ImportedPr> {
  const pulls = await api.listPulls(repoId);
  const found = pulls.find((p) => p.number === pr);
  if (!found || found.id == null) {
    throw new PrNotImported(repo, pr);
  }
  return found as ImportedPr;
}

/** `agent` is an id, or a name matched case-insensitively. */
export async function resolveAgent(api: DevDigestApi, agent: string): Promise<Agent> {
  const agents = await api.listAgents();

  const byId = agents.find((a) => a.id === agent);
  if (byId) return byId;

  const query = agent.toLowerCase();
  const byName = agents.filter((a) => a.name.toLowerCase() === query);
  if (byName.length === 1) return byName[0]!;
  if (byName.length > 1) {
    throw new AgentAmbiguous(
      agent,
      byName.map((a) => a.id),
    );
  }

  throw new AgentNotFound(agent);
}
