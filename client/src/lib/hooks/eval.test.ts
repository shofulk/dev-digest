import { describe, it, expect } from "vitest";
import { EVAL_POLL_MS, evalKeys, pollInterval } from "./eval";

describe("pollInterval", () => {
  it("polls every EVAL_POLL_MS while running and stops otherwise", () => {
    expect(pollInterval("running")).toBe(2000);
    expect(EVAL_POLL_MS).toBe(2000);
    expect(pollInterval("completed")).toBe(false);
    expect(pollInterval(undefined)).toBe(false);
  });
});

describe("evalKeys", () => {
  it("nests every key under the shared root so one invalidation covers them all", () => {
    for (const key of [evalKeys.cases("a"), evalKeys.runs("a"), evalKeys.compare("x", "y"), evalKeys.dashboard]) {
      expect(key.slice(0, 1)).toEqual(evalKeys.all);
    }
  });
});
