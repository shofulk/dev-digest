// Test helper — an in-memory DevDigestApi (no network, no Docker) that records every call
// it received so a test can assert on side effects (e.g. "0 POSTs" for a disabled agent).
import type {
  Agent,
  ConventionCandidate,
  PrMeta,
  Repo,
  ReviewRecord,
  ReviewRunResponse,
  RunSummary,
} from '../../src/domain/contracts.js';
import { ApiUnreachable } from '../../src/domain/errors.js';
import type { DevDigestApi } from '../../src/domain/ports.js';

export interface FakeApiData {
  repos?: Repo[];
  agents?: Agent[];
  /** Keyed by repo id. */
  pulls?: Record<string, PrMeta[]>;
  /** Keyed by PR id. Mutated in place by triggerReview if `triggerRun` is set. */
  runs?: Record<string, RunSummary[]>;
  /** Keyed by PR id. */
  reviews?: Record<string, ReviewRecord[]>;
  /** Keyed by repo id. */
  conventions?: Record<string, ConventionCandidate[]>;
  /** What triggerReview() returns; if a function, called with (prId, agentId). */
  triggerRun?: ReviewRunResponse | ((prId: string, agentId: string) => ReviewRunResponse);
  /** Throws ApiUnreachable from every method when set — simulates the API being down. */
  unreachableAt?: string;
}

export interface FakeApi extends DevDigestApi {
  calls: { method: string; args: unknown[] }[];
}

export function makeFakeApi(data: FakeApiData = {}): FakeApi {
  const calls: FakeApi['calls'] = [];

  function record(method: string, args: unknown[]): void {
    calls.push({ method, args });
    if (data.unreachableAt) throw new ApiUnreachable(data.unreachableAt);
  }

  return {
    calls,
    async listAgents() {
      record('listAgents', []);
      return data.agents ?? [];
    },
    async listRepos() {
      record('listRepos', []);
      return data.repos ?? [];
    },
    async listPulls(repoId: string) {
      record('listPulls', [repoId]);
      return data.pulls?.[repoId] ?? [];
    },
    async triggerReview(prId: string, agentId: string) {
      record('triggerReview', [prId, agentId]);
      if (typeof data.triggerRun === 'function') return data.triggerRun(prId, agentId);
      return data.triggerRun ?? { pr_id: prId, runs: [] };
    },
    async listRuns(prId: string) {
      record('listRuns', [prId]);
      return data.runs?.[prId] ?? [];
    },
    async listReviews(prId: string) {
      record('listReviews', [prId]);
      return data.reviews?.[prId] ?? [];
    },
    async listConventions(repoId: string) {
      record('listConventions', [repoId]);
      return data.conventions?.[repoId] ?? [];
    },
  };
}
