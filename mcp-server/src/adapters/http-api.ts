// Ring 2 — infrastructure. Implements the DevDigestApi port over `fetch`. Throws only
// DomainError subclasses (C1): the adapter never lets a transport error, a JSON parse error
// or a bare Error escape. No `process.env` here — the base URL and timeout arrive as
// constructor arguments (C1's "config arrives as constructor args").
import type {
  Agent,
  BlastRadius,
  ConventionCandidate,
  PrMeta,
  Repo,
  ReviewRecord,
  ReviewRunResponse,
  RunSummary,
} from '../domain/contracts.js';
import { ApiFailure, ApiUnreachable, RateLimited } from '../domain/errors.js';
import type { DevDigestApi } from '../domain/ports.js';

export interface HttpApiOptions {
  baseUrl: string;
  timeoutMs: number;
  fetch?: typeof globalThis.fetch;
}

interface ApiErrorBody {
  error?: { code?: string; message?: string; details?: unknown };
}

export function createHttpApi(options: HttpApiOptions): DevDigestApi {
  const { timeoutMs } = options;
  const baseUrl = options.baseUrl.endsWith('/') ? options.baseUrl.slice(0, -1) : options.baseUrl;
  const fetchImpl = options.fetch ?? globalThis.fetch;

  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const url = `${baseUrl}${path}`;
    let response: Response;
    try {
      response = await fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // Any network failure or timeout (AbortSignal.timeout aborts with a DOMException) —
      // the adapter cannot tell those apart usefully, both mean "could not reach the API".
      throw new ApiUnreachable(url);
    }

    if (response.status === 429) {
      // A 429 from @fastify/rate-limit falls through as `code: "internal_error"` — detect
      // by status only (rev-3 constraint C1/C7).
      throw new RateLimited(url);
    }

    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const body = (await response.json()) as ApiErrorBody;
        if (body.error?.message) message = body.error.message;
      } catch {
        // Body was not JSON, or empty — keep the generic message.
      }
      throw new ApiFailure(response.status, url, message);
    }

    // Bare JSON, no envelope (verified API fact).
    try {
      return await response.json();
    } catch {
      throw new ApiFailure(response.status, url, 'response was not valid JSON');
    }
  }

  return {
    async listAgents(): Promise<Agent[]> {
      return (await request('/agents')) as Agent[];
    },

    async listRepos(): Promise<Repo[]> {
      return (await request('/repos')) as Repo[];
    },

    async listPulls(repoId: string): Promise<PrMeta[]> {
      return (await request(`/repos/${encodeURIComponent(repoId)}/pulls`)) as PrMeta[];
    },

    async triggerReview(prId: string, agentId: string): Promise<ReviewRunResponse> {
      return (await request(`/pulls/${encodeURIComponent(prId)}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentId }),
      })) as ReviewRunResponse;
    },

    async listRuns(prId: string): Promise<RunSummary[]> {
      return (await request(`/pulls/${encodeURIComponent(prId)}/runs`)) as RunSummary[];
    },

    async listReviews(prId: string): Promise<ReviewRecord[]> {
      return (await request(`/pulls/${encodeURIComponent(prId)}/reviews`)) as ReviewRecord[];
    },

    async listConventions(repoId: string): Promise<ConventionCandidate[]> {
      return (await request(`/repos/${encodeURIComponent(repoId)}/conventions`)) as ConventionCandidate[];
    },

    async getBlastRadius(prId: string): Promise<BlastRadius> {
      return (await request(`/pulls/${encodeURIComponent(prId)}/blast`)) as BlastRadius;
    },
  };
}
