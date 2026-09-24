import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import type { SkillListItem } from "@devdigest/shared";
import { SkillsTestProviders } from "@/test/skills-intl";

const hooks = vi.hoisted(() => ({
  useSkills: vi.fn(),
  mutate: vi.fn(),
}));
vi.mock("@/lib/hooks/skills", () => ({
  useSkills: hooks.useSkills,
  useUpdateSkill: () => ({ mutate: hooks.mutate }),
}));

import { SkillList } from "./SkillList";

const mk = (id: string, name: string, description: string, over: Partial<SkillListItem> = {}): SkillListItem => ({
  id,
  name,
  description,
  type: "rubric",
  source: "manual",
  body: "",
  enabled: true,
  version: 1,
  created_at: "2026-09-01T00:00:00Z",
  agent_count: 1,
  pull_rate: 1,
  accept_rate: 0.5,
  ...over,
});

const SKILLS = [
  mk("s1", "test-coverage-gaps", "Flag untested code paths"),
  mk("s2", "no-over-mocking", "Prefer real collaborators", { type: "convention" }),
];

function renderList(props: Partial<React.ComponentProps<typeof SkillList>> = {}) {
  const handlers = { onSelect: vi.fn(), onCreate: vi.fn(), onImport: vi.fn() };
  render(
    <SkillsTestProviders>
      <SkillList selectedId={null} {...handlers} {...props} />
    </SkillsTestProviders>,
  );
  return handlers;
}

beforeEach(() => {
  hooks.useSkills.mockReturnValue({ data: SKILLS, isLoading: false, isError: false, refetch: vi.fn() });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SkillList", () => {
  it("filters by name and description case-insensitively, then shows a no-match state", () => {
    renderList();
    const box = screen.getByRole("searchbox", { name: "Search skills" });

    fireEvent.change(box, { target: { value: "MOCKING" } });
    expect(screen.queryByText("test-coverage-gaps")).not.toBeInTheDocument();
    expect(screen.getByText("no-over-mocking")).toBeInTheDocument();

    fireEvent.change(box, { target: { value: "untested" } });
    expect(screen.getByText("test-coverage-gaps")).toBeInTheDocument();

    fireEvent.change(box, { target: { value: "zzz" } });
    expect(screen.getByText("No matching skills")).toBeInTheDocument();
  });

  it("offers exactly two add items and routes them to the right callbacks", () => {
    const h = renderList();
    fireEvent.click(screen.getByRole("button", { name: /Add Skill/ }));

    const create = screen.getByRole("button", { name: "Create from scratch" });
    const menu = create.parentElement as HTMLElement;
    expect(within(menu).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Create from scratch",
      "Import from file",
    ]);
    expect(screen.queryByText("Import from URL")).not.toBeInTheDocument();
    expect(screen.queryByText(/community/i)).not.toBeInTheDocument();

    fireEvent.click(within(menu).getByRole("button", { name: "Import from file" }));
    expect(h.onImport).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /Add Skill/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create from scratch" }));
    expect(h.onCreate).toHaveBeenCalledTimes(1);
  });

  it("writes the card toggle through the mutation without selecting the skill", () => {
    const h = renderList();
    const card = screen.getByText("test-coverage-gaps").closest("[role=button]") as HTMLElement;
    fireEvent.click(within(card).getByRole("switch"));
    expect(hooks.mutate).toHaveBeenCalledWith({ id: "s1", patch: { enabled: false } }, expect.anything());
    expect(h.onSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("no-over-mocking"));
    expect(h.onSelect).toHaveBeenCalledWith("s2");
  });

  it("renders skeletons while loading", () => {
    hooks.useSkills.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });
    renderList();
    expect(screen.getByTestId("skill-list-skeleton").children).toHaveLength(4);
  });

  it("renders an error state whose retry refetches", () => {
    const refetch = vi.fn();
    hooks.useSkills.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    renderList();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load skills.");
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(refetch).toHaveBeenCalled();
  });

  it("renders the empty state with a create CTA for an empty workspace", () => {
    hooks.useSkills.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() });
    const h = renderList();
    expect(screen.getByText("No skills yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create a skill" }));
    expect(h.onCreate).toHaveBeenCalledTimes(1);
  });
});
