import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MultiAgentRun } from "@devdigest/shared";
import {
  useCancelMultiRun,
  useLearnFinding,
  useMultiRun,
  useRetryAgent,
  useRunEstimates,
  useStartMultiRun,
} from "./multi-agent";

interface Call {
  method: string;
  path: string;
  body: unknown;
}

let calls: Call[];

/** Mock `fetch`; `respond` may return a different body per call. */
function installFetch(respond: (call: Call, n: number) => unknown) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const call: Call = {
        method: init?.method ?? "GET",
        path: url.replace(/^https?:\/\/[^/]+/, ""),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
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

const run = (status: "running" | "done"): MultiAgentRun => ({
  id: "mr1",
  pr_id: "pr1",
  pr_number: 7,
  ran_at: "2026-10-01T10:00:00Z",
  agent_count: 1,
  total_duration_ms: 0,
  total_cost_usd: null,
  columns: [
    {
      run_id: "r1",
      agent_id: "a1",
      agent_name: "Agent",
      provider: null,
      model: null,
      status,
      verdict: null,
      score: null,
      summary: null,
      duration_ms: null,
      cost_usd: null,
      error: null,
      findings: [],
    },
  ],
  conflicts: [],
  head_sha: "abc",
  stale: false,
});

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useRunEstimates", () => {
  it("AC-9: GETs /run-estimates and resolves the list", async () => {
    const list = [{ agent_id: "a1", median_duration_ms: 1000, median_cost_usd: 0.1, sample_size: 2 }];
    installFetch(() => list);
    const { result } = renderHook(() => useRunEstimates(), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.data).toEqual(list));
    expect(calls[0]).toMatchObject({ method: "GET", path: "/run-estimates" });
  });
});

describe("useStartMultiRun", () => {
  it("AC-4/AC-17: POSTs { agent_ids } to /pulls/<id>/multi-agent-run and resolves the response", async () => {
    const started = { multi_agent_run_id: "mr1", pr_id: "pr1", runs: [] };
    installFetch(() => started);
    const { result } = renderHook(() => useStartMultiRun(), { wrapper: makeWrapper(makeClient()) });
    let out: unknown;
    await act(async () => {
      out = await result.current.mutateAsync({ prId: "pr1", agentIds: ["a1", "a2"] });
    });
    expect(calls).toEqual([{ method: "POST", path: "/pulls/pr1/multi-agent-run", body: { agent_ids: ["a1", "a2"] } }]);
    expect(out).toEqual(started);
  });
});

describe("useMultiRun", () => {
  it("AC-51: GETs /multi-agent-runs/<id>", async () => {
    installFetch(() => run("done"));
    const { result } = renderHook(() => useMultiRun("mr1"), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.data?.id).toBe("mr1"));
    expect(calls[0]).toMatchObject({ method: "GET", path: "/multi-agent-runs/mr1" });
  });

  it("AC-51: does not fetch without an id", async () => {
    installFetch(() => run("done"));
    renderHook(() => useMultiRun(undefined), { wrapper: makeWrapper(makeClient()) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(calls).toHaveLength(0);
  });

  it("AC-51: refetches every 3s while a column is running and stops once none is", async () => {
    installFetch((_c, n) => run(n >= 3 ? "done" : "running"));
    const { result } = renderHook(() => useMultiRun("mr1"), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(calls).toHaveLength(1));
    await waitFor(() => expect(result.current.data?.columns[0]?.status).toBe("running"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    await waitFor(() => expect(calls).toHaveLength(2));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    await waitFor(() => expect(result.current.data?.columns[0]?.status).toBe("done"));
    expect(calls).toHaveLength(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(calls).toHaveLength(3);
  });
});

describe("useMultiRun retries", () => {
  /** Answers each call with the next status of `statuses` (the last one repeats); 200 carries a done run. */
  function installStatuses(statuses: number[]) {
    calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ method: init?.method ?? "GET", path: url.replace(/^https?:\/\/[^/]+/, ""), body: undefined });
        const status = statuses[Math.min(calls.length - 1, statuses.length - 1)]!;
        return status === 200
          ? ({ ok: true, status, json: async () => run("done") } as Response)
          : ({
              ok: false,
              status,
              statusText: "err",
              json: async () => ({ error: { code: "x", message: `status ${status}` } }),
            } as Response);
      }),
    );
  }
  const elapse = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

  it("retries a 429 with backoff until the read succeeds", async () => {
    installStatuses([429, 429, 429, 429, 200]);
    const { result } = renderHook(() => useMultiRun("mr1"), { wrapper: makeWrapper(makeClient()) });
    await elapse(40_000); // 1s + 2s + 4s + 8s of backoff
    await waitFor(() => expect(result.current.data?.id).toBe("mr1"));
    expect(calls).toHaveLength(5);
    expect(result.current.isError).toBe(false);
  });

  it("backs off between 429 retries instead of retrying at once", async () => {
    installStatuses([429, 200]);
    renderHook(() => useMultiRun("mr1"), { wrapper: makeWrapper(makeClient()) });
    await elapse(200);
    expect(calls).toHaveLength(1);
    await elapse(1_500);
    expect(calls).toHaveLength(2);
  });

  it("stops retrying a 429 after a bounded number of attempts and surfaces the error", async () => {
    installStatuses([429]);
    const { result } = renderHook(() => useMultiRun("mr1"), { wrapper: makeWrapper(makeClient()) });
    await elapse(300_000);
    await waitFor(() => expect(result.current.isError).toBe(true));
    const settled = calls.length;
    expect(settled).toBeGreaterThan(3);
    await elapse(300_000);
    expect(calls).toHaveLength(settled);
  });

  it.each([404, 422])("does not retry a %i", async (status) => {
    installStatuses([status]);
    const { result } = renderHook(() => useMultiRun("mr1"), { wrapper: makeWrapper(makeClient()) });
    await elapse(60_000);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(calls).toHaveLength(1);
  });
});

describe("useCancelMultiRun", () => {
  it("AC-42: POSTs /multi-agent-runs/<id>/cancel and invalidates the run", async () => {
    installFetch(() => ({ ok: true, run_ids: ["r1"] }));
    const qc = makeClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useCancelMultiRun("mr1"), { wrapper: makeWrapper(qc) });
    await act(async () => {
      await result.current.mutateAsync();
    });
    expect(calls).toEqual([{ method: "POST", path: "/multi-agent-runs/mr1/cancel", body: undefined }]);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["multi-agent-run", "mr1"] }));
  });
});

describe("useRetryAgent", () => {
  it("AC-45: POSTs /multi-agent-runs/<id>/agents/<agentId>/retry and invalidates the run", async () => {
    installFetch(() => ({ run_id: "r9" }));
    const qc = makeClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useRetryAgent("mr1"), { wrapper: makeWrapper(qc) });
    let out: unknown;
    await act(async () => {
      out = await result.current.mutateAsync({ agentId: "a1" });
    });
    expect(calls).toEqual([{ method: "POST", path: "/multi-agent-runs/mr1/agents/a1/retry", body: undefined }]);
    expect(out).toEqual({ run_id: "r9" });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["multi-agent-run", "mr1"] }));
  });
});

describe("useLearnFinding", () => {
  it("AC-59/AC-72: POSTs /findings/<id>/learn and invalidates reviews and the multi-run prefix", async () => {
    const learned = { id: "m1", content: "c", kind: "learning", scope: "repo", created: true };
    installFetch(() => learned);
    const qc = makeClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useLearnFinding(), { wrapper: makeWrapper(qc) });
    let out: unknown;
    await act(async () => {
      out = await result.current.mutateAsync({ findingId: "f1", prId: "pr1" });
    });
    expect(calls).toEqual([{ method: "POST", path: "/findings/f1/learn", body: undefined }]);
    expect(out).toEqual(learned);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["reviews", "pr1"] }));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["multi-agent-run"] }));
  });
});
