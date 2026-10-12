/* context.test.ts — T7 (red, docs/plans/project-context.plan.md). Written against the D11
   interface (client/src/lib/hooks/context.ts): the two save hooks are interface-only
   (mutationFn always rejects "not implemented") until a later step wires the real PUT +
   optimistic-update + rollback behaviour, so these tests are expected to fail on an
   assertion (no fetch call made, no toast raised) rather than on an import/type error.
   useReindexContext already has its real implementation (moved unchanged out of core.ts),
   so its test exercises the fetch contract directly instead of relying on redness. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent, Skill } from "@devdigest/shared";
import {
  useSetAgentContextDocs,
  useSetSkillContextDocs,
  useReindexContext,
  useContextDocs,
} from "./context";
import { notify } from "../toast";

vi.mock("../toast", () => ({ notify: { toast: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

interface Call {
  method: string;
  path: string;
  body: unknown;
}

let calls: Call[];

function installFetch(onCall?: (c: Call) => Response | null) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      const call: Call = { method, path, body };
      calls.push(call);
      const custom = onCall?.(call);
      if (custom) return custom;
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }),
  );
}

function makeWrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

const AGENT: Agent = {
  id: "a1",
  name: "security-reviewer",
  description: "",
  provider: "openrouter",
  model: "m",
  system_prompt: "p",
  output_schema: null,
  enabled: true,
  version: 3,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  context_docs: ["docs/old.md"],
};

beforeEach(() => {
  installFetch();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("context hooks", () => {
  it("AC-14: useSetAgentContextDocs sends PUT /agents/:id/context-docs with the ordered list", async () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(() => useSetAgentContextDocs("a1"), { wrapper: makeWrapper(qc) });

    result.current.mutate(["docs/b.md", "docs/a.md"]);
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true));

    expect(calls).toContainEqual({
      method: "PUT",
      path: "/agents/a1/context-docs",
      body: { context_docs: ["docs/b.md", "docs/a.md"] },
    });
  });

  it("AC-14: useSetSkillContextDocs sends PUT /skills/:id/context-docs with the ordered list", async () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(() => useSetSkillContextDocs("s1"), { wrapper: makeWrapper(qc) });

    result.current.mutate(["specs/one.md"]);
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true));

    expect(calls).toContainEqual({
      method: "PUT",
      path: "/skills/s1/context-docs",
      body: { context_docs: ["specs/one.md"] },
    });
  });

  it("AC-16: a failed save restores the last saved agent cache and toasts the API error message", async () => {
    installFetch((c) => {
      if (c.method === "PUT" && c.path === "/agents/a1/context-docs") {
        return {
          ok: false,
          status: 400,
          statusText: "Bad Request",
          json: async () => ({ error: { message: "write conflict" } }),
        } as Response;
      }
      return null;
    });
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    qc.setQueryData<Agent>(["agent", "a1"], AGENT);
    const { result } = renderHook(() => useSetAgentContextDocs("a1"), { wrapper: makeWrapper(qc) });

    result.current.mutate(["docs/new.md"]);
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(calls).toContainEqual({
      method: "PUT",
      path: "/agents/a1/context-docs",
      body: { context_docs: ["docs/new.md"] },
    });
    expect(qc.getQueryData<Agent>(["agent", "a1"])).toEqual(AGENT);
    expect(notify.toast).toHaveBeenCalledWith("write conflict", "error");
  });

  it("AC-16: a failed save restores the last saved skill cache and toasts the API error message", async () => {
    installFetch((c) => {
      if (c.method === "PUT" && c.path === "/skills/s1/context-docs") {
        return {
          ok: false,
          status: 400,
          statusText: "Bad Request",
          json: async () => ({ error: { message: "invalid path" } }),
        } as Response;
      }
      return null;
    });
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const SKILL: Skill = {
      id: "s1",
      name: "n",
      description: "",
      type: "rubric",
      source: "manual",
      body: "",
      enabled: true,
      version: 2,
      created_at: "2026-01-01T00:00:00Z",
      context_docs: ["specs/old.md"],
    };
    qc.setQueryData<Skill>(["skill", "s1"], SKILL);
    const { result } = renderHook(() => useSetSkillContextDocs("s1"), { wrapper: makeWrapper(qc) });

    result.current.mutate(["specs/new.md"]);
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(qc.getQueryData<Skill>(["skill", "s1"])).toEqual(SKILL);
    expect(notify.toast).toHaveBeenCalledWith("invalid path", "error");
  });

  it("AC-8: useReindexContext posts /repos/:id/context/reindex and refetches the context list", async () => {
    installFetch((c) => {
      if (c.method === "POST" && c.path === "/repos/r1/context/reindex") {
        return { ok: true, status: 200, json: async () => ({ status: "done", pct: 100, chunks_indexed: null }) } as Response;
      }
      if (c.method === "GET" && c.path === "/repos/r1/context") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ files: [], roots: [], count: 0, total_tokens: 0, scanned_at: "2026-10-03T00:00:00Z", truncated: false }),
        } as Response;
      }
      return null;
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const docs = renderHook(() => useContextDocs("r1"), { wrapper: makeWrapper(qc) });
    await waitFor(() => expect(docs.result.current.isSuccess).toBe(true));
    const getsBefore = calls.filter((c) => c.method === "GET" && c.path === "/repos/r1/context").length;

    const reindex = renderHook(() => useReindexContext(), { wrapper: makeWrapper(qc) });
    reindex.result.current.mutate("r1");
    await waitFor(() => expect(reindex.result.current.isSuccess).toBe(true));
    await waitFor(() =>
      expect(calls.filter((c) => c.method === "GET" && c.path === "/repos/r1/context").length).toBeGreaterThan(
        getsBefore,
      ),
    );

    expect(calls).toContainEqual({ method: "POST", path: "/repos/r1/context/reindex", body: undefined });
  });
});
