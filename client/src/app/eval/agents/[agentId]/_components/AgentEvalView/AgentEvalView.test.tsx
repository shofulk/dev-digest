import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import type { EvalCaseView, EvalSuiteRun } from "@devdigest/shared/contracts/eval-ci";
import messages from "../../../../../../../messages/en/eval.json";

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ crumb, children }: { crumb?: { label: string; href?: string }[]; children: React.ReactNode }) => (
    <div>
      <nav aria-label="breadcrumb">
        {crumb?.map((c) => (c.href ? <a key={c.label} href={c.href}>{c.label}</a> : <span key={c.label}>{c.label}</span>))}
      </nav>
      {children}
    </div>
  ),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

let agentState: { data?: Agent; isPending: boolean; isError: boolean };
let runs: EvalSuiteRun[];
let caseCount: number;
const startMutate = vi.fn();
vi.mock("@/lib/hooks/agents", () => ({
  useAgent: () => ({ ...agentState, refetch: vi.fn() }),
  useAgents: () => ({
    data: [
      { id: "ag1", name: "Security Reviewer" },
      { id: "ag2", name: "Test Quality Reviewer" },
    ],
  }),
}));
vi.mock("@/lib/hooks/eval", () => ({
  useEvalRuns: () => ({ data: runs, isPending: false, isError: false, refetch: vi.fn() }),
  useEvalCases: () => ({ data: Array.from({ length: caseCount }, () => ({}) as EvalCaseView), isPending: false }),
  useStartEvalRun: () => ({ mutate: startMutate, isPending: false }),
}));
vi.mock("@/components/eval-ui/CompareModal", () => ({
  CompareModal: ({ runA, runB }: { runA: string; runB: string }) => <div data-testid="compare-modal">{`${runA}>${runB}`}</div>,
}));
const notifyError = vi.fn();
vi.mock("@/lib/toast", () => ({ notify: { success: vi.fn(), error: (m: string) => notifyError(m) } }));

import { ApiError } from "@/lib/api";
import { AgentEvalView } from "./AgentEvalView";

afterEach(() => {
  cleanup();
  push.mockReset();
  startMutate.mockReset();
  notifyError.mockReset();
});

const run = (over: Partial<EvalSuiteRun>): EvalSuiteRun => ({
  run_id: "r",
  agent_id: "ag1",
  status: "completed",
  agent_version: 1,
  started_at: "2026-10-01T10:00:00Z",
  finished_at: "2026-10-01T10:05:00Z",
  cases_total: 8,
  cases_done: 8,
  recall: 0.8,
  precision: 0.82,
  citation_accuracy: 0.9,
  traces_passed: 6,
  traces_total: 8,
  cases_errored: 0,
  duration_ms: 1000,
  cost_usd: 0.012,
  ...over,
});

const AGENT = { id: "ag1", name: "Security Reviewer", model: "gpt-4.1", version: 7 } as unknown as Agent;

function setup(opts: { runs?: EvalSuiteRun[]; cases?: number } = {}) {
  agentState = { data: AGENT, isPending: false, isError: false };
  runs = opts.runs ?? [
    run({ run_id: "r7", agent_version: 7, started_at: "2026-10-03T10:00:00Z", precision: 0.8 }),
    run({ run_id: "r6", agent_version: 6, started_at: "2026-10-02T10:00:00Z" }),
    run({ run_id: "r5", agent_version: 5, started_at: "2026-10-01T10:00:00Z", precision: 0.8 }),
  ];
  caseCount = opts.cases ?? 8;
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <AgentEvalView agentId="ag1" />
    </NextIntlClientProvider>,
  );
}

describe("AgentEvalView", () => {
  it("AC36: crumbs, back link, title, model chip and subtitle", () => {
    setup();
    const crumbs = within(screen.getByLabelText("breadcrumb"));
    expect(crumbs.getByText("Skills Lab")).toBeInTheDocument();
    expect(crumbs.getByRole("link", { name: "Eval Dashboard" })).toHaveAttribute("href", "/eval");
    expect(crumbs.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← All agents" })).toHaveAttribute("href", "/eval");
    expect(screen.getByRole("heading", { level: 1, name: "Security Reviewer" })).toBeInTheDocument();
    expect(screen.getByText("gpt-4.1")).toBeInTheDocument();
    expect(screen.getByText("Regression harness · 3 runs on the 8-case set")).toBeInTheDocument();
  });

  it("AC36: the picker switches the route", () => {
    setup();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "ag2" } });
    expect(push).toHaveBeenCalledWith("/eval/agents/ag2");
  });

  it("AC36: Run eval starts a run; it is disabled with progress while a run is running", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Run eval" }));
    expect(startMutate).toHaveBeenCalledTimes(1);
    cleanup();

    setup({ runs: [run({ run_id: "live", status: "running", cases_done: 2, cases_total: 8 })] });
    expect(screen.getByRole("button", { name: /2 \/ 8/ })).toBeDisabled();
  });

  it("AC36: the callout names the metric that moved; absent when nothing moved", () => {
    setup();
    expect(screen.getByRole("status")).toHaveTextContent("Precision dipped 2pt on v7");
    cleanup();

    setup({ runs: [run({ run_id: "a", started_at: "2026-10-02T10:00:00Z" }), run({ run_id: "b" })] });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("AC36: three tiles with whole percents and a point delta", () => {
    setup();
    expect(screen.getByText("RECALL").parentElement).toHaveTextContent("80%±0pt");
    expect(screen.getByText("PRECISION").parentElement).toHaveTextContent("80%▼ 2pt");
    expect(screen.getByText("CITATION ACCURACY").parentElement).toHaveTextContent("90%±0pt");
  });

  it("AC36: the tile sparklines need two completed runs", () => {
    setup();
    for (const label of ["RECALL", "PRECISION", "CITATION ACCURACY"]) {
      expect(screen.getByText(label).parentElement!.querySelector("svg circle")).not.toBeNull();
    }
    cleanup();

    setup({ runs: [run({ run_id: "only" })] });
    for (const label of ["RECALL", "PRECISION", "CITATION ACCURACY"]) {
      expect(screen.getByText(label).parentElement!.querySelector("svg circle")).toBeNull();
    }
  });

  it("AC36: the runs table renders the ran-at cell (mono) per run", () => {
    setup({ runs: [run({ run_id: "r1", started_at: "2026-10-03T10:00:00Z" })] });
    const cell = screen.getByText(new Date("2026-10-03T10:00:00Z").toLocaleString());
    expect(cell).toHaveClass("mono");
    expect(cell.tagName).toBe("TD");
  });

  it("AC36: the selection resets when the agent changes", () => {
    const { rerender } = setup();
    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[0]!);
    fireEvent.click(boxes[1]!);
    expect(screen.getByRole("button", { name: "Compare" })).toBeEnabled();

    rerender(
      <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
        <AgentEvalView agentId="ag2" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("button", { name: "Compare" })).toBeDisabled();
    screen.getAllByRole("checkbox").forEach((b) => expect(b).not.toBeChecked());
  });

  it("AC36: the trend chart needs two points, otherwise a hint", () => {
    setup({ runs: [run({ run_id: "only" })] });
    expect(screen.getByText("Run the suite twice to see a trend")).toBeInTheDocument();
    cleanup();
    setup();
    expect(screen.queryByText("Run the suite twice to see a trend")).not.toBeInTheDocument();
    expect(screen.getByText("Metric trend")).toBeInTheDocument();
  });

  it("AC36: checkboxes only on completed runs; Compare needs exactly two and opens [older, newer]", () => {
    setup({
      runs: [
        run({ run_id: "live", status: "running", started_at: "2026-10-04T10:00:00Z" }),
        run({ run_id: "r7", agent_version: 7, started_at: "2026-10-03T10:00:00Z" }),
        run({ run_id: "r6", agent_version: 6, started_at: "2026-10-02T10:00:00Z" }),
      ],
    });
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    const compare = screen.getByRole("button", { name: "Compare" });
    expect(compare).toBeDisabled();
    fireEvent.click(boxes[0]!); // r7 (newest first)
    expect(compare).toBeDisabled();
    fireEvent.click(boxes[1]!); // r6
    expect(compare).toBeEnabled();
    fireEvent.click(compare);
    expect(screen.getByTestId("compare-modal")).toHaveTextContent("r6>r7");
  });

  it("AC36: the runs table shows versions, meters, pass and cost", () => {
    setup();
    expect(screen.getByText("v7")).toBeInTheDocument();
    expect(screen.getAllByRole("meter").length).toBe(9);
    expect(screen.getAllByText("6/8").length).toBe(3);
    expect(screen.getAllByText("$0.012").length).toBe(3);
  });

  it("AC36: Run eval is disabled when the agent has no eval cases", () => {
    setup({ cases: 0 });
    expect(screen.getByRole("button", { name: "Run eval" })).toBeDisabled();
  });

  it("AC36: a refused start (409 run_in_flight) is toasted with its message", () => {
    startMutate.mockImplementation((_v, o: { onError: (e: unknown) => void }) =>
      o.onError(new ApiError("conflict", 409, "run_in_flight")),
    );
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Run eval" }));
    expect(notifyError).toHaveBeenCalledWith("A run is already in progress for this agent.");
  });

  it("AC36: an agent that failed to load shows the error state instead of the page", () => {
    setup();
    cleanup();
    agentState = { isPending: false, isError: true };
    render(
      <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
        <AgentEvalView agentId="ag1" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Could not load this agent's evals")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });
});
