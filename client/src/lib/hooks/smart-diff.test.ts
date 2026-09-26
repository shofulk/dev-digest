import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useInvalidateOnRunSettle } from "./smart-diff";

function wrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useInvalidateOnRunSettle", () => {
  it("invalidates reviews, pr-runs and smart-diff on a running -> not-running transition, independent of the active tab", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");

    const { rerender } = renderHook(({ running }) => useInvalidateOnRunSettle("pr1", running), {
      initialProps: { running: true },
      wrapper: wrapper(qc),
    });
    expect(spy).not.toHaveBeenCalled();

    // D6: the transition fires the three invalidations, matching what the
    // Diff tab (["smart-diff"]) and the Findings tab (["reviews"],
    // ["pr-runs"]) each read — this hook does not know which tab is mounted.
    rerender({ running: false });
    const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([["reviews", "pr1"], ["pr-runs", "pr1"], ["smart-diff", "pr1"]]),
    );
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("does nothing on mount, while still running, or on a not-running -> not-running rerender", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");

    const { rerender } = renderHook(({ running }) => useInvalidateOnRunSettle("pr1", running), {
      initialProps: { running: false },
      wrapper: wrapper(qc),
    });
    rerender({ running: false });
    expect(spy).not.toHaveBeenCalled();

    rerender({ running: true });
    expect(spy).not.toHaveBeenCalled();
    rerender({ running: true });
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not invalidate when prId is null, even on a running -> not-running transition", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");

    const { rerender } = renderHook(({ running }) => useInvalidateOnRunSettle(null, running), {
      initialProps: { running: true },
      wrapper: wrapper(qc),
    });
    rerender({ running: false });
    expect(spy).not.toHaveBeenCalled();
  });
});
