import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalDashboardOverview, EvalSuiteRun } from "@devdigest/shared/contracts/eval-ci";
import messages from "../../../../../messages/en/eval.json";

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ crumb, children }: { crumb?: { label: string }[]; children: React.ReactNode }) => (
    <div>
      <nav aria-label="breadcrumb">{crumb?.map((c) => c.label).join(" > ")}</nav>
      {children}
    </div>
  ),
}));

let state: { data?: EvalDashboardOverview; isLoading: boolean; isError: boolean };
const runAllMutate = vi.fn();
let runAllPending = false;
vi.mock("@/lib/hooks/eval", () => ({
  useEvalDashboard: () => ({ ...state, refetch: vi.fn() }),
  useRunAllEvals: () => ({ mutate: runAllMutate, isPending: runAllPending }),
}));
const notifySuccess = vi.fn();
const notifyError = vi.fn();
vi.mock("@/lib/toast", () => ({
  notify: { success: (m: string) => notifySuccess(m), error: (m: string) => notifyError(m) },
}));

import { EvalDashboardView } from "./EvalDashboardView";

afterEach(() => {
  cleanup();
  runAllPending = false;
  runAllMutate.mockReset();
  notifySuccess.mockReset();
  notifyError.mockReset();
});

const run = (over: Partial<EvalSuiteRun>): EvalSuiteRun => ({
  run_id: "r",
  agent_id: "ag1",
  status: "completed",
  agent_version: 2,
  started_at: "2026-10-01T10:00:00Z",
  finished_at: "2026-10-01T10:05:00Z",
  cases_total: 4,
  cases_done: 4,
  recall: 0.75,
  precision: 0.6,
  citation_accuracy: null,
  traces_passed: 3,
  traces_total: 4,
  cases_errored: 0,
  duration_ms: 1000,
  cost_usd: 0.02,
  ...over,
});

const DATA: EvalDashboardOverview = {
  agents: [
    {
      agent_id: "ag1",
      name: "Security Reviewer",
      model: "gpt-4.1",
      cases_total: 4,
      latest: run({ run_id: "r1", agent_id: "ag1" }),
      trend: [
        { run_id: "r0", started_at: "2026-09-30T10:00:00Z", recall: 0.5, precision: 0.5 },
        { run_id: "r1", started_at: "2026-10-01T10:00:00Z", recall: 0.75, precision: 0.6 },
      ],
    },
    {
      agent_id: "ag2",
      name: "Test Quality Reviewer",
      model: "claude",
      cases_total: 2,
      latest: run({ run_id: "r2", agent_id: "ag2", agent_version: 1, recall: 1, traces_passed: 2, traces_total: 2 }),
      trend: [],
    },
    { agent_id: "ag3", name: "Never Run", model: "m3", cases_total: 0, latest: null, trend: [] },
  ],
  recent_runs: [
    { ...run({ run_id: "r2", agent_id: "ag2", agent_version: 1 }), agent_name: "Test Quality Reviewer" },
    { ...run({ run_id: "r1", agent_id: "ag1" }), agent_name: "Security Reviewer" },
  ],
};

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <EvalDashboardView />
    </NextIntlClientProvider>,
  );
}

describe("EvalDashboardView", () => {
  it("AC34: renders the title, subtitle and a Run all agents button", () => {
    state = { data: DATA, isLoading: false, isError: false };
    renderView();
    expect(screen.getByRole("heading", { level: 1, name: "Eval Dashboard" })).toBeInTheDocument();
    expect(screen.getByText(/scored by code/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run all agents" })).toBeEnabled();
  });

  it("AC34: one card link per agent with model, last run, never-run and whole-percent metrics", () => {
    state = { data: DATA, isLoading: false, isError: false };
    renderView();
    const first = screen.getByRole("link", { name: /Security Reviewer/ });
    expect(first).toHaveAttribute("href", "/eval/agents/ag1");
    expect(within(first).getByText("gpt-4.1")).toBeInTheDocument();
    expect(within(first).getByText(/Last run v2 · .* · 3\/4 pass/)).toBeInTheDocument();
    expect(within(first).getByText("75%")).toBeInTheDocument();
    expect(within(first).getByText("60%")).toBeInTheDocument();
    expect(within(first).getByText("RECALL")).toBeInTheDocument();
    expect(within(first).getByText("PREC")).toBeInTheDocument();
    expect(within(first).getByText("CITE")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Never Run/ })).toHaveAttribute("href", "/eval/agents/ag3");
    expect(within(screen.getByRole("link", { name: /Never Run/ })).getByText("never run")).toBeInTheDocument();
  });

  it("AC34: a recall sparkline only for the agent with at least two trend recalls", () => {
    state = { data: DATA, isLoading: false, isError: false };
    renderView();
    const svg = (name: RegExp) => screen.getByRole("link", { name }).querySelector("svg circle");
    expect(svg(/Security Reviewer/)).not.toBeNull();
    expect(svg(/Test Quality Reviewer/)).toBeNull();
  });

  it("AC34: the recent-runs table has meters per row and no cost column", () => {
    state = { data: DATA, isLoading: false, isError: false };
    renderView();
    expect(screen.getByText("Recent eval runs · all agents")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Cost" })).not.toBeInTheDocument();
    const row = screen.getAllByText("Security Reviewer").map((n) => n.closest("tr")).find(Boolean)!;
    expect(within(row).getAllByRole("meter")).toHaveLength(2); // citation is null -> a dash, no meter
    expect(within(row).getByText("v2")).toBeInTheDocument();
    expect(within(row).getByText("3/4")).toBeInTheDocument();
  });

  it("AC34: the recent-runs time cell is rendered mono and a running row shows its progress", () => {
    state = { data: DATA, isLoading: false, isError: false };
    state.data = {
      ...DATA,
      recent_runs: [
        {
          ...run({ run_id: "live", agent_id: "ag1", status: "running", cases_done: 2, cases_total: 4, started_at: "2026-10-02T09:00:00Z" }),
          agent_name: "Security Reviewer",
        },
      ],
    };
    renderView();
    const row = screen.getAllByText("Security Reviewer").map((n) => n.closest("tr")).find(Boolean)!;
    const time = within(row).getByText(new Date("2026-10-02T09:00:00Z").toLocaleString());
    expect(time).toHaveClass("mono");
    expect(within(row).getByText("2 / 4")).toBeInTheDocument();
    expect(within(row).queryByText("3/4")).not.toBeInTheDocument();
  });

  it("AC34: a run with all three metrics renders three meters and the pass fraction", () => {
    state = { data: DATA, isLoading: false, isError: false };
    state.data = {
      ...DATA,
      recent_runs: [{ ...run({ run_id: "full", agent_id: "ag1", citation_accuracy: 0.9 }), agent_name: "Security Reviewer" }],
    };
    renderView();
    const row = screen.getAllByText("Security Reviewer").map((n) => n.closest("tr")).find(Boolean)!;
    expect(within(row).getAllByRole("meter")).toHaveLength(3);
    expect(within(row).getByText("3/4")).toBeInTheDocument();
  });

  it("AC35: the confirmation states agents, cases and calls; Cancel does not run", () => {
    state = { data: DATA, isLoading: false, isError: false };
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Run all agents" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/3 agents × their eval cases = 6 model calls \(6 cases in total\)/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(runAllMutate).not.toHaveBeenCalled();
  });

  it("AC35: Confirm runs once and toasts the started count plus each refusal", () => {
    state = { data: DATA, isLoading: false, isError: false };
    runAllMutate.mockImplementation((_v, o: { onSuccess: (r: unknown) => void }) =>
      o.onSuccess({
        started: [
          { agent_id: "ag1", agent_name: "Security Reviewer", run_id: "11111111-1111-4111-8111-111111111111", refused_reason: null },
          { agent_id: "ag2", agent_name: "Test Quality Reviewer", run_id: null, refused_reason: "run_in_flight" },
        ],
      }),
    );
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Run all agents" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Run 6 calls" }));
    expect(runAllMutate).toHaveBeenCalledTimes(1);
    expect(notifySuccess).toHaveBeenCalledWith("1 run started");
    expect(notifyError).toHaveBeenCalledWith("Test Quality Reviewer: a run is already in flight");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("AC35: Run all agents is disabled while the mutation is pending", () => {
    state = { data: DATA, isLoading: false, isError: false };
    runAllPending = true;
    renderView();
    expect(screen.getByRole("button", { name: "Run all agents" })).toBeDisabled();
  });

  it("AC35: a failed run-all toasts runAll.failed and closes the dialog", () => {
    state = { data: DATA, isLoading: false, isError: false };
    runAllMutate.mockImplementation((_v, o: { onError: (e: unknown) => void }) => o.onError(new Error("boom")));
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Run all agents" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Run 6 calls" }));
    expect(notifyError).toHaveBeenCalledWith("Couldn't start the runs");
    expect(notifySuccess).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the empty state, and disables Run all agents, when no agent has eval cases", () => {
    state = { data: { agents: [], recent_runs: [] }, isLoading: false, isError: false };
    renderView();
    expect(screen.getByText("No agent has eval cases yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run all agents" })).toBeDisabled();
  });

  it("shows the breadcrumb Skills Lab > Eval Dashboard", () => {
    state = { data: DATA, isLoading: false, isError: false };
    renderView();
    expect(screen.getByLabelText("breadcrumb")).toHaveTextContent("Skills Lab > Eval Dashboard");
  });
});
