import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import type { Skill, SkillStats } from "@devdigest/shared";
import { SkillsTestProviders } from "@/test/skills-intl";

const hooks = vi.hoisted(() => ({ useSkillStats: vi.fn(), pieData: vi.fn() }));
vi.mock("@/lib/hooks/skills", () => ({ useSkillStats: hooks.useSkillStats }));

// recharts measures its container, which jsdom cannot; capture what the donut is given instead.
vi.mock("recharts", () => ({
  PieChart: ({ children }: { children?: React.ReactNode }) => <div data-testid="pie-chart">{children}</div>,
  Pie: ({ data }: { data: unknown[] }) => {
    hooks.pieData(data);
    return <div data-testid="pie" />;
  },
  Cell: () => null,
  Tooltip: () => null,
}));

import { StatsTab } from "./StatsTab";

const SKILL: Skill = {
  id: "s1",
  name: "flaky-test-patterns",
  description: "d",
  type: "rubric",
  source: "manual",
  body: "# Rule",
  enabled: true,
  version: 2,
  created_at: "2026-09-01T00:00:00Z",
};

const USED: SkillStats = {
  agent_count: 2,
  pull_rate: 0.92,
  accept_rate: 0.5,
  findings_30d: 11,
  agents: [
    { id: "a1", name: "security-reviewer" },
    { id: "a2", name: "perf-reviewer" },
  ],
  by_category: [
    { category: "style", count: 3 },
    { category: "bug", count: 8 },
  ],
};

const NEVER_USED: SkillStats = {
  agent_count: 0,
  pull_rate: 0,
  accept_rate: 0,
  findings_30d: 0,
  agents: [],
  by_category: [],
};

function renderTab() {
  return render(
    <SkillsTestProviders>
      <StatsTab skill={SKILL} />
    </SkillsTestProviders>,
  );
}

const ready = (data: SkillStats) => ({ data, isLoading: false, isError: false, refetch: vi.fn() });

beforeEach(() => hooks.useSkillStats.mockReturnValue(ready(USED)));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StatsTab", () => {
  it("renders the four tiles with ratios shown as percentages and per-run captions", () => {
    renderTab();
    expect(hooks.useSkillStats).toHaveBeenCalledWith("s1");
    const tile = (label: string) => screen.getByText(label).closest("div")!.parentElement!;

    expect(tile("Used by")).toHaveTextContent("2 agents");
    expect(tile("Pull frequency")).toHaveTextContent("92%");
    expect(tile("Accept rate")).toHaveTextContent("50%");
    expect(tile("Findings (30d)")).toHaveTextContent("11");
    expect(screen.getAllByText(/Per run, last 30 days/)).toHaveLength(2);
    expect(screen.getByText(/not caused by it/)).toBeInTheDocument();
  });

  it("lists the agents with an Open link to their Skills tab", () => {
    renderTab();
    expect(screen.getByText("Agents using this skill")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open security-reviewer" })).toHaveAttribute(
      "href",
      "/agents/a1?tab=skills",
    );
    expect(screen.getByRole("link", { name: "Open perf-reviewer" })).toHaveAttribute("href", "/agents/a2?tab=skills");
  });

  it("gives the donut counts (largest first) and a category → count legend", () => {
    renderTab();
    expect(hooks.pieData).toHaveBeenCalledWith([
      { label: "bug", value: 8, color: "var(--series-1)" },
      { label: "style", value: 3, color: "var(--series-2)" },
    ]);
    const legend = screen.getByRole("list", { name: "Findings per category" });
    const rows = within(legend).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("bug");
    expect(rows[0]).toHaveTextContent("8");
    expect(rows[1]).toHaveTextContent("style");
    expect(rows[1]).toHaveTextContent("3");
    expect(document.body.textContent).not.toContain("$");
  });

  it("renders a never-used skill as zeros and two empty panels, not an error", () => {
    hooks.useSkillStats.mockReturnValue(ready(NEVER_USED));
    renderTab();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("0 agents")).toBeInTheDocument();
    expect(screen.getAllByText("0%")).toHaveLength(2);
    expect(screen.queryByText("NaN%")).not.toBeInTheDocument();
    expect(screen.getByText("No agents yet")).toBeInTheDocument();
    expect(screen.getByText("No findings yet")).toBeInTheDocument();
    expect(screen.queryByTestId("pie")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows a skeleton while loading", () => {
    hooks.useSkillStats.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });
    renderTab();
    expect(document.querySelector("[aria-busy='true']")).toBeInTheDocument();
    expect(screen.queryByText("Used by")).not.toBeInTheDocument();
  });

  it("shows an error with a working retry on failure", () => {
    const refetch = vi.fn();
    hooks.useSkillStats.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    renderTab();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load this skill's stats.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalled();
  });
});
