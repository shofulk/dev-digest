import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MultiAgentRunSummary } from "@devdigest/shared";
import { useCancelMultiRun, useMultiRuns, useRetryAgent, useStartMultiRun } from "./multi-agent";

interface Call {
  method: string;
  path: string;
}
let calls: Call[];

function installFetch(respond: (call: Call, n: number) => unknown) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const call: Call = { method: init?.method ?? "GET", path: url.replace(/^https?:\/\/[^/]+/, "") };
      calls.push(call);
      return { ok: true, status: 200, json: async () => respond(call, calls.length) } as Response;
    }),
  );
}

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}
function makeWrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

const summary = (status: MultiAgentRunSummary["status"]): MultiAgentRunSummary => ({
  id: "mr1",
  pr_id: "p1",
  pr_number: 7,
  pr_title: "T",
  ran_at: "2026-10-01T10:00:00Z",
  agent_count: 2,
  status,
  total_duration_ms: 0,
  total_cost_usd: null,
});

const elapse = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useMultiRuns", () => {
  it("AC-95: GETs /repos/<id>/multi-agent-runs and resolves the list", async () => {
    installFetch(() => [summary("done")]);
    const { result } = renderHook(() => useMultiRuns("r1"), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.data).toEqual([summary("done")]));
    expect(calls[0]).toEqual({ method: "GET", path: "/repos/r1/multi-agent-runs" });
  });

  it("AC-98: with { prId } GETs /repos/<id>/multi-agent-runs?pr_id=<prId>", async () => {
    installFetch(() => [summary("done")]);
    renderHook(() => useMultiRuns("r1", { prId: "p1" }), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ method: "GET", path: "/repos/r1/multi-agent-runs?pr_id=p1" });
  });

  it("AC-99: with { prId: null } sends no request", async () => {
    installFetch(() => []);
    renderHook(() => useMultiRuns("r1", { prId: null }), { wrapper: makeWrapper(makeClient()) });
    await elapse(6000);
    expect(calls).toHaveLength(0);
  });

  it("AC-95: refetches within 5s while an item is running, and stops once none is", async () => {
    let status: MultiAgentRunSummary["status"] = "running";
    installFetch(() => [summary(status)]);
    const { result } = renderHook(() => useMultiRuns("r1"), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.data?.[0]?.status).toBe("running"));
    expect(calls).toHaveLength(1);

    await elapse(5000);
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2));

    status = "done";
    await elapse(5000);
    await waitFor(() => expect(result.current.data?.[0]?.status).toBe("done"));
    const settled = calls.length;
    await elapse(30_000);
    expect(calls).toHaveLength(settled);
  });

  it("AC-96: the query carries meta.silentError === true", async () => {
    installFetch(() => []);
    const qc = makeClient();
    const { result } = renderHook(() => useMultiRuns("r1"), { wrapper: makeWrapper(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const queries = qc.getQueryCache().getAll();
    expect(queries).toHaveLength(1);
    expect(queries[0]!.meta).toMatchObject({ silentError: true });
  });
});

describe("useStartMultiRun history invalidation", () => {
  it("AC-97/AC-100: invalidates [\"multi-agent-runs\"] after a successful start", async () => {
    installFetch(() => ({ multi_agent_run_id: "mr1", pr_id: "p1", runs: [] }));
    const qc = makeClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useStartMultiRun(), { wrapper: makeWrapper(qc) });
    await act(async () => {
      await result.current.mutateAsync({ prId: "p1", agentIds: ["a1"] });
    });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["multi-agent-runs"] }));
  });
});

describe("useCancelMultiRun / useRetryAgent history invalidation", () => {
  it("AC-97: useCancelMultiRun invalidates [\"multi-agent-runs\"] after a successful cancel", async () => {
    installFetch(() => ({}));
    const qc = makeClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useCancelMultiRun("mr1"), { wrapper: makeWrapper(qc) });
    await act(async () => {
      await result.current.mutateAsync();
    });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["multi-agent-runs"] }));
  });

  it("AC-97: useRetryAgent invalidates [\"multi-agent-runs\"] after a successful retry", async () => {
    installFetch(() => ({}));
    const qc = makeClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useRetryAgent("mr1"), { wrapper: makeWrapper(qc) });
    await act(async () => {
      await result.current.mutateAsync({ agentId: "a1" });
    });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["multi-agent-runs"] }));
  });
});
