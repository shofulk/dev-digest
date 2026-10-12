import { describe, it, expect } from "vitest";
import type { EvalSuiteRun } from "@devdigest/shared/contracts/eval-ci";
import {
  canCompare,
  deltaTone,
  formatMetric,
  formatPercent,
  latestTwoCompleted,
  metricDelta,
  orderPair,
  pointsDelta,
  signedDelta,
  startErrorKey,
  caseErrorKey,
  CASE_ERROR_KEYS,
  toggleSelected,
} from "./eval-metrics";

describe("formatMetric", () => {
  it("formats to two decimals and renders null as a dash", () => {
    expect(formatMetric(0.833)).toBe("0.83");
    expect(formatMetric(0)).toBe("0.00");
    expect(formatMetric(1)).toBe("1.00");
    expect(formatMetric(null)).toBe("—");
  });
});

describe("signedDelta / deltaTone", () => {
  it("signs positive, negative, zero and null", () => {
    expect(signedDelta(0.1)).toBe("+0.10");
    expect(signedDelta(-0.2)).toBe("−0.20");
    expect(signedDelta(0)).toBe("±0.00");
    expect(signedDelta(null)).toBe("—");
  });

  it("treats a delta that rounds to zero as flat", () => {
    expect(signedDelta(0.004)).toBe("±0.00");
    expect(deltaTone(0.004)).toBe("flat");
    expect(deltaTone(-0.004)).toBe("flat");
  });

  it("maps the tone", () => {
    expect(deltaTone(0.2)).toBe("up");
    expect(deltaTone(-0.25)).toBe("down");
    expect(deltaTone(0)).toBe("flat");
    expect(deltaTone(null)).toBe("none");
  });
});

describe("orderPair", () => {
  const runs = [
    { run_id: "new", started_at: "2026-10-02T10:00:00Z" },
    { run_id: "old", started_at: "2026-10-01T10:00:00Z" },
    { run_id: "mid", started_at: "2026-10-01T18:00:00Z" },
  ];

  it("returns [older, newer] when the ids are given newest-first", () => {
    expect(orderPair(runs, ["new", "old"])).toEqual(["old", "new"]);
  });

  it("keeps [older, newer] when already ordered, independent of list order", () => {
    expect(orderPair(runs, ["old", "mid"])).toEqual(["old", "mid"]);
    expect(orderPair(runs, ["mid", "old"])).toEqual(["old", "mid"]);
  });

  it("keeps the given order when a run is unknown", () => {
    expect(orderPair(runs, ["ghost", "old"])).toEqual(["ghost", "old"]);
  });
});

const suiteRun = (over: Partial<EvalSuiteRun>): EvalSuiteRun => ({
  run_id: "r",
  agent_id: "ag1",
  status: "completed",
  agent_version: 1,
  started_at: "2026-10-01T10:00:00Z",
  finished_at: "2026-10-01T10:05:00Z",
  cases_total: 5,
  cases_done: 5,
  recall: 0.5,
  precision: 0.5,
  citation_accuracy: 1,
  traces_passed: 3,
  traces_total: 5,
  cases_errored: 0,
  duration_ms: 1000,
  cost_usd: 0.01,
  ...over,
});

describe("canCompare / toggleSelected", () => {
  it("enables Compare for exactly two selected runs", () => {
    expect([[], ["a"], ["a", "b"], ["a", "b", "c"]].map((x) => canCompare(x))).toEqual([false, false, true, false]);
  });

  it("adds and removes an id without mutating the input", () => {
    const base = ["a"];
    expect(toggleSelected(base, "b")).toEqual(["a", "b"]);
    expect(base).toEqual(["a"]);
    expect(toggleSelected(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("latestTwoCompleted", () => {
  it("ignores a newer running run", () => {
    const { latest, previous } = latestTwoCompleted([
      suiteRun({ run_id: "live", status: "running", started_at: "2026-10-05T00:00:00Z" }),
      suiteRun({ run_id: "old", started_at: "2026-10-01T00:00:00Z" }),
      suiteRun({ run_id: "mid", started_at: "2026-10-03T00:00:00Z" }),
    ]);
    expect([latest?.run_id, previous?.run_id]).toEqual(["mid", "old"]);
  });
});

describe("metricDelta / formatPercent / pointsDelta", () => {
  it("returns undefined when either side is null", () => {
    expect(metricDelta(0.8, null)).toBeUndefined();
    expect(metricDelta(undefined, 0.8)).toBeUndefined();
    expect(metricDelta(0.8, 0.6)).toBeCloseTo(0.2);
  });

  it("formats a whole percent and null as null", () => {
    expect(formatPercent(0.82)).toBe("82%");
    expect(formatPercent(null)).toBeNull();
  });

  it("derives direction and whole points, including flat", () => {
    expect(pointsDelta(0.04)).toEqual({ direction: "up", points: 4 });
    expect(pointsDelta(-0.02)).toEqual({ direction: "down", points: 2 });
    expect(pointsDelta(0.004)).toEqual({ direction: "flat", points: 0 });
    expect(pointsDelta(undefined)).toBeUndefined();
  });
});

describe("startErrorKey", () => {
  it("maps the three codes and falls back for anything else", () => {
    expect(startErrorKey("no_cases")).toBe("suite.errors.noCases");
    expect(startErrorKey("provider_not_configured")).toBe("suite.errors.providerNotConfigured");
    expect(startErrorKey("run_in_flight")).toBe("suite.errors.runInFlight");
    expect(startErrorKey("boom")).toBe("suite.errors.generic");
    expect(startErrorKey(undefined)).toBe("suite.errors.generic");
  });

  it("never resolves an inherited Object.prototype member", () => {
    expect(startErrorKey("constructor")).toBe("suite.errors.generic");
    expect(startErrorKey("toString")).toBe("suite.errors.generic");
  });
});

describe("caseErrorKey", () => {
  it("maps every server capture code to its own message key", () => {
    expect(caseErrorKey("finding_not_triaged")).toBe("finding.evalCaseErrors.notTriaged");
    expect(caseErrorKey("expectation_not_grounded")).toBe("finding.evalCaseErrors.notGrounded");
    expect(Object.keys(CASE_ERROR_KEYS).sort()).toEqual([
      "expectation_not_grounded",
      "finding_has_no_agent",
      "finding_not_triaged",
      "frozen_diff_too_large",
      "no_diff_available",
    ]);
  });

  it("falls back to the generic failure for unknown, missing and inherited codes", () => {
    expect(caseErrorKey("boom")).toBe("finding.evalCaseFailed");
    expect(caseErrorKey(undefined)).toBe("finding.evalCaseFailed");
    expect(caseErrorKey("constructor")).toBe("finding.evalCaseFailed");
  });
});
