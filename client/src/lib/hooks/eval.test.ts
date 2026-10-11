import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EvalDashboardOverview } from "@devdigest/shared/contracts/eval-ci";
import { EVAL_POLL_MS, dashboardPollInterval, evalKeys, pollInterval, useRunAllEvals } from "./eval";

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
