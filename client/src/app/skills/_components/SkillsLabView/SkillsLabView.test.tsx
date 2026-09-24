import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Skill, SkillListItem } from "@devdigest/shared";
import { SkillsTestProviders } from "@/test/skills-intl";

const nav = vi.hoisted(() => ({ replace: vi.fn(), query: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.query),
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ crumb, children }: { crumb?: { label: string }[]; children: React.ReactNode }) => (
    <div>
      <nav aria-label="breadcrumb">{crumb?.map((c) => c.label).join(" › ")}</nav>
      {children}
    </div>
  ),
}));

const item = (id: string, name: string): SkillListItem => ({
  id,
  name,
  description: `${name} description`,
  type: "rubric",
  source: "manual",
  body: "",
  enabled: true,
  version: 2,
  created_at: "2026-09-01T00:00:00Z",
  agent_count: 0,
  pull_rate: 0,
  accept_rate: 0,
});
const LIST = [item("s1", "alpha-skill"), item("s2", "beta-skill")];

vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({ data: LIST, isLoading: false, isError: false, refetch: vi.fn() }),
  useUpdateSkill: () => ({ mutate: vi.fn() }),
  useSkillTokens: () => ({ mutate: vi.fn() }),
  // the Stats and Versions tabs are real now; they only need to mount, not to show data
  useSkillStats: () => ({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() }),
  useSkillVersions: () => ({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() }),
  useRestoreSkillVersion: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false }),
  useDeleteSkill: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useCreateSkill: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useSkill: (id: string) => ({ data: { ...LIST.find((x) => x.id === id)! } as Skill, isLoading: false, isError: false }),
}));

import { SkillsLabView } from "./SkillsLabView";

function renderView() {
  render(
    <SkillsTestProviders>
      <SkillsLabView />
    </SkillsTestProviders>,
  );
}

beforeEach(() => {
  nav.query = "";
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SkillsLabView", () => {
  it("shows the breadcrumb and a select prompt when no skill is in the URL", () => {
    renderView();
    expect(screen.getByRole("navigation", { name: "breadcrumb" })).toHaveTextContent("Skills Lab › Skills");
    expect(screen.getByText("Select a skill")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "alpha-skill" })).not.toBeInTheDocument();
  });

  it("restores skill and tab from ?skill=&tab= and falls back to Config on an unknown tab", () => {
    nav.query = "skill=s1&tab=stats";
    renderView();
    expect(screen.getByRole("heading", { name: "alpha-skill" })).toBeInTheDocument();
    // the (loading) Stats tab is mounted: its skeleton, not the Config tab
    expect(document.querySelector("[aria-busy='true']")).toBeInTheDocument();
    cleanup();

    nav.query = "skill=s1&tab=evals";
    renderView();
    expect(screen.getByRole("heading", { name: "Configuration" })).toBeInTheDocument();
  });

  it("writes selection and tab back to the URL, and switching skills keeps the tab", () => {
    nav.query = "skill=s1&tab=versions";
    renderView();

    fireEvent.click(screen.getByText("beta-skill"));
    expect(nav.replace).toHaveBeenLastCalledWith("/skills?skill=s2&tab=versions", { scroll: false });

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/skills?skill=s1&tab=preview", { scroll: false });
  });

  it("opens the create modal from the Add Skill menu", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /Add Skill/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create from scratch" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Create skill");
  });
});
