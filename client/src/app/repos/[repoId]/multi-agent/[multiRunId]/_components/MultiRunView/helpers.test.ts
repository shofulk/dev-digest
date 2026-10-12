import { describe, it, expect } from "vitest";
import type { AgentColumn, Conflict } from "@devdigest/shared";
import { canCompare, disagreementCells, hasRunning, parseView, visibleGroups } from "./helpers";

const col = (status: AgentColumn["status"], id: string = status): AgentColumn => ({
  run_id: `run-${id}`,
  agent_id: `agent-${id}`,
  agent_name: `Agent ${id}`,
  provider: null,
  model: null,
  status,
  verdict: null,
  score: null,
  summary: null,
  duration_ms: null,
  cost_usd: null,
  error: null,
  findings: [],
});

const group = (title: string, is_conflict: boolean): Conflict => ({
  file: "src/a.ts",
  line: 1,
  title,
  takes: [],
  is_conflict,
});

describe("parseView (AC-48)", () => {
  it("AC-48: defaults to columns for null and unknown values", () => {
    expect(parseView(null)).toBe("columns");
    expect(parseView("x")).toBe("columns");
    expect(parseView("")).toBe("columns");
    expect(parseView("TABS")).toBe("columns");
  });

  it("AC-48: returns tabs only for 'tabs'", () => {
    expect(parseView("tabs")).toBe("tabs");
    expect(parseView("columns")).toBe("columns");
  });
});

describe("visibleGroups (AC-63)", () => {
  const groups = [group("a", false), group("b", true), group("c", false), group("d", true)];

  it("AC-63: shows every group when the filter is off", () => {
    expect(visibleGroups(groups, false)).toEqual(groups);
  });

  it("AC-63: shows only conflict groups, in order, when the filter is on", () => {
    expect(visibleGroups(groups, true).map((g) => g.title)).toEqual(["b", "d"]);
  });

  it("AC-63: does not mutate the input", () => {
    const copy = [...groups];
    visibleGroups(groups, true);
    expect(groups).toEqual(copy);
  });
});

describe("canCompare (AC-64)", () => {
  it("AC-64: is false with 0 done columns", () => {
    expect(canCompare([])).toBe(false);
    expect(canCompare([col("running"), col("failed"), col("cancelled")])).toBe(false);
  });

  it("AC-64: is false with exactly 1 done column", () => {
    expect(canCompare([col("done"), col("failed")])).toBe(false);
  });

  it("AC-64: is true with 2 done columns", () => {
    expect(canCompare([col("done", "a"), col("done", "b"), col("running")])).toBe(true);
  });
});

describe("hasRunning (AC-54)", () => {
  it("AC-54: is true when any column is running", () => {
    expect(hasRunning([col("done"), col("running")])).toBe(true);
  });

  it("AC-54: is false when none is running", () => {
    expect(hasRunning([])).toBe(false);
    expect(hasRunning([col("done"), col("failed"), col("cancelled")])).toBe(false);
  });
});

describe("disagreementCells (AC-62)", () => {
  const g: Conflict = {
    file: "src/a.ts",
    line: 10,
    title: "SQL injection",
    is_conflict: true,
    takes: [
      { agent_id: "a1", persona: "Security", verdict: "CRITICAL", note: "Unsanitised input" },
      { agent_id: "a2", persona: "Style", verdict: "ignored", note: "" },
    ],
  };

  it("AC-62: gives one cell per take, in order", () => {
    expect(disagreementCells(g).map((c) => c.agentId)).toEqual(["a1", "a2"]);
  });

  it("AC-62: a flagging take carries severity and finding title", () => {
    expect(disagreementCells(g)[0]).toEqual({
      agentId: "a1",
      agentName: "Security",
      flagged: true,
      severity: "CRITICAL",
      title: "Unsanitised input",
    });
  });

  it("AC-62: an ignored take is not flagged, with null severity and title", () => {
    expect(disagreementCells(g)[1]).toEqual({
      agentId: "a2",
      agentName: "Style",
      flagged: false,
      severity: null,
      title: null,
    });
  });
});
