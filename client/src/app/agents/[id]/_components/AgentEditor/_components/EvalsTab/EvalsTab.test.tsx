import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCaseView, EvalSuiteRun } from "@devdigest/shared/contracts/eval-ci";
import messages from "../../../../../../../../messages/en/eval.json";
import { canCompare, latestTwoCompleted, toggleSelected } from "./helpers";

let cases: EvalCaseView[];
let runs: EvalSuiteRun[];
const startMutate = vi.fn();
vi.mock("@/lib/hooks/eval", () => ({
  useEvalCases: () => ({ data: cases, isLoading: false, isError: false, refetch: vi.fn() }),
  useEvalRuns: () => ({ data: runs, isLoading: false, isError: false, refetch: vi.fn() }),
  useStartEvalRun: () => ({ mutate: startMutate, isPending: false }),
  useDeleteEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("./_components/CompareModal", () => ({
  CompareModal: ({ runA, runB }: { runA: string; runB: string }) => (
    <div data-testid="compare-modal">{`${runA}>${runB}`}</div>
  ),
}));

import { EvalsTab } from "./EvalsTab";

afterEach(() => {
  cleanup();
  startMutate.mockReset();
});

const run = (over: Partial<EvalSuiteRun>): EvalSuiteRun => ({
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

const caseView = (id: string, over: Partial<EvalCaseView> = {}): EvalCaseView => ({
  case: {
    id,
    owner_kind: "agent",
    owner_id: "ag1",
    name: `case-${id}`,
    input_diff: "",
    input_files: null,
    input_meta: null,
    expected_output: null,
    notes: null,
  } as unknown as EvalCaseView["case"],
  expectation: {
    type: "must_find",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded key",
  },
  last_result: "pass",
  last_run_id: "r1",
  ...over,
});

function renderTab(agentId = "ag1") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <EvalsTab agentId={agentId} />
    </NextIntlClientProvider>,
  );
}

const compareBtn = () => screen.getByRole("button", { name: "Compare" });
const checkboxes = () => screen.getAllByRole("checkbox");

describe("EvalsTab", () => {
  it("enables Compare only at exactly two selected runs", () => {
    cases = [caseView("1")];
    runs = [
      run({ run_id: "a", started_at: "2026-10-03T10:00:00Z" }),
      run({ run_id: "b", started_at: "2026-10-02T10:00:00Z" }),
      run({ run_id: "c", started_at: "2026-10-01T10:00:00Z" }),
    ];
    renderTab();
    expect(compareBtn()).toBeDisabled();
    fireEvent.click(checkboxes()[0]!);
    expect(compareBtn()).toBeDisabled();
    fireEvent.click(checkboxes()[1]!);
    expect(compareBtn()).toBeEnabled();
    fireEvent.click(checkboxes()[2]!);
    expect(compareBtn()).toBeDisabled();
  });

  it("opens the modal with the older run first even when the newer was ticked first", () => {
    cases = [caseView("1")];
    runs = [
      run({ run_id: "new", started_at: "2026-10-03T10:00:00Z" }),
      run({ run_id: "old", started_at: "2026-10-01T10:00:00Z" }),
    ];
    renderTab();
    fireEvent.click(checkboxes()[0]!); // newest first in the list
    fireEvent.click(checkboxes()[1]!);
    fireEvent.click(compareBtn());
    expect(screen.getByTestId("compare-modal")).toHaveTextContent("old>new");
  });

  it("disables Run evals while a run is running and shows progress", () => {
    cases = [caseView("1")];
    runs = [run({ run_id: "live", status: "running", cases_done: 2, cases_total: 5, finished_at: null })];
    renderTab();
    const btn = screen.getAllByRole("button").find((b) => b.textContent?.includes("2 / 5"));
    expect(btn).toBeDefined();
    expect(btn).toBeDisabled();
  });

  it("starts a run from an enabled Run evals button", () => {
    cases = [caseView("1")];
    runs = [];
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Run evals" }));
    expect(startMutate).toHaveBeenCalledTimes(1);
  });

  it("disables Run evals with no cases", () => {
    cases = [];
    runs = [];
    renderTab();
    expect(screen.getByRole("button", { name: "Run evals" })).toBeDisabled();
    expect(screen.getByText(/No eval cases yet/)).toBeInTheDocument();
  });

  it("shows the type badge, a plain file:line and never run for an unrun case", () => {
    cases = [caseView("1", { last_result: "never_run", last_run_id: null })];
    runs = [];
    renderTab();
    expect(screen.getByText("must find")).toBeInTheDocument();
    const loc = screen.getByText("src/config.ts:11");
    expect(loc.tagName).toBe("SPAN");
    expect(screen.queryByRole("link", { name: /config\.ts/ })).toBeNull();
    const row = loc.closest("tr")!;
    expect(within(row).getByText("never run")).toBeInTheDocument();
  });
});

describe("EvalsTab metric tiles", () => {
  /** The tile whose label is `label`: its value and signed delta (colour carries the sign). */
  function tile(label: string) {
    const root = screen.getByText(label).parentElement!.parentElement!;
    return {
      value: root.querySelector("span.tnum")!.firstChild!.textContent,
      deltas: Array.from(root.querySelectorAll("span.tnum")).slice(1),
    };
  }

  it("shows the latest completed run's values and the signed delta against the previous one", () => {
    cases = [caseView("1")];
    runs = [
      run({ run_id: "live", status: "running", started_at: "2026-10-05T00:00:00Z", recall: 0.1, precision: 0.1 }),
      run({ run_id: "new", started_at: "2026-10-03T00:00:00Z", recall: 0.8, precision: 0.4, citation_accuracy: 1 }),
      run({ run_id: "old", started_at: "2026-10-01T00:00:00Z", recall: 0.5, precision: 0.6, citation_accuracy: 1 }),
    ];
    renderTab();

    const recall = tile("RECALL");
    expect(recall.value).toBe("0.80");
    expect(recall.deltas.map((d) => d.textContent)).toEqual(["0.30"]);
    expect(recall.deltas[0]!.parentElement!.getAttribute("style")).toContain("var(--ok)");

    const precision = tile("PRECISION");
    expect(precision.value).toBe("0.40");
    expect(precision.deltas.map((d) => d.textContent)).toEqual(["0.20"]);
    expect(precision.deltas[0]!.parentElement!.getAttribute("style")).toContain("var(--crit)");

    const citation = tile("CITATION ACCURACY");
    expect(citation.value).toBe("1.00");
    expect(citation.deltas[0]!.parentElement!.getAttribute("style")).toContain("var(--text-muted)");
  });

  it("shows no delta when there is only one completed run", () => {
    cases = [caseView("1")];
    runs = [run({ run_id: "only", recall: 0.8 })];
    renderTab();
    expect(tile("RECALL").value).toBe("0.80");
    expect(tile("RECALL").deltas).toHaveLength(0);
  });
});

describe("EvalsTab helpers", () => {
  it("canCompare / toggleSelected", () => {
    expect([[], ["a"], ["a", "b"], ["a", "b", "c"]].map((x) => canCompare(x))).toEqual([false, false, true, false]);
    expect(toggleSelected(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleSelected(["a", "b"], "a")).toEqual(["b"]);
  });

  it("latestTwoCompleted ignores a newer running run", () => {
    const { latest, previous } = latestTwoCompleted([
      run({ run_id: "live", status: "running", started_at: "2026-10-05T00:00:00Z" }),
      run({ run_id: "old", started_at: "2026-10-01T00:00:00Z" }),
      run({ run_id: "mid", started_at: "2026-10-03T00:00:00Z" }),
    ]);
    expect([latest?.run_id, previous?.run_id]).toEqual(["mid", "old"]);
  });
});
