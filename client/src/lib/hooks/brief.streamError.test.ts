/* brief.streamError.test.ts — fix-list F19 (round 3), plan constraint
   C-strings / NFR-11 ("User-facing strings live in messages/<locale>/*.json").
   The frozen `brief.onerror.test.ts` (F12, round 2) only asserts the derived
   `running` flag and the query invalidation on a native `onerror`; it never
   asserts what `failed` actually carries. This file pins the hook-level half
   of F19: `useBriefJob` must carry only a stable `code` on a stream drop, not
   English copy — `client/src/lib/hooks/brief.ts:70` currently sets
   `message: STREAM_ERROR_MESSAGE`, a hard-coded literal equal to the
   `banner.streamError` string in messages/en/brief.json, so this is RED today.
   The hook is rendered WITHOUT any `NextIntlClientProvider` on purpose — a hook
   carrying user-facing copy would still "work" here, which is exactly the bug;
   the point is that `failed.message` must NOT be that copy. `EventSource` is
   mocked — never the hook itself. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import briefMessages from "../../../messages/en/brief.json";
import { useBriefJob } from "./brief";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onerror: ((ev: Event) => void) | null = null;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener() {}
  removeEventListener() {}
  close() {}
  triggerError() {
    this.onerror?.(new Event("error"));
  }
}

function wrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useBriefJob — F19: a native stream error carries a stable code, not user copy", () => {
  it("sets failed.code to the stable \"stream_error\" code", async () => {
    const qc = new QueryClient();
    const { result } = renderHook(() => useBriefJob("pr1", "job1"), { wrapper: wrapper(qc) });
    const es = FakeEventSource.instances.at(-1)!;

    act(() => es.triggerError());

    await waitFor(() => expect(result.current.failed?.code).toBe("stream_error"));
  });

  it("does not put user-facing copy on failed.message — it must not equal banner.streamError", async () => {
    const qc = new QueryClient();
    const { result } = renderHook(() => useBriefJob("pr1", "job1"), { wrapper: wrapper(qc) });
    const es = FakeEventSource.instances.at(-1)!;

    act(() => es.triggerError());

    await waitFor(() => expect(result.current.failed).not.toBeNull());
    expect(result.current.failed?.message).not.toBe(briefMessages.banner.streamError);
  });
});
