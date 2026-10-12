import { describe, it, expect } from "vitest";
import type { EvalDashboardAgent, EvalRunAllResult } from "@devdigest/shared/contracts/eval-ci";
import { runAllOutcome, runAllSummary } from "./helpers";

const agent = (id: string, casesTotal: number): EvalDashboardAgent => ({
  agent_id: id,
  name: `Agent ${id}`,
  model: "m",
  cases_total: casesTotal,
  latest: null,
  trend: [],
});

const UUID_X = "11111111-1111-4111-8111-111111111111";

describe("runAllSummary", () => {
  it("AC35: counts agents, total cases and model calls as the SUM of cases per agent", () => {
    // 3 + 5 cases: Σ = 8. `agents × max` would be 10 and `agents × Σ` would be 16.
    const out = runAllSummary([agent("a", 3), agent("b", 5)]);
    expect(out).toEqual({ agents: 2, cases: 8, calls: 8 });
  });

  it("AC35: an empty dashboard is all zeros", () => {
    expect(runAllSummary([])).toEqual({ agents: 0, cases: 0, calls: 0 });
  });
});

describe("runAllOutcome", () => {
  it("AC35: counts the started agents and lists each refusal with its agent name and reason, in order", () => {
    const result: EvalRunAllResult = {
      started: [
        { agent_id: "x", agent_name: "X", run_id: UUID_X, refused_reason: null },
        { agent_id: "y", agent_name: "Y", run_id: null, refused_reason: "provider_not_configured" },
        { agent_id: "z", agent_name: "Z", run_id: null, refused_reason: "run_in_flight" },
      ],
    };
    expect(runAllOutcome(result)).toEqual({
      started: 1,
      refused: [
        { agent_name: "Y", reason: "provider_not_configured" },
        { agent_name: "Z", reason: "run_in_flight" },
      ],
    });
  });

  it("AC35: nothing refused when every agent started", () => {
    const result: EvalRunAllResult = {
      started: [
        { agent_id: "x", agent_name: "X", run_id: UUID_X, refused_reason: null },
        { agent_id: "w", agent_name: "W", run_id: "22222222-2222-4222-8222-222222222222", refused_reason: null },
      ],
    };
    expect(runAllOutcome(result)).toEqual({ started: 2, refused: [] });
  });

  it("AC35: an empty result starts nothing", () => {
    expect(runAllOutcome({ started: [] })).toEqual({ started: 0, refused: [] });
  });
});
