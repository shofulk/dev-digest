// Ring 0 — domain. The port to the DevDigest HTTP API. Declared here, implemented by the
// ring-2 HTTP adapter; use cases in the application ring depend on this interface only.
// Every method fails with a DomainError from ./errors.ts, never with a transport error.
import type {
  Agent,
  ConventionCandidate,
  PrMeta,
  Repo,
  ReviewRecord,
  ReviewRunResponse,
  RunSummary,
} from './contracts.js';

export interface DevDigestApi {
  listAgents(): Promise<Agent[]>;
  listRepos(): Promise<Repo[]>;
  listPulls(repoId: string): Promise<PrMeta[]>;
  triggerReview(prId: string, agentId: string): Promise<ReviewRunResponse>;
  /** Newest first. */
  listRuns(prId: string): Promise<RunSummary[]>;
  /** Newest first; includes `kind: 'summary'` rows. */
  listReviews(prId: string): Promise<ReviewRecord[]>;
  listConventions(repoId: string): Promise<ConventionCandidate[]>;
}
