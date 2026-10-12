import { describe, it, expect } from "vitest";
import type { RunEstimate } from "@devdigest/shared";
import { estimateFor, estimateSeconds, estimateTotals } from "./multi-agent-estimates";

const est = (agent_id: string, ms: number | null, cost: number | null, n = 3): RunEstimate => ({
  agent_id,
  median_duration_ms: ms,
  median_cost_usd: cost,
  sample_size: n,
});

describe("estimateSeconds", () => {
  it("AC-9: rounds milliseconds to whole seconds", () => {
    expect(estimateSeconds(12_400)).toBe(12);
    expect(estimateSeconds(12_600)).toBe(13);
  });
});

describe("estimateFor", () => {
  it("AC-13: is null/null when there is no estimate", () => {
    expect(estimateFor(undefined)).toEqual({ seconds: null, costUsd: null });
  });

  it("AC-13: is null/null when sample_size is 0", () => {
    expect(estimateFor(est("a", 5000, 0.1, 0))).toEqual({ seconds: null, costUsd: null });
  });

  it("AC-9: returns seconds and cost for an agent with history", () => {
    expect(estimateFor(est("a", 12_400, 0.034))).toEqual({ seconds: 12, costUsd: 0.034 });
  });

  it("AC-13: keeps a null cost null while still giving the time", () => {
    expect(estimateFor(est("a", 8_000, null))).toEqual({ seconds: 8, costUsd: null });
  });
});

describe("estimateTotals", () => {
  it("AC-12: takes the max seconds and sums the costs", () => {
    const t = estimateTotals([est("a", 10_000, 0.1), est("b", 25_000, 0.25)]);
    expect(t.seconds).toBe(25);
    expect(t.costUsd).toBeCloseTo(0.35, 10);
    expect(t.partial).toBe(false);
  });

  it("AC-13: leaves an agent without history out and marks the total partial", () => {
    const t = estimateTotals([est("a", 10_000, 0.1), undefined, est("c", 0, null, 0)]);
    expect(t.seconds).toBe(10);
    expect(t.costUsd).toBeCloseTo(0.1, 10);
    expect(t.partial).toBe(true);
  });

  it("AC-12: sums only non-null costs", () => {
    const t = estimateTotals([est("a", 10_000, null), est("b", 4_000, 0.2)]);
    expect(t.seconds).toBe(10);
    expect(t.costUsd).toBeCloseTo(0.2, 10);
    expect(t.partial).toBe(false);
  });

  it("AC-69: gives a null cost, never 0, when no checked agent is priced", () => {
    const t = estimateTotals([est("a", 10_000, null), est("b", 4_000, null)]);
    expect(t.costUsd).toBeNull();
    expect(t.seconds).toBe(10);
  });

  it("AC-13: is all-null and partial when no checked agent has history", () => {
    expect(estimateTotals([undefined, est("b", 1000, 0.1, 0)])).toEqual({
      seconds: null,
      costUsd: null,
      partial: true,
    });
  });

  it("AC-12: is all-null and not partial for an empty selection", () => {
    expect(estimateTotals([])).toEqual({ seconds: null, costUsd: null, partial: false });
  });
});
