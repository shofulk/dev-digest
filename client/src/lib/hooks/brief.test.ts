/* brief.test.ts — T6 (red, docs/plans/pr-brief.plan.md). Written against the L1
   interface (client/src/lib/hooks/brief.ts): `usePrBrief`/`useGenerateBrief`'s
   query/mutation fns throw "not implemented" and `useBriefJob` always returns the
   idle shape until a later lane wires the real fetch + EventSource. These tests
   therefore fail on an assertion (no EventSource opened, no refetch after `done`)
   rather than on an import/type error. `fetch` and `EventSource` are mocked —
   never the hooks themselves (AGENTS.md "Mock the boundary you own").

   AC-35: the running job returned by the brief read is the one the client must
   subscribe to for progress — exercised here at the hook level via `useBriefJob`.
   AC-44: Generate/Regenerate sends the generate request (with `force` for
   Regenerate), subscribes to the job's events, and refreshes the brief on `done`. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrBrief, PrBriefResponse } from "@devdigest/shared";
import { usePrBrief, useGenerateBrief, useBriefJob } from "./brief";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners: Record<string, Array<(ev: MessageEvent) => void>> = {};
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: (ev: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  removeEventListener(type: string, cb: (ev: MessageEvent) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((c) => c !== cb);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    for (const cb of this.listeners[type] ?? []) cb({ data: JSON.stringify(data) } as MessageEvent);
  }
}

function wrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

const BRIEF: PrBrief = {
  pr_id: "pr1",
  head_sha: "sha1",
  summary: "Adds a token-bucket rate limiter.",
  risks: [],
  review_focus: [],
  missing_inputs: [],
  model: "deepseek/deepseek-v4-flash",
  provider: "openrouter",
  generated_at: "2026-10-04T00:00:00Z",
  stats: { tokens_in: 8200, tokens_out: 1300, cost_usd: 0.014, attempts: 1, duration_ms: 4200 },
};

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, statusText: "", json: async () => body } as Response;
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useBriefJob — AC-35 subscribe to a job's events", () => {
  it("opens an EventSource at the job's URL only once a jobId is given, and reports running", () => {
    const qc = new QueryClient();
    const { result, rerender } = renderHook<ReturnType<typeof useBriefJob>, { jobId: string | null }>(
      ({ jobId }) => useBriefJob("pr1", jobId),
      { initialProps: { jobId: null }, wrapper: wrapper(qc) },
    );
    expect(result.current.running).toBe(false);
    expect(FakeEventSource.instances).toHaveLength(0);

    rerender({ jobId: "job1" });
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.url).toContain("/pulls/pr1/brief/jobs/job1/events");
    expect(result.current.running).toBe(true);
  });

  it("tracks the phase from a `phase` event, and reports `done` + closes the stream on a `done` event", () => {
    const qc = new QueryClient();
    const { result } = renderHook(() => useBriefJob("pr1", "job1"), { wrapper: wrapper(qc) });
    const es = FakeEventSource.instances.at(-1)!;

    act(() => es.emit("phase", { type: "phase", phase: "calling_model" }));
    expect(result.current.phase).toBe("calling_model");
    expect(result.current.running).toBe(true);

    act(() => es.emit("done", { type: "done", brief: BRIEF }));
    expect(result.current.done).toBe(true);
    expect(result.current.running).toBe(false);
    expect(es.closed).toBe(true);
  });

  it("reports `failed` with the code/message and closes the stream on a `failed` event", () => {
    const qc = new QueryClient();
    const { result } = renderHook(() => useBriefJob("pr1", "job1"), { wrapper: wrapper(qc) });
    const es = FakeEventSource.instances.at(-1)!;

    act(() => es.emit("failed", { type: "failed", code: "model_failed", message: "The model request failed." }));
    expect(result.current.failed).toEqual({ code: "model_failed", message: "The model request failed." });
    expect(result.current.running).toBe(false);
    expect(es.closed).toBe(true);
  });
});

describe("useGenerateBrief + useBriefJob — AC-44 generate, subscribe, refresh on done", () => {
  it("POSTs /brief/generate with `force` for Regenerate, and refreshes the stored brief when the job's `done` event arrives", async () => {
    let briefGetCalls = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      if (u.pathname === "/pulls/pr1/brief" && (init?.method ?? "GET") === "GET") {
        briefGetCalls += 1;
        const body: PrBriefResponse = { brief: null, current_head_sha: "sha1", outdated: false, job: null };
        return jsonResponse(body);
      }
      if (u.pathname === "/pulls/pr1/brief/generate" && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({ force: true });
        return jsonResponse({ job_id: "job1", reused: false }, 202);
      }
      throw new Error(`unexpected fetch ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const qc = new QueryClient();
    const brief = renderHook(() => usePrBrief("pr1"), { wrapper: wrapper(qc) });
    await waitFor(() => expect(brief.result.current.isSuccess).toBe(true));
    expect(briefGetCalls).toBe(1);

    const gen = renderHook(() => useGenerateBrief("pr1"), { wrapper: wrapper(qc) });
    // Asserted on `mutateAsync`'s own resolved value, not on `gen.result.current.data`
    // read synchronously right after the `await` — TanStack's `notifyManager` can defer
    // the store-change notification that updates `.data` to a macrotask, so reading it
    // immediately races that timer (see client/src/lib/hooks/brief.ts's `notifyManager`
    // comment). `mutateAsync`'s return value carries the same data with no such race.
    let mutateResult: unknown;
    await act(async () => {
      mutateResult = await gen.result.current.mutateAsync({ force: true });
    });
    expect(mutateResult).toEqual({ job_id: "job1", reused: false });

    renderHook(() => useBriefJob("pr1", "job1"), { wrapper: wrapper(qc) });
    const es = FakeEventSource.instances.at(-1)!;
    act(() => es.emit("done", { type: "done", brief: BRIEF }));

    await waitFor(() => expect(briefGetCalls).toBe(2));
  });
});
