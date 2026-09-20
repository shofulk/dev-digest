import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import type { Skill } from "@devdigest/shared";
import { SkillsTestProviders } from "@/test/skills-intl";

const hooks = vi.hoisted(() => ({
  useSkill: vi.fn(),
  del: vi.fn(),
}));
vi.mock("@/lib/hooks/skills", () => ({
  useSkill: hooks.useSkill,
  useDeleteSkill: () => ({ mutate: hooks.del, isPending: false, isError: false }),
  // the real ConfigTab is mounted on the default tab
  useUpdateSkill: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useSkillTokens: () => ({ mutate: vi.fn() }),
}));

import { SkillEditor } from "./SkillEditor";

const SKILL: Skill = {
  id: "s1",
  name: "flaky-test-patterns",
  description: "d",
  type: "rubric",
  source: "manual",
  body: "# Rule",
  enabled: true,
  version: 4,
  created_at: "2026-09-01T00:00:00Z",
};

function renderEditor(over: Partial<React.ComponentProps<typeof SkillEditor>> = {}) {
  const props = { skillId: "s1", tab: "config" as const, onTab: vi.fn(), onDeleted: vi.fn(), ...over };
  render(
    <SkillsTestProviders>
      <SkillEditor {...props} />
    </SkillsTestProviders>,
  );
  return props;
}

beforeEach(() => {
  hooks.useSkill.mockReturnValue({ data: SKILL, isLoading: false, isError: false, refetch: vi.fn() });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SkillEditor", () => {
  it("renders the header, exactly the four tabs and no evals control", () => {
    const p = renderEditor();
    expect(screen.getByRole("heading", { name: "flaky-test-patterns" })).toBeInTheDocument();
    // header chip + the Config tab's own chip beside its section heading
    expect(screen.getAllByText("v4")).toHaveLength(2);
    for (const name of ["Config", "Preview", "Stats", "Versions"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.queryByText(/evals/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stats" }));
    expect(p.onTab).toHaveBeenCalledWith("stats");
  });

  it("shows the untrusted notice for a non-manual source", () => {
    hooks.useSkill.mockReturnValue({ data: { ...SKILL, source: "imported_file" }, isLoading: false, isError: false });
    renderEditor();
    expect(screen.getByRole("note")).toHaveTextContent("came from an untrusted source");
  });

  it("confirms deletion, saying the skill is unlinked from every agent, before deleting", () => {
    const p = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Delete skill" }));
    expect(hooks.del).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent("unlinked from every agent");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(hooks.del).toHaveBeenCalledWith("s1", expect.objectContaining({ onSuccess: expect.any(Function) }));

    act(() => hooks.del.mock.calls[0]![1].onSuccess());
    expect(p.onDeleted).toHaveBeenCalled();
  });
});
