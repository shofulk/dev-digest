/* hooks/eval.ts — React Query hooks for the eval pipeline: frozen cases, suite runs,
   compare and the dashboard. Plain polling while a run is `running` (no SSE stream, D5).
   Contract imports come from the file, never the barrel — a VALUE import from
   `@devdigest/shared` 500s the dev server (client/INSIGHTS.md, 2026-09-17). */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  EvalCaseCreated,
  EvalCaseView,
  EvalCompare,
  EvalDashboardOverview,
  EvalStartRunResponse,
  EvalSuiteRun,
} from "@devdigest/shared/contracts/eval-ci";

/** Poll period while a suite run is in flight. */
export const EVAL_POLL_MS = 2000;

export const evalKeys = {
  all: ["eval"] as const,
  cases: (agentId: string | null | undefined) => ["eval", "cases", agentId] as const,
  runs: (agentId: string | null | undefined) => ["eval", "runs", agentId] as const,
  compare: (a: string | null | undefined, b: string | null | undefined) =>
    ["eval", "compare", a, b] as const,
  dashboard: ["eval", "dashboard"] as const,
};

/** Refetch period for a suite status: poll while `running`, otherwise stop. */
export function pollInterval(status: string | null | undefined): number | false {
  return status === "running" ? EVAL_POLL_MS : false;
}

/* ---- reads ---- */

export function useEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.cases(agentId),
    queryFn: () => api.get<EvalCaseView[]>(`/agents/${agentId}/eval-cases`),
    enabled: !!agentId,
  });
}

export function useEvalRuns(agentId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.runs(agentId),
    queryFn: () => api.get<EvalSuiteRun[]>(`/agents/${agentId}/eval-runs`),
    enabled: !!agentId,
    refetchInterval: (q) =>
      pollInterval(q.state.data?.some((r) => r.status === "running") ? "running" : null),
  });
}

/** `a` is the older run, `b` the newer (the caller orders them). Disabled for `a === b`. */
export function useEvalCompare(a: string | null | undefined, b: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.compare(a, b),
    queryFn: () => api.get<EvalCompare>(`/eval-runs/compare?a=${a}&b=${b}`),
    enabled: !!a && !!b && a !== b,
  });
}

export function useEvalDashboard() {
  return useQuery({
    queryKey: evalKeys.dashboard,
    queryFn: () => api.get<EvalDashboardOverview>("/eval/dashboard"),
  });
}

/* ---- writes ---- */

/** POST /findings/:id/eval-case — freeze a triaged finding into a case (idempotent). */
export function useCreateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (findingId: string) => api.post<EvalCaseCreated>(`/findings/${findingId}/eval-case`),
    onSuccess: () => qc.invalidateQueries({ queryKey: evalKeys.all }),
  });
}

export function useDeleteEvalCase(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) => api.del<void>(`/eval-cases/${caseId}`),
    // A deleted case also leaves the per-case runs and the dashboard's case count.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: evalKeys.cases(agentId) });
      void qc.invalidateQueries({ queryKey: evalKeys.runs(agentId) });
      void qc.invalidateQueries({ queryKey: evalKeys.dashboard });
    },
  });
}

export function useStartEvalRun(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<EvalStartRunResponse>(`/agents/${agentId}/eval-runs`),
    onSuccess: () => qc.invalidateQueries({ queryKey: evalKeys.runs(agentId) }),
  });
}
