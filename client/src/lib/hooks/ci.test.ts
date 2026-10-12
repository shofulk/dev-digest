/* ci.test.ts — T10 (AC-45). `useCiRefresh` POSTs /ci/refresh on mount and only then
   reloads the invalidated keys; `refresh()` repeats it; a failed refresh still reloads. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ciKeys, useCiAgent, useCiRefresh, useCiRuns, useExportCi } from "./ci";

let calls: string[];
let refreshFails = false;

beforeEach(() => {
  calls = [];
  refreshFails = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      calls.push(`${init?.method ?? "GET"} ${path}`);
      if (path === "/ci/refresh") {
        if (refreshFails) {
          return { ok: false, status: 500, statusText: "x", json: async () => ({ error: { code: "x", message: "boom" } }) } as Response;
        }
        return { ok: true, status: 200, json: async () => ({ stored: 0, skipped: 0, degraded: [] }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ installations: [], runs: [] }) } as Response;
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return renderHook(
    () => {
      const agent = useCiAgent("a1");
      const refresh = useCiRefresh([ciKeys.agent("a1")]);
      return { agent, refresh };
    },
    { wrapper },
  );
}

const agentGets = () => calls.filter((c) => c === "GET /agents/a1/ci").length;

describe("useExportCi", () => {
  it("AC-42: a successful export reloads the agent's CI data and the runs list", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children);
    const { result } = renderHook(() => ({ agent: useCiAgent("a1"), runs: useCiRuns(), exp: useExportCi("a1") }), { wrapper });
    await waitFor(() => expect(result.current.agent.isSuccess && result.current.runs.isSuccess).toBe(true));
    const before = { agent: agentGets(), runs: calls.filter((c) => c === "GET /ci/runs").length };
    await act(async () => {
      await result.current.exp.mutateAsync({ repo: "acme/x", action: "files", post_as: "none", triggers: ["opened"] });
    });
    await waitFor(() => expect(agentGets()).toBe(before.agent + 1));
    await waitFor(() => expect(calls.filter((c) => c === "GET /ci/runs").length).toBe(before.runs + 1));
  });
});

describe("useCiRefresh", () => {
  it("AC-45: POSTs /ci/refresh on mount, then reloads the invalidated key", async () => {
    setup();
    await waitFor(() => expect(agentGets()).toBe(2));
    const refreshAt = calls.indexOf("POST /ci/refresh");
    expect(refreshAt).toBeGreaterThanOrEqual(0);
    expect(calls.lastIndexOf("GET /agents/a1/ci")).toBeGreaterThan(refreshAt);
    expect(calls.filter((c) => c === "POST /ci/refresh")).toHaveLength(1);
  });

  it("AC-45: refresh() repeats the refresh and the reload", async () => {
    const { result } = setup();
    await waitFor(() => expect(agentGets()).toBe(2));
    act(() => result.current.refresh.refresh());
    await waitFor(() => expect(agentGets()).toBe(3));
    expect(calls.filter((c) => c === "POST /ci/refresh")).toHaveLength(2);
  });

  it("AC-45: a failed refresh still reloads the data", async () => {
    refreshFails = true;
    setup();
    await waitFor(() => expect(agentGets()).toBe(2));
  });
});
