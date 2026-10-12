/* hooks/multi-agent.ts — React Query hooks for multi-agent review: run estimates,
   start / read / cancel / retry a multi-run, and Learn from a finding.
   No onError toasts here: the global MutationCache in providers.tsx toasts ApiError. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  LearnFindingResult,
  MultiAgentCancelResult,
  MultiAgentRetryResult,
  MultiAgentRun,
  MultiAgentRunStarted,
  MultiAgentRunSummary,
  RunEstimate,
} from "@devdigest/shared";
import { api, ApiError } from "../api";

export function useRunEstimates() {
  return useQuery({
    queryKey: ["run-estimates"],
    queryFn: () => api.get<RunEstimate[]>("/run-estimates"),
  });
}

export function useStartMultiRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ prId, agentIds }: { prId: string; agentIds: string[] }) =>
      api.post<MultiAgentRunStarted>(`/pulls/${prId}/multi-agent-run`, { agent_ids: agentIds }),
    // Not returned: a returned promise makes mutateAsync wait for the Recent runs refetch,
    // and the caller navigates to the results page right after it resolves.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["multi-agent-runs"] });
    },
  });
}

/** A 429 is transient (the API is shedding load): keep trying, with react-query's exponential
    backoff (1s, 2s, 4s … capped at 30s), for far longer than an ordinary failure. The api layer
    does not expose a Retry-After header, so the backoff is the pacing. */
const RATE_LIMIT_RETRIES = 6;
const OTHER_RETRIES = 2;

function retryRead(count: number, err: unknown): boolean {
  if (err instanceof ApiError) {
    if (err.status === 404 || err.status === 422) return false;
    if (err.status === 429) return count < RATE_LIMIT_RETRIES;
  }
  return count < OTHER_RETRIES;
}

export function useMultiRun(id: string | null | undefined) {
  return useQuery({
    queryKey: ["multi-agent-run", id],
    queryFn: () => api.get<MultiAgentRun>(`/multi-agent-runs/${id}`),
    enabled: !!id,
    retry: retryRead,
    refetchInterval: (query) =>
      (query.state.data?.columns ?? []).some((c) => c.status === "running") ? 3000 : false,
  });
}

/** Newest multi-runs of a repo (or of one PR when `opts.prId` is passed), for Recent runs and
    the PR-page link. */
export function useMultiRuns(repoId: string | null | undefined, opts?: { prId?: string | null }) {
  const prId = opts?.prId;
  const filtered = opts !== undefined && "prId" in opts;
  return useQuery({
    queryKey: ["multi-agent-runs", repoId, prId ?? null],
    queryFn: () =>
      api.get<MultiAgentRunSummary[]>(
        `/repos/${repoId}/multi-agent-runs${prId ? `?pr_id=${encodeURIComponent(prId)}` : ""}`,
      ),
    enabled: !!repoId && (!filtered || !!prId),
    retry: retryRead,
    refetchInterval: (query) => ((query.state.data ?? []).some((r) => r.status === "running") ? 3000 : false),
    meta: { silentError: true },
  });
}

export function useCancelMultiRun(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<MultiAgentCancelResult>(`/multi-agent-runs/${id}/cancel`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["multi-agent-run", id] });
      qc.invalidateQueries({ queryKey: ["multi-agent-runs"] });
    },
  });
}

export function useRetryAgent(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId }: { agentId: string }) =>
      api.post<MultiAgentRetryResult>(`/multi-agent-runs/${id}/agents/${agentId}/retry`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["multi-agent-run", id] });
      qc.invalidateQueries({ queryKey: ["multi-agent-runs"] });
    },
  });
}

export function useLearnFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ findingId }: { findingId: string; prId?: string }) =>
      api.post<LearnFindingResult>(`/findings/${findingId}/learn`),
    onSuccess: (_res, { prId }) => {
      if (prId) qc.invalidateQueries({ queryKey: ["reviews", prId] });
      qc.invalidateQueries({ queryKey: ["multi-agent-run"] });
    },
  });
}
