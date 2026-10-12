import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import type {
  EvalCaseFields,
  EvalCaseFromFindingInput,
  EvalCaseView,
  EvalDashboardOverview,
  EvalSuiteRun,
} from "@devdigest/shared/contracts/eval-ci";
import {
  EVAL_POLL_MS,
  agentRunBusy,
  casesPollInterval,
  dashboardPollInterval,
  evalKeys,
  pollInterval,
  useCreateEvalCaseByHand,
  useDryRunEvalCase,
  useEvalCaseDraft,
  useEvalCases,
  useEvalDashboard,
  useEvalRuns,
  useRunAllEvals,
  useSaveEvalCaseFromFinding,
  useStartCaseRun,
  useUpdateEvalCase,
} from "./eval";

interface Call {
  method: string;
  path: string;
  body: unknown;
}

let calls: Call[];

function installFetch(response: unknown) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        method: init?.method ?? "GET",
        path: url.replace(/^https?:\/\/[^/]+/, ""),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return { ok: true, status: 200, json: async () => response } as Response;
    }),
  );
}

function makeWrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

afterEach(() => vi.unstubAllGlobals());

describe("pollInterval", () => {
  it("polls every EVAL_POLL_MS while running and stops otherwise", () => {
    expect(pollInterval("running")).toBe(2000);
    expect(EVAL_POLL_MS).toBe(2000);
    expect(pollInterval("completed")).toBe(false);
    expect(pollInterval(undefined)).toBe(false);
  });
});

describe("evalKeys", () => {
  it("nests every key under the shared root so one invalidation covers them all", () => {
    for (const key of [evalKeys.cases("a"), evalKeys.runs("a"), evalKeys.compare("x", "y"), evalKeys.dashboard]) {
      expect(key.slice(0, 1)).toEqual(evalKeys.all);
    }
  });
});

describe("dashboardPollInterval", () => {
  const overview = (statuses: ("running" | "completed")[]): EvalDashboardOverview => ({
    agents: [],
    recent_runs: statuses.map((status, i) => ({
      run_id: `r${i}`,
      agent_id: "ag1",
      agent_name: "A",
      status,
      agent_version: 1,
      started_at: "2026-10-01T10:00:00Z",
      finished_at: null,
      cases_total: 1,
      cases_done: 0,
      recall: null,
      precision: null,
      citation_accuracy: null,
      traces_passed: 0,
      traces_total: 1,
      cases_errored: 0,
      duration_ms: 0,
      cost_usd: null,
    })),
  });

  it("polls while a recent run is running and stops otherwise", () => {
    expect(dashboardPollInterval(overview(["completed", "running"]))).toBe(2000);
    expect(dashboardPollInterval(overview(["completed"]))).toBe(false);
    expect(dashboardPollInterval(undefined)).toBe(false);
  });
});

describe("useRunAllEvals", () => {
  it("AC35: posts { confirm: true } to /eval/runs/all and invalidates the eval root", async () => {
    installFetch({ started: [] });
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useRunAllEvals(), { wrapper: makeWrapper(qc) });

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(calls).toContainEqual({ method: "POST", path: "/eval/runs/all", body: { confirm: true } });
    expect(spy).toHaveBeenCalledWith({ queryKey: evalKeys.all });
  });
});

describe("eval reads refetch when the window regains focus", () => {
  afterEach(() => focusManager.setFocused(undefined));

  // The app-wide client turns focus refetch off and keeps data fresh for 30 s; a case made
  // on a PR page in another tab must still show up when the Evals tab is focused again.
  const appLikeClient = () =>
    new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } } });

  it.each([
    ["useEvalCases", () => useEvalCases("a1"), "/agents/a1/eval-cases", []],
    ["useEvalRuns", () => useEvalRuns("a1"), "/agents/a1/eval-runs", []],
    ["useEvalDashboard", () => useEvalDashboard(), "/eval/dashboard", { agents: [], recent_runs: [] }],
  ] as const)("%s refetches on focus inside the staleTime", async (_name, hook, path, response) => {
    installFetch(response);
    const { result } = renderHook((): { isSuccess: boolean } => hook(), { wrapper: makeWrapper(appLikeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const before = calls.filter((c) => c.path === path).length;

    focusManager.setFocused(false);
    focusManager.setFocused(true);

    await waitFor(() => expect(calls.filter((c) => c.path === path).length).toBe(before + 1));
  });
});

describe("useEvalRuns refreshes the cases once a run settles", () => {
  const run = (status: "running" | "completed") => ({ run_id: "r1", status, started_at: "2026-10-11T00:00:00Z" });

  it("invalidates the cases and the dashboard on running -> settled, and not before", async () => {
    let body: unknown[] = [run("running")];
    calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push({ method: "GET", path: url.replace(/^https?:\/\/[^/]+/, ""), body: undefined });
        return { ok: true, status: 200, json: async () => body } as Response;
      }),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useEvalRuns("a1"), { wrapper: makeWrapper(qc) });
    await waitFor(() => expect(result.current.data?.[0]?.status).toBe("running"));
    expect(spy).not.toHaveBeenCalled();

    body = [run("completed")];
    await result.current.refetch();

    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: evalKeys.cases("a1") }));
    expect(spy).toHaveBeenCalledWith({ queryKey: evalKeys.dashboard });
  });

  it("does not invalidate when the runs were never running", async () => {
    installFetch([run("completed")]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useEvalRuns("a1"), { wrapper: makeWrapper(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).not.toHaveBeenCalled();
  });
});

/* ---- case editor (SPEC-03, rev 6) ---- */

const caseView = (id: string, running: boolean): EvalCaseView => ({
  case: {
    id,
    owner_kind: "agent",
    owner_id: "a1",
    name: `case ${id}`,
    input_diff: "diff",
    input_files: [],
    input_meta: null,
    expected_output: null,
    notes: null,
  },
  expectation: null,
  last_result: "never_run",
  last_run_id: null,
  last_matched: null,
  running,
});

const suiteRun = (status: "running" | "completed"): EvalSuiteRun => ({
  run_id: "r1",
  agent_id: "a1",
  status,
  agent_version: 1,
  started_at: "2026-10-12T10:00:00Z",
  finished_at: null,
  cases_total: 1,
  cases_done: 0,
  recall: null,
  precision: null,
  citation_accuracy: null,
  traces_passed: 0,
  traces_total: 1,
  cases_errored: 0,
  duration_ms: 0,
  cost_usd: null,
});

describe("casesPollInterval", () => {
  it("AC80: polls every EVAL_POLL_MS while any case is running and stops otherwise", () => {
    expect(casesPollInterval([caseView("c1", false), caseView("c2", true)])).toBe(2000);
    expect(casesPollInterval([caseView("c1", false)])).toBe(false);
    expect(casesPollInterval([])).toBe(false);
    expect(casesPollInterval(undefined)).toBe(false);
  });
});

describe("agentRunBusy", () => {
  it("AC81: is busy while a suite run is running", () => {
    expect(agentRunBusy([suiteRun("running")], [caseView("c1", false)])).toBe(true);
  });

  it("AC81: is busy while a one-case run is running", () => {
    expect(agentRunBusy([suiteRun("completed")], [caseView("c1", true)])).toBe(true);
  });

  it("AC81: is idle when neither is running, or when nothing has loaded", () => {
    expect(agentRunBusy([suiteRun("completed")], [caseView("c1", false)])).toBe(false);
    expect(agentRunBusy(undefined, undefined)).toBe(false);
  });
});

describe("case editor hooks", () => {
  const fields: EvalCaseFields = {
    name: "hand-written",
    notes: null,
    pr_title: "T",
    pr_body: "B",
    input_diff: "diff --git a/a b/a",
    expectation: {
      type: "must_find",
      file: "a",
      start_line: 1,
      end_line: 2,
      severity: "WARNING",
      category: "bug",
      title: "t",
    },
  };
  const body: EvalCaseFromFindingInput = {
    name: "renamed",
    notes: "n",
    pr_title: "T",
    pr_body: "B",
    expectation: { file: "a", start_line: 1, end_line: 2, severity: "WARNING", category: "bug", title: "t" },
  };
  const client = () => new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });

  it("AC66: useEvalCaseDraft GETs the draft and resolves the answer, writing no cache", async () => {
    const answer = { agent_id: "a1", existing_case: null, draft: null };
    installFetch(answer);
    const qc = client();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useEvalCaseDraft(), { wrapper: makeWrapper(qc) });

    await expect(result.current.mutateAsync("f1")).resolves.toEqual(answer);
    expect(calls).toContainEqual({ method: "GET", path: "/findings/f1/eval-case-draft", body: undefined });
    expect(spy).not.toHaveBeenCalled();
  });

  it("AC72: useSaveEvalCaseFromFinding POSTs the body to the finding and invalidates the eval root", async () => {
    installFetch({ id: "c1", created: true });
    const qc = client();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useSaveEvalCaseFromFinding(), { wrapper: makeWrapper(qc) });

    await expect(result.current.mutateAsync({ findingId: "f1", body })).resolves.toEqual({ id: "c1", created: true });
    expect(calls).toContainEqual({ method: "POST", path: "/findings/f1/eval-case", body });
    expect(spy).toHaveBeenCalledWith({ queryKey: evalKeys.all });
  });

  it("AC74: useCreateEvalCaseByHand POSTs the fields to the agent and invalidates the eval root", async () => {
    installFetch({ id: "c2" });
    const qc = client();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useCreateEvalCaseByHand("a1"), { wrapper: makeWrapper(qc) });

    await expect(result.current.mutateAsync(fields)).resolves.toEqual({ id: "c2" });
    expect(calls).toContainEqual({ method: "POST", path: "/agents/a1/eval-cases", body: fields });
    expect(spy).toHaveBeenCalledWith({ queryKey: evalKeys.all });
  });

  it("AC74: useUpdateEvalCase PUTs the fields to the case and invalidates only that agent's cases, runs and the dashboard", async () => {
    installFetch({ id: "c1" });
    const qc = client();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useUpdateEvalCase("a1"), { wrapper: makeWrapper(qc) });

    // Before the mutation settles nothing is invalidated.
    expect(spy).not.toHaveBeenCalled();
    await expect(result.current.mutateAsync({ caseId: "c1", fields })).resolves.toEqual({ id: "c1" });
    expect(calls).toContainEqual({ method: "PUT", path: "/eval-cases/c1", body: fields });

    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy).toHaveBeenCalledWith({ queryKey: evalKeys.cases("a1") });
    expect(spy).toHaveBeenCalledWith({ queryKey: evalKeys.runs("a1") });
    expect(spy).toHaveBeenCalledWith({ queryKey: evalKeys.dashboard });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: evalKeys.all });
    // Another agent's cases are not in the invalidated set (scoped key).
    expect(spy).not.toHaveBeenCalledWith({ queryKey: evalKeys.cases("a2") });
  });

  it("AC80: useStartCaseRun POSTs to the case's runs and invalidates only that agent's cases", async () => {
    installFetch({ run_id: "r1", cases_total: 1 });
    const qc = client();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useStartCaseRun("a1"), { wrapper: makeWrapper(qc) });

    await expect(result.current.mutateAsync("c1")).resolves.toEqual({ run_id: "r1", cases_total: 1 });
    expect(calls).toContainEqual({ method: "POST", path: "/eval-cases/c1/runs", body: undefined });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["eval", "cases", "a1"] });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: evalKeys.all });
  });

  it("AC84: useDryRunEvalCase POSTs the fields to the agent's dry-run route and invalidates nothing", async () => {
    const result200 = { pass: true, findings: [], grounding_kept: 0, grounding_dropped: 0, cost_usd: null, duration_ms: 1, agent_version: 1 };
    installFetch(result200);
    const qc = client();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useDryRunEvalCase("a1"), { wrapper: makeWrapper(qc) });

    await expect(result.current.mutateAsync(fields)).resolves.toEqual(result200);
    expect(calls).toContainEqual({ method: "POST", path: "/agents/a1/eval-cases/dry-run", body: fields });
    expect(spy).not.toHaveBeenCalled();
  });
});
