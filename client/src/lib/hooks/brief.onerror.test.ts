/* brief.onerror.test.ts — fix-list F12 (round 2), spec AC-33/AC-43/AC-44 +
   plan step S13 ("invalidates [\"pr-brief\", prId] on done/failed/error").
   The frozen brief.test.ts (T6) only exercises `done` and the named
   `failed` SSE event; it never fires the native `onerror` the browser
   raises when the stream itself drops (API restart, evicted job). Today's
   `useBriefJob` sets `es.onerror = () => { es.close(); }` — neither
   `failed` nor `done` — so derived `running` stays `true` and every banner
   action (Generate/Regenerate/Retry, BriefBanner.tsx `isGenerating`) would
   stay disabled forever after such a drop. This file is a NEW, additional
   oracle; it does not touch brief.test.ts.

   `fetch` and `EventSource` are mocked — never the hook itself (AGENTS.md
   "Mock the boundary you own"). */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePrBrief, useBriefJob } from "./brief";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners: Record<string, Array<(ev: MessageEvent) => void>> = {};
  closed = false;
  onerror: ((ev: Event) => void) | null = null;
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
  triggerError() {
    this.onerror?.(new Event("error"));
  }
}

function wrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

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

describe("useBriefJob — F12: a native onerror before done/failed (AC-33, AC-43, AC-44, S13)", () => {
  it("AC-43: ends `running` so Generate/Regenerate/Retry re-enable, on a stream error with no done/failed event", async () => {
    const qc = new QueryClient();
    const { result } = renderHook(() => useBriefJob("pr1", "job1"), { wrapper: wrapper(qc) });
    const es = FakeEventSource.instances.at(-1)! as unknown as FakeEventSource;
    expect(result.current.running).toBe(true);

    act(() => es.triggerError());

    // AC-33: the stream has reached a terminal state (never resumes) —
    // `running` must become false, not stay true forever.
    expect(result.current.running).toBe(false);
  });

  it("AC-44/S13: invalidates [\"pr-brief\", prId] so the server's job/brief state takes over", async () => {
    let briefGetCalls = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      if (u.pathname === "/pulls/pr1/brief" && (init?.method ?? "GET") === "GET") {
        briefGetCalls += 1;
        return jsonResponse({ brief: null, current_head_sha: "sha1", outdated: false, job: null });
      }
      throw new Error(`unexpected fetch ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const qc = new QueryClient();
    const brief = renderHook(() => usePrBrief("pr1"), { wrapper: wrapper(qc) });
    await waitFor(() => expect(brief.result.current.isSuccess).toBe(true));
    expect(briefGetCalls).toBe(1);

    renderHook(() => useBriefJob("pr1", "job1"), { wrapper: wrapper(qc) });
    const es = FakeEventSource.instances.at(-1)! as unknown as FakeEventSource;

    act(() => es.triggerError());

    await waitFor(() => expect(briefGetCalls).toBe(2));
  });
});
