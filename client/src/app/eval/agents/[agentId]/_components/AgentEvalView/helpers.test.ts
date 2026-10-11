import { describe, it, expect } from "vitest";
import type { EvalSuiteRun } from "@devdigest/shared/contracts/eval-ci";
import { metricCallout, trendPoints } from "./helpers";

type Metrics = { recall: number | null; precision: number | null; citation_accuracy: number | null };

let seq = 0;
/** One suite run. `at` is a day in October 2026, so a larger day is a newer run. */
function run(
  day: number,
  version: number,
  metrics: Metrics,
  status: "running" | "completed" = "completed",
): EvalSuiteRun {
  seq += 1;
  return {
    run_id: `run-${seq}-d${day}`,
    agent_id: "ag1",
    status,
    agent_version: version,
    started_at: `2026-10-${String(day).padStart(2, "0")}T10:00:00.000Z`,
    finished_at: status === "completed" ? `2026-10-${String(day).padStart(2, "0")}T10:05:00.000Z` : null,
    cases_total: 4,
    cases_done: status === "completed" ? 4 : 1,
    traces_passed: 3,
    traces_total: 4,
    cases_errored: 0,
    duration_ms: 1000,
    cost_usd: 0.01,
    ...metrics,
  };
}

const same: Metrics = { recall: 0.8, precision: 0.8, citation_accuracy: 0.9 };

describe("metricCallout", () => {
  it("AC36: names the metric that moved between the two newest COMPLETED runs, ignoring a newer running run", () => {
    // Newest first. The running v8 run has wildly different numbers: if it were used, the
    // callout would be about recall/citation (or a different version), not precision on v7.
    const runs = [
      run(20, 8, { recall: 0.1, precision: 0.1, citation_accuracy: 0.1 }, "running"),
      run(19, 7, { ...same, precision: 0.8 }),
      run(18, 6, { ...same, precision: 0.82 }),
    ];
    expect(metricCallout(runs)).toEqual({ metric: "precision", direction: "down", points: 2, version: 7 });
  });

  it("AC36: reports a rise as direction up, with the version of the latest completed run", () => {
    const runs = [run(19, 5, { ...same, recall: 0.86 }), run(18, 4, same)];
    expect(metricCallout(runs)).toEqual({ metric: "recall", direction: "up", points: 6, version: 5 });
  });

  it("AC36: picks the largest absolute move, not the first or the last metric", () => {
    const runs = [
      run(19, 3, { recall: 0.81, precision: 0.76, citation_accuracy: 0.92 }),
      run(18, 2, same), // recall +1, precision -4, citation +2
    ];
    expect(metricCallout(runs)).toEqual({ metric: "precision", direction: "down", points: 4, version: 3 });
  });

  it("AC36: on a tie the order is recall, precision, citation", () => {
    const recallVsPrecision = [
      run(19, 3, { recall: 0.83, precision: 0.77, citation_accuracy: 0.9 }),
      run(18, 2, same), // recall +3, precision -3
    ];
    expect(metricCallout(recallVsPrecision)).toMatchObject({ metric: "recall", direction: "up", points: 3 });

    const precisionVsCitation = [
      run(19, 3, { recall: 0.8, precision: 0.82, citation_accuracy: 0.88 }),
      run(18, 2, same), // precision +2, citation -2
    ];
    expect(metricCallout(precisionVsCitation)).toMatchObject({ metric: "precision", direction: "up", points: 2 });
  });

  it("AC36: returns null when every delta rounds to zero points", () => {
    const runs = [run(19, 3, { recall: 0.804, precision: 0.796, citation_accuracy: 0.9 }), run(18, 2, same)];
    expect(metricCallout(runs)).toBeNull();
  });

  it("AC36: returns null with fewer than two completed runs", () => {
    expect(metricCallout([])).toBeNull();
    expect(metricCallout([run(19, 1, same)])).toBeNull();
    // A running run does not count as the second one.
    expect(metricCallout([run(20, 2, { recall: 0.1, precision: 0.1, citation_accuracy: 0.1 }, "running"), run(19, 1, same)])).toBeNull();
  });

  it("AC36: skips a metric that is null on either side", () => {
    const runs = [
      run(19, 3, { recall: null, precision: 0.82, citation_accuracy: 0.9 }),
      run(18, 2, { recall: 0.5, precision: 0.8, citation_accuracy: null }), // only precision (+2) is comparable
    ];
    expect(metricCallout(runs)).toEqual({ metric: "precision", direction: "up", points: 2, version: 3 });
  });

  it("AC36: orders by started_at, not by array position", () => {
    // Oldest first this time; the latest completed run is still v7 (day 19).
    const runs = [
      run(18, 6, { ...same, precision: 0.82 }),
      run(19, 7, { ...same, precision: 0.8 }),
      run(17, 5, { ...same, precision: 0.5 }),
    ];
    expect(metricCallout(runs)).toEqual({ metric: "precision", direction: "down", points: 2, version: 7 });
  });
});

describe("trendPoints", () => {
  it("AC36: returns completed runs oldest first with their values, dropping a running run and a run with a null metric", () => {
    const v3 = run(19, 3, { recall: 0.7, precision: 0.75, citation_accuracy: 0.95 });
    const withNull = run(18, 2, { recall: 0.6, precision: null, citation_accuracy: 0.9 });
    const v1 = run(17, 1, { recall: 0.5, precision: 0.55, citation_accuracy: 0.85 });
    const running = run(20, 4, { recall: 0.1, precision: 0.1, citation_accuracy: 0.1 }, "running");

    // Newest first, as the API serves them.
    expect(trendPoints([running, v3, withNull, v1])).toEqual([
      { run_id: v1.run_id, started_at: v1.started_at, recall: 0.5, precision: 0.55, citation_accuracy: 0.85 },
      { run_id: v3.run_id, started_at: v3.started_at, recall: 0.7, precision: 0.75, citation_accuracy: 0.95 },
    ]);
  });

  it("AC36: drops a run whose recall or citation is null, too (the chart would plot a missing value as 0)", () => {
    const ok = run(17, 1, same);
    const noRecall = run(18, 2, { ...same, recall: null });
    const noCitation = run(19, 3, { ...same, citation_accuracy: null });
    expect(trendPoints([noCitation, noRecall, ok]).map((p) => p.run_id)).toEqual([ok.run_id]);
  });

  it("AC36: is empty without completed runs", () => {
    expect(trendPoints([])).toEqual([]);
    expect(trendPoints([run(19, 1, same, "running")])).toEqual([]);
  });
});
