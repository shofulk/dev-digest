import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import type { EvalDashboardOverview } from "@devdigest/shared/contracts/eval-ci";
import {
  EVAL_POLL_MS,
  dashboardPollInterval,
  evalKeys,
  pollInterval,
  useEvalCases,
  useEvalDashboard,
  useEvalRuns,
  useRunAllEvals,
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
