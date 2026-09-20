import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import type { SkillListItem } from "@devdigest/shared";
import { SkillsTestProviders } from "@/test/skills-intl";
import { SkillCard } from "./SkillCard";

afterEach(cleanup);

const SKILL: SkillListItem = {
  id: "s1",
  name: "test-coverage-gaps",
  description: "Flag changed code paths that no test exercises.",
  type: "rubric",
  source: "manual",
  body: "# Rule",
  enabled: true,
  version: 3,
  created_at: "2026-09-01T00:00:00Z",
  agent_count: 2,
  pull_rate: 1,
  accept_rate: 0.456,
};

function renderCard(skill: SkillListItem, handlers: { onSelect?: () => void; onToggle?: (v: boolean) => void } = {}) {
  return render(
    <SkillsTestProviders>
      <SkillCard
        skill={skill}
        selected={false}
        onSelect={handlers.onSelect ?? (() => {})}
        onToggle={handlers.onToggle ?? (() => {})}
      />
    </SkillsTestProviders>,
  );
}

describe("SkillCard", () => {
  it("shows name, type and source badges, footer stats — and no untrusted badge for a manual skill", () => {
    renderCard(SKILL);
    expect(screen.getByText("test-coverage-gaps")).toBeInTheDocument();
    expect(screen.getByText("rubric")).toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
    expect(screen.getByText("2 agents · 100% pull · 46% accept")).toBeInTheDocument();
    expect(screen.queryByText("needs vetting")).not.toBeInTheDocument();
  });

  it("marks every non-manual source as untrusted", () => {
    renderCard({ ...SKILL, source: "imported_file", type: "security", agent_count: 1 });
    expect(screen.getByText("security")).toBeInTheDocument();
    expect(screen.getByText("Imported")).toBeInTheDocument();
    expect(screen.getByText("needs vetting")).toBeInTheDocument();
    expect(screen.getByText(/^1 agent ·/)).toBeInTheDocument();
  });

  it("toggling enabled fires onToggle and does not select the card", () => {
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    renderCard(SKILL, { onSelect, onToggle });

    fireEvent.click(within(screen.getByRole("button")).getByRole("switch"));
    expect(onToggle).toHaveBeenCalledWith(false);
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("test-coverage-gaps"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
