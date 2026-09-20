import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

const hooks = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("@/lib/hooks/skills", () => ({ useSkillTokens: () => ({ mutate: hooks.mutate }) }));

import { useBodyTokens } from "./useBodyTokens";

type Callbacks = { onSuccess: (r: { tokens: number | null }) => void; onError: (e: unknown) => void };
const lastCallbacks = () => hooks.mutate.mock.calls.at(-1)![1] as Callbacks;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useBodyTokens", () => {
  it("waits 400 ms of quiet and then makes ONE request for the latest body", () => {
    const { rerender } = renderHook(({ body }) => useBodyTokens(body), { initialProps: { body: "a" } });
    act(() => void vi.advanceTimersByTime(399));
    expect(hooks.mutate).not.toHaveBeenCalled();

    rerender({ body: "ab" });
    act(() => void vi.advanceTimersByTime(399));
    rerender({ body: "abc" });
    act(() => void vi.advanceTimersByTime(399));
    expect(hooks.mutate).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(1));
    expect(hooks.mutate).toHaveBeenCalledTimes(1);
    expect(hooks.mutate.mock.calls[0]![0]).toBe("abc");
  });

  it("returns the counted value, and keeps the previous one while the next request is in flight", () => {
    const { result, rerender } = renderHook(({ body }) => useBodyTokens(body), { initialProps: { body: "a" } });
    act(() => void vi.advanceTimersByTime(400));
    act(() => lastCallbacks().onSuccess({ tokens: 12 }));
    expect(result.current).toBe(12);

    rerender({ body: "ab" });
    act(() => void vi.advanceTimersByTime(400));
    expect(hooks.mutate).toHaveBeenCalledTimes(2);
    expect(result.current).toBe(12);

    act(() => lastCallbacks().onSuccess({ tokens: 15 }));
    expect(result.current).toBe(15);
  });

  it("returns null — never NaN — when the request fails or the server has no count", () => {
    const { result, rerender } = renderHook(({ body }) => useBodyTokens(body), { initialProps: { body: "a" } });
    act(() => void vi.advanceTimersByTime(400));
    act(() => lastCallbacks().onSuccess({ tokens: 7 }));
    expect(result.current).toBe(7);

    rerender({ body: "ab" });
    act(() => void vi.advanceTimersByTime(400));
    act(() => lastCallbacks().onError(new Error("boom")));
    expect(result.current).toBeNull();

    rerender({ body: "abc" });
    act(() => void vi.advanceTimersByTime(400));
    act(() => lastCallbacks().onSuccess({ tokens: null }));
    expect(result.current).toBeNull();
  });

  it("uses the saved count for the saved body without a request", () => {
    const saved = { body: "saved", tokens: 42 };
    const { result, rerender } = renderHook(({ body }) => useBodyTokens(body, saved), {
      initialProps: { body: "saved" },
    });
    act(() => void vi.advanceTimersByTime(1000));
    expect(hooks.mutate).not.toHaveBeenCalled();
    expect(result.current).toBe(42);

    rerender({ body: "edited" });
    act(() => void vi.advanceTimersByTime(400));
    expect(hooks.mutate).toHaveBeenCalledTimes(1);
    // the saved count keeps showing until the new one lands
    expect(result.current).toBe(42);
  });

  it("does not fire a request after unmount", () => {
    const { unmount } = renderHook(() => useBodyTokens("a"));
    unmount();
    act(() => void vi.advanceTimersByTime(1000));
    expect(hooks.mutate).not.toHaveBeenCalled();
  });
});
