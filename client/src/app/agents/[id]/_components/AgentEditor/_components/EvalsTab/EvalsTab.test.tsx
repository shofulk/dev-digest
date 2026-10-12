import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCaseView, EvalSuiteRun } from "@devdigest/shared/contracts/eval-ci";
import messages from "../../../../../../../../messages/en/eval.json";

let cases: EvalCaseView[];
let runs: EvalSuiteRun[];
const startMutate = vi.fn();
const startCaseMutate = vi.fn();
vi.mock("@/lib/hooks/eval", () => ({
  useEvalCases: () => ({ data: cases, isLoading: false, isError: false, refetch: vi.fn() }),
  useEvalRuns: () => ({ data: runs, isLoading: false, isError: false, refetch: vi.fn() }),
  useStartEvalRun: () => ({ mutate: startMutate, isPending: false }),
  useDeleteEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
  useStartCaseRun: () => ({ mutate: startCaseMutate, isPending: false }),
  agentRunBusy: (r: EvalSuiteRun[] | undefined, c: EvalCaseView[] | undefined) =>
    !!r?.some((x) => x.status === "running") || !!c?.some((x) => x.running),
}));
vi.mock("@/components/eval-ui/EvalCaseModal", () => ({
  EvalCaseModal: ({ source }: { source: { kind: string; evalCase?: { id: string } } }) => (
    <div data-testid="case-modal">{`${source.kind}:${source.evalCase?.id ?? ""}`}</div>
  ),
}));
vi.mock("@/components/eval-ui/CompareModal", () => ({
  CompareModal: ({ runA, runB }: { runA: string; runB: string }) => (
    <div data-testid="compare-modal">{`${runA}>${runB}`}</div>
  ),
}));

import { EvalsTab } from "./EvalsTab";

afterEach(() => {
  cleanup();
  startMutate.mockReset();
  startCaseMutate.mockReset();
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
  running: false,
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

  it("disables Run all evals while a run is running and shows progress", () => {
    cases = [caseView("1")];
    runs = [run({ run_id: "live", status: "running", cases_done: 2, cases_total: 5, finished_at: null })];
    renderTab();
    const btn = screen.getAllByRole("button").find((b) => b.textContent?.includes("2 / 5"));
    expect(btn).toBeDefined();
    expect(btn).toBeDisabled();
  });

  it("starts a run from an enabled Run all evals button", () => {
    cases = [caseView("1")];
    runs = [];
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Run all evals" }));
    expect(startMutate).toHaveBeenCalledTimes(1);
  });

  it("disables Run all evals with no cases", () => {
    cases = [];
    runs = [];
    renderTab();
    expect(screen.getByRole("button", { name: "Run all evals" })).toBeDisabled();
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
    const card = loc.closest("[data-testid='eval-case-card']") as HTMLElement;
    expect(within(card).getByText("never run")).toBeInTheDocument();
  });
});

describe("EvalsTab metric tiles", () => {
  /** The tile whose label is `label`: its big value and the delta text, when there is one. */
  function tile(label: string) {
    const root = screen.getByText(label).parentElement!;
    const spans = root.querySelectorAll("span.tnum");
    return { value: spans[0]!.textContent, delta: spans[1] ?? null };
  }

  it("shows the latest completed run's percentages and the signed point delta against the previous one", () => {
    cases = [caseView("1")];
    runs = [
      run({ run_id: "live", status: "running", started_at: "2026-10-05T00:00:00Z", recall: 0.1, precision: 0.1 }),
      run({ run_id: "new", started_at: "2026-10-03T00:00:00Z", recall: 0.82, precision: 0.4, citation_accuracy: 1 }),
      run({ run_id: "old", started_at: "2026-10-01T00:00:00Z", recall: 0.78, precision: 0.6, citation_accuracy: 1 }),
    ];
    renderTab();

    const recall = tile("RECALL");
    expect(recall.value).toBe("82%");
    expect(recall.delta!.textContent).toBe("▲ 4pt");
    expect(recall.delta!.getAttribute("style")).toContain("var(--ok)");

    const precision = tile("PRECISION");
    expect(precision.value).toBe("40%");
    expect(precision.delta!.textContent).toBe("▼ 20pt");
    expect(precision.delta!.getAttribute("style")).toContain("var(--crit)");

    const citation = tile("CITATION ACCURACY");
    expect(citation.value).toBe("100%");
    expect(citation.delta!.textContent).toBe("±0pt");
    expect(citation.delta!.getAttribute("style")).toContain("var(--text-muted)");

    expect(tile("TRACES PASSED").value).toBe("3/5");
    expect(tile("TRACES PASSED").delta).toBeNull();
  });

  it("shows no delta when there is only one completed run", () => {
    cases = [caseView("1")];
    runs = [run({ run_id: "only", recall: 0.8 })];
    renderTab();
    expect(tile("RECALL").value).toBe("80%");
    expect(tile("RECALL").delta).toBeNull();
  });

  it("shows the four tiles as an em dash with no delta before any run", () => {
    cases = [caseView("1", { last_result: "never_run", last_run_id: null })];
    runs = [];
    renderTab();
    for (const label of ["RECALL", "PRECISION", "CITATION ACCURACY", "TRACES PASSED"]) {
      const t = tile(label);
      expect(t.value).toBe("—");
      expect(t.delta).toBeNull();
    }
    expect(screen.queryByText(/passing$/)).toBeNull();
  });

  it("links to the full dashboard", () => {
    cases = [];
    runs = [];
    renderTab();
    expect(screen.getByRole("link", { name: "View full dashboard →" })).toHaveAttribute("href", "/eval");
  });
});

describe("EvalsTab case actions", () => {
  const cardOf = (id: string) => screen.getByText(`case-${id}`).closest("[data-testid='eval-case-card']") as HTMLElement;
  const runBtn = (id: string) => within(cardOf(id)).getByRole("button", { name: "Run" });

  it("opens the case modal as a new case from 'New eval case'", () => {
    cases = [caseView("1")];
    runs = [];
    renderTab();
    expect(screen.queryByTestId("case-modal")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "New eval case" }));
    expect(screen.getByTestId("case-modal")).toHaveTextContent("new:");
  });

  it("gives every card Run, Edit and Delete; Edit opens that case, Run starts only that case", () => {
    cases = [caseView("1"), caseView("2")];
    runs = [];
    renderTab();
    for (const id of ["1", "2"]) {
      const card = cardOf(id);
      expect(within(card).getByRole("button", { name: "Run" })).toBeEnabled();
      expect(within(card).getByRole("button", { name: "Edit" })).toBeInTheDocument();
      expect(within(card).getByRole("button", { name: "Delete case" })).toBeInTheDocument();
    }

    fireEvent.click(runBtn("2"));
    expect(startCaseMutate).toHaveBeenCalledTimes(1);
    expect(startCaseMutate.mock.calls[0]![0]).toBe("2");
    expect(startMutate).not.toHaveBeenCalled();

    fireEvent.click(within(cardOf("2")).getByRole("button", { name: "Edit" }));
    expect(screen.getByTestId("case-modal")).toHaveTextContent("edit:2");
  });

  it("shows a running case as 'Running…' with its Run disabled", () => {
    cases = [caseView("1", { running: true }), caseView("2")];
    runs = [];
    renderTab();
    expect(within(cardOf("1")).getByText("Running…")).toBeInTheDocument();
    expect(runBtn("1")).toBeDisabled();
  });

  it("shows the refreshed pass status and match count once a case run settles", () => {
    // Running: the previous (never-run) status is on screen, the run is in flight.
    cases = [caseView("1", { last_result: "never_run", last_run_id: null, last_matched: null, running: true })];
    runs = [];
    const view = renderTab();
    expect(within(cardOf("1")).getByText("Running…")).toBeInTheDocument();
    expect(within(cardOf("1")).getByRole("img", { name: "never run" })).toBeInTheDocument();
    expect(within(cardOf("1")).queryByText(/got/)).toBeNull();
    expect(runBtn("1")).toBeDisabled();

    // Settled: the same case, refetched, now carries the result and the match count.
    cases = [caseView("1", { last_result: "pass", last_matched: 1, running: false })];
    view.rerender(
      <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
        <EvalsTab agentId="ag1" />
      </NextIntlClientProvider>,
    );
    const card = cardOf("1");
    expect(within(card).getByRole("img", { name: "pass" })).toBeInTheDocument();
    expect(within(card).queryByRole("img", { name: "never run" })).toBeNull();
    expect(within(card).getByText("expected ≥1 finding, got 1")).toBeInTheDocument();
    expect(within(card).queryByText("Running…")).toBeNull();
    expect(runBtn("1")).toBeEnabled();
  });

  it("counts a settled pass with no stored match count as got 0 (null boundary)", () => {
    cases = [caseView("1", { last_result: "pass", last_matched: null })];
    runs = [];
    renderTab();
    expect(within(cardOf("1")).getByText("expected ≥1 finding, got 0")).toBeInTheDocument();
  });

  it("disables Run all evals and every card's Run while a suite runs", () => {
    cases = [caseView("1"), caseView("2")];
    runs = [run({ run_id: "live", status: "running", cases_done: 1, cases_total: 2, finished_at: null })];
    renderTab();
    expect(runBtn("1")).toBeDisabled();
    expect(runBtn("2")).toBeDisabled();
    expect(screen.getByRole("button", { name: /1 \/ 2/ })).toBeDisabled();
  });

  it("disables Run all evals and every card's Run while one case runs", () => {
    cases = [caseView("1", { running: true }), caseView("2")];
    runs = [];
    renderTab();
    expect(runBtn("2")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Run all evals" })).toBeDisabled();
  });
});

describe("EvalsTab case cards", () => {
  const mustNot = (over: Partial<EvalCaseView>) =>
    caseView("2", {
      expectation: {
        type: "must_not_flag",
        file: "src/b.ts",
        start_line: 3,
        end_line: 5,
        severity: "WARNING",
        category: "test",
        title: "t",
      },
      ...over,
    });

  it("renders a status icon, the expected/got line, chips, a delete button and the passing badge per card", () => {
    cases = [
      caseView("1", { last_result: "pass", last_matched: 2 }),
      mustNot({ last_result: "fail", last_matched: 1 }),
    ];
    runs = [run({ run_id: "r1" })];
    renderTab();

    const cards = screen.getAllByTestId("eval-case-card");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByRole("img", { name: "pass" })).toBeInTheDocument();
    expect(within(cards[0]!).getByText("expected ≥1 finding, got 2")).toBeInTheDocument();
    expect(within(cards[0]!).getByText("CRITICAL · security")).toBeInTheDocument();
    expect(within(cards[1]!).getByRole("img", { name: "fail" })).toBeInTheDocument();
    expect(within(cards[1]!).getByText("expected 0 findings, got 1")).toBeInTheDocument();
    expect(within(cards[1]!).getByText("WARNING · test")).toBeInTheDocument();
    for (const card of cards) {
      expect(within(card).getByRole("button", { name: "Delete case" })).toBeInTheDocument();
    }
    expect(screen.getByText("1 / 2 passing")).toBeInTheDocument();
  });

  it("labels an errored case without a count and never run without an icon of pass/fail", () => {
    cases = [
      caseView("1", { last_result: "errored", last_matched: null }),
      caseView("2", { last_result: "never_run", last_run_id: null }),
    ];
    runs = [run({ run_id: "r1" })];
    renderTab();
    const [errored, never] = screen.getAllByTestId("eval-case-card");
    expect(within(errored!).getByRole("img", { name: "errored" })).toBeInTheDocument();
    expect(within(errored!).getByText("errored", { selector: "span:not([role])" })).toBeInTheDocument();
    expect(within(errored!).queryByText(/got/)).toBeNull();
    expect(within(never!).getByRole("img", { name: "never run" })).toBeInTheDocument();
  });

  it("truncates a long path on one line and keeps the full path in the title", () => {
    const long = `${"deep/".repeat(30)}file.ts`;
    cases = [
      caseView("1", {
        expectation: {
          type: "must_find",
          file: long,
          start_line: 7,
          end_line: 7,
          severity: "CRITICAL",
          category: "security",
          title: "x",
        },
      }),
    ];
    runs = [];
    renderTab();
    const path = screen.getByText(`${long}:7`);
    expect(path).toHaveAttribute("title", `${long}:7`);
    expect(path.style.textOverflow).toBe("ellipsis");
    expect(path.style.whiteSpace).toBe("nowrap");
    expect(path.style.overflow).toBe("hidden");
  });
});
