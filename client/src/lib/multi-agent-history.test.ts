import { describe, it, expect } from "vitest";
import type { MultiAgentRunSummary } from "@devdigest/shared";
import { RECENT_RUNS_MAX, newestRunHref, recentRuns, runSeconds } from "./multi-agent-history";

const item = (id: string): MultiAgentRunSummary => ({
  id,
  pr_id: `pr-${id}`,
  pr_number: 1,
  pr_title: `PR ${id}`,
  ran_at: "2026-10-01T10:00:00Z",
  agent_count: 2,
  status: "done",
  total_duration_ms: 1000,
  total_cost_usd: null,
});

describe("recentRuns", () => {
  it("AC-89: caps the list at RECENT_RUNS_MAX (20) and keeps API order", () => {
    const items = Array.from({ length: 25 }, (_, i) => item(`m${i}`));
    const out = recentRuns(items);
    expect(RECENT_RUNS_MAX).toBe(20);
    expect(out).toHaveLength(20);
    expect(out.map((r) => r.id)).toEqual(items.slice(0, 20).map((r) => r.id));
  });

  it("AC-89: returns every row when there are fewer than the cap", () => {
    const items = [item("a"), item("b")];
    expect(recentRuns(items).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("AC-89: returns [] while the data is undefined", () => {
    expect(recentRuns(undefined)).toEqual([]);
  });
});

describe("runSeconds", () => {
  it("AC-107: a zero total time is null (rendered as an em dash)", () => {
    expect(runSeconds(0)).toBeNull();
  });

  it("AC-107: converts milliseconds to whole seconds", () => {
    expect(runSeconds(12_400)).toBe(12);
  });
});

describe("newestRunHref", () => {
  it("AC-98: links to the results page of the first (newest) item", () => {
    expect(newestRunHref("r1", [item("a"), item("b")])).toBe("/repos/r1/multi-agent/a");
  });

  it("AC-99: is null for undefined and for an empty list", () => {
    expect(newestRunHref("r1", undefined)).toBeNull();
    expect(newestRunHref("r1", [])).toBeNull();
  });
});
