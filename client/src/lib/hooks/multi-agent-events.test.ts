/* multi-agent-events.test.ts — SPEC-05 / SPEC-06, fix round 3, C14 (T44): useMultiRunEvents opens
   one EventSource for the whole id list, groups events by runId, notifies on `error` events and
   closes + invalidates the run on a dropped stream. `EventSource` is faked; the hook is real. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const notifyError = vi.hoisted(() => vi.fn());
vi.mock("../toast", () => ({ notify: { error: notifyError } }));

import { useMultiRunEvents } from "./multi-agent";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  listeners = new Map<string, ((ev: MessageEvent) => void)[]>();
  addEventListener(kind: string, fn: (ev: MessageEvent) => void) {
    this.listeners.set(kind, [...(this.listeners.get(kind) ?? []), fn]);
  }
  close() {
    this.closed = true;
  }
  emit(e: { runId: string; kind: string; msg: string }) {
    this.onmessage?.({ data: JSON.stringify({ t: "00.00", seq: 1, ...e }) } as MessageEvent);
  }
  /** A frame sent with `event: <kind>`: a browser dispatches it to that kind's listeners only, never to onmessage. */
  emitNamed(e: { runId: string; kind: string; msg: string }) {
    const ev = { data: JSON.stringify({ t: "00.00", seq: 1, ...e }) } as MessageEvent;
    for (const fn of this.listeners.get(e.kind) ?? []) fn(ev);
  }
}

function setup(initial: { id: string | null; ids: string[] }) {
  const qc = new QueryClient();
  const spy = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  const hook = renderHook((p: { id: string | null; ids: string[] }) => useMultiRunEvents(p.id, p.ids), {
    wrapper,
    initialProps: initial,
  });
  return { ...hook, spy };
}

const open = () => FakeEventSource.instances.filter((s) => !s.closed);

beforeEach(() => {
  FakeEventSource.instances = [];
  notifyError.mockClear();
  vi.stubGlobal("EventSource", FakeEventSource);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useMultiRunEvents", () => {
  it("C14: opens no source without a multi-run id or without run ids", () => {
    setup({ id: null, ids: ["r1"] });
    setup({ id: "mr1", ids: [] });
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("C14: opens one source on /multi-agent-runs/:id/events with the sorted ids", () => {
    setup({ id: "mr1", ids: ["r2", "r1"] });
    expect(open()).toHaveLength(1);
    const url = new URL(open()[0]!.url);
    expect(url.pathname).toBe("/multi-agent-runs/mr1/events");
    expect(url.searchParams.get("run_ids")).toBe("r1,r2");
  });

  it("C14: groups events by runId", () => {
    const { result } = setup({ id: "mr1", ids: ["r1", "r2"] });
    act(() => open()[0]!.emit({ runId: "r2", kind: "info", msg: "two" }));
    act(() => open()[0]!.emit({ runId: "r1", kind: "info", msg: "one" }));
    expect(result.current.get("r1")?.map((e) => e.msg)).toEqual(["one"]);
    expect(result.current.get("r2")?.map((e) => e.msg)).toEqual(["two"]);
  });

  it("C14: frames the server sends as named events (event: info|tool|result|error) reach the log", () => {
    const { result } = setup({ id: "mr1", ids: ["r1"] });
    const es = open()[0]!;
    act(() => es.emitNamed({ runId: "r1", kind: "info", msg: "step one" }));
    act(() => es.emitNamed({ runId: "r1", kind: "tool", msg: "read_file" }));
    act(() => es.emitNamed({ runId: "r1", kind: "result", msg: "done" }));
    act(() => es.emitNamed({ runId: "r1", kind: "error", msg: "boom" }));
    expect(result.current.get("r1")?.map((e) => e.msg)).toEqual(["step one", "read_file", "done", "boom"]);
    expect(notifyError).toHaveBeenCalledWith("boom");
  });

  it("C14: an error event raises a toast", () => {
    setup({ id: "mr1", ids: ["r1"] });
    act(() => open()[0]!.emit({ runId: "r1", kind: "error", msg: "model failed" }));
    expect(notifyError).toHaveBeenCalledWith("model failed");
  });

  it("C14: a changed id list closes the old source, opens a new one and clears the events", () => {
    const { result, rerender } = setup({ id: "mr1", ids: ["r1", "r2"] });
    const first = open()[0]!;
    act(() => first.emit({ runId: "r1", kind: "info", msg: "one" }));
    rerender({ id: "mr1", ids: ["r2"] });
    expect(first.closed).toBe(true);
    expect(open()).toHaveLength(1);
    expect(new URL(open()[0]!.url).searchParams.get("run_ids")).toBe("r2");
    expect(result.current.size).toBe(0);
  });

  it("C14: onerror closes the source and invalidates the multi-run query", () => {
    const { spy } = setup({ id: "mr1", ids: ["r1"] });
    const es = open()[0]!;
    act(() => es.onerror?.());
    expect(es.closed).toBe(true);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["multi-agent-run", "mr1"] });
  });

  it("C14: unmount closes the source", () => {
    const { unmount } = setup({ id: "mr1", ids: ["r1"] });
    unmount();
    expect(open()).toHaveLength(0);
  });
});
