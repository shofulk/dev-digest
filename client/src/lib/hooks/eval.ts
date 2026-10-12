/* hooks/eval.ts — React Query hooks for the eval pipeline: frozen cases, suite runs,
   compare and the dashboard. Plain polling while a run is `running` (no SSE stream, D5).
   Contract imports come from the file, never the barrel — a VALUE import from
   `@devdigest/shared` 500s the dev server (client/INSIGHTS.md, 2026-09-17). */
"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  EvalCaseCreated,
  EvalCaseDraftResponse,
  EvalCaseFields,
  EvalCaseFromFindingInput,
  EvalCaseView,
  EvalCompare,
  EvalDashboardOverview,
  EvalDryRunResult,
  EvalRunAllResult,
  EvalStartRunResponse,
  EvalSuiteRun,
} from "@devdigest/shared/contracts/eval-ci";
import type { EvalCase } from "@devdigest/shared/contracts/knowledge";

/** Poll period while a suite run is in flight. */
export const EVAL_POLL_MS = 2000;

/** Eval data changes from other tabs (a case made on a PR page, a run started elsewhere), so
 *  these reads refetch on focus even inside the app-wide 30 s staleTime. */
const REFETCH_ON_FOCUS = "always" as const;

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
    refetchOnWindowFocus: REFETCH_ON_FOCUS,
    refetchInterval: (q) => casesPollInterval(q.state.data),
  });
}

export function useEvalRuns(agentId: string | null | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: evalKeys.runs(agentId),
    queryFn: () => api.get<EvalSuiteRun[]>(`/agents/${agentId}/eval-runs`),
    enabled: !!agentId,
    refetchOnWindowFocus: REFETCH_ON_FOCUS,
    refetchInterval: (q) =>
      pollInterval(q.state.data?.some((r) => r.status === "running") ? "running" : null),
  });

  // Only the runs query polls, but each case's `last_result` comes from the latest run, so
  // the cases list and the dashboard refetch once when the last in-flight run settles.
  const running = query.data?.some((r) => r.status === "running") ?? false;
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) {
      void qc.invalidateQueries({ queryKey: evalKeys.cases(agentId) });
      void qc.invalidateQueries({ queryKey: evalKeys.dashboard });
    }
    wasRunning.current = running;
  }, [running, agentId, qc]);

  return query;
}

/** `a` is the older run, `b` the newer (the caller orders them). Disabled for `a === b`. */
export function useEvalCompare(a: string | null | undefined, b: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.compare(a, b),
    queryFn: () => api.get<EvalCompare>(`/eval-runs/compare?a=${a}&b=${b}`),
    enabled: !!a && !!b && a !== b,
  });
}

/** Refetch period for the dashboard: poll while any recent suite run is `running`. */
export function dashboardPollInterval(data: EvalDashboardOverview | undefined): number | false {
  return pollInterval(data?.recent_runs.some((r) => r.status === "running") ? "running" : null);
}

export function useEvalDashboard() {
  return useQuery({
    queryKey: evalKeys.dashboard,
    queryFn: () => api.get<EvalDashboardOverview>("/eval/dashboard"),
    refetchOnWindowFocus: REFETCH_ON_FOCUS,
    refetchInterval: (q) => dashboardPollInterval(q.state.data),
  });
}

/* ---- writes ---- */

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

/** POST /eval/runs/all — start one suite run per agent that has cases (refusals are per agent). */
export function useRunAllEvals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<EvalRunAllResult>("/eval/runs/all", { confirm: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: evalKeys.all }),
  });
}

/* ---- case editor (SPEC-03) ---- */

/** Refetch period for the cases list while any case has a run in flight. */
export function casesPollInterval(cases: readonly EvalCaseView[] | undefined): number | false {
  return cases?.some((c) => c.running) ? EVAL_POLL_MS : false;
}

/** True when the agent has a suite run or a one-case run in flight. */
export function agentRunBusy(
  runs: readonly EvalSuiteRun[] | undefined,
  cases: readonly EvalCaseView[] | undefined,
): boolean {
  return !!runs?.some((r) => r.status === "running") || !!cases?.some((c) => c.running);
}

/** GET /findings/:id/eval-case-draft — a mutation, so no cache can hand back a stale draft. */
export function useEvalCaseDraft() {
  return useMutation<EvalCaseDraftResponse, Error, string>({
    mutationFn: (findingId) => api.get<EvalCaseDraftResponse>(`/findings/${findingId}/eval-case-draft`),
  });
}

/** POST /findings/:id/eval-case with the (possibly edited) fields. */
export function useSaveEvalCaseFromFinding() {
  const qc = useQueryClient();
  return useMutation<EvalCaseCreated, Error, { findingId: string; body: EvalCaseFromFindingInput }>({
    mutationFn: ({ findingId, body }) => api.post<EvalCaseCreated>(`/findings/${findingId}/eval-case`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: evalKeys.all }),
  });
}

/** POST /agents/:id/eval-cases — a hand-written case. */
export function useCreateEvalCaseByHand(agentId: string) {
  const qc = useQueryClient();
  return useMutation<EvalCase, Error, EvalCaseFields>({
    mutationFn: (fields) => api.post<EvalCase>(`/agents/${agentId}/eval-cases`, fields),
    onSuccess: () => qc.invalidateQueries({ queryKey: evalKeys.all }),
  });
}

/** PUT /eval-cases/:id — edit a case; past results keep the expectation they ran with. */
export function useUpdateEvalCase(agentId: string) {
  const qc = useQueryClient();
  return useMutation<EvalCase, Error, { caseId: string; fields: EvalCaseFields }>({
    mutationFn: ({ caseId, fields }) => api.put<EvalCase>(`/eval-cases/${caseId}`, fields),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: evalKeys.cases(agentId) });
      void qc.invalidateQueries({ queryKey: evalKeys.runs(agentId) });
      void qc.invalidateQueries({ queryKey: evalKeys.dashboard });
    },
  });
}

/** POST /eval-cases/:id/runs — a one-case run; only this agent's case list refreshes. */
export function useStartCaseRun(agentId: string) {
  const qc = useQueryClient();
  return useMutation<EvalStartRunResponse, Error, string>({
    mutationFn: (caseId) => api.post<EvalStartRunResponse>(`/eval-cases/${caseId}/runs`),
    onSuccess: () => qc.invalidateQueries({ queryKey: evalKeys.cases(agentId) }),
  });
}

/** POST /agents/:id/eval-cases/dry-run — scores the form content, stores nothing. */
export function useDryRunEvalCase(agentId: string) {
  return useMutation<EvalDryRunResult, Error, EvalCaseFields>({
    mutationFn: (fields) => api.post<EvalDryRunResult>(`/agents/${agentId}/eval-cases/dry-run`, fields),
  });
}

/** True while a suite run or a one-case run is in flight for the agent. */
export function useAgentEvalBusy(agentId: string | null | undefined): boolean {
  const runs = useEvalRuns(agentId);
  const cases = useEvalCases(agentId);
  return agentRunBusy(runs.data, cases.data);
}
