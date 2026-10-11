import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
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
vi.mock("@/lib/hooks/eval", () => ({
  useEvalDashboard: () => ({ ...state, refetch: vi.fn() }),
}));

import { EvalDashboardView } from "./EvalDashboardView";

afterEach(cleanup);

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
  it("renders one linked row per agent with version and passed/total", () => {
    state = { data: DATA, isLoading: false, isError: false };
    renderView();
    expect(screen.getByRole("heading", { level: 1, name: "Eval Dashboard" })).toBeInTheDocument();
    expect(screen.getByText(/scored by code/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Security Reviewer" });
    expect(link).toHaveAttribute("href", "/agents/ag1?tab=evals");
    expect(screen.getByRole("link", { name: "Test Quality Reviewer" })).toHaveAttribute("href", "/agents/ag2?tab=evals");
    const row = link.closest("tr")!;
    expect(within(row).getByText("v2")).toBeInTheDocument();
    expect(within(row).getByText("3/4")).toBeInTheDocument();
    expect(within(row).getByText("0.75")).toBeInTheDocument();
  });

  it("renders the recent-runs table across agents", () => {
    state = { data: DATA, isLoading: false, isError: false };
    renderView();
    expect(screen.getByText("Recent runs")).toBeInTheDocument();
    // each agent name appears in the agents table and in the recent-runs table
    expect(screen.getAllByText("Security Reviewer")).toHaveLength(2);
  });

  it("shows the empty state when no agent has eval cases", () => {
    state = { data: { agents: [], recent_runs: [] }, isLoading: false, isError: false };
    renderView();
    expect(screen.getByText("No agent has eval cases yet.")).toBeInTheDocument();
  });

  it("shows the breadcrumb Skills Lab > Eval Dashboard", () => {
    state = { data: DATA, isLoading: false, isError: false };
    renderView();
    expect(screen.getByLabelText("breadcrumb")).toHaveTextContent("Skills Lab > Eval Dashboard");
  });
});
