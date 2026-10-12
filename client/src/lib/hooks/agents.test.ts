import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent } from "@devdigest/shared";
import { useRestoreAgentVersion } from "./agents";
import { evalKeys } from "./eval";

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

describe("useRestoreAgentVersion", () => {
  it("AC38: posts the restore route, sets the agent cache and invalidates agents and eval", async () => {
    const restored = { id: "a1", name: "x", version: 6 } as unknown as Agent;
    installFetch(restored);
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useRestoreAgentVersion(), { wrapper: makeWrapper(qc) });

    result.current.mutate({ id: "a1", version: 3 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(calls).toContainEqual({ method: "POST", path: "/agents/a1/versions/3/restore", body: undefined });
    expect(qc.getQueryData(["agent", "a1"])).toEqual(restored);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["agents"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: evalKeys.all });
  });
});
