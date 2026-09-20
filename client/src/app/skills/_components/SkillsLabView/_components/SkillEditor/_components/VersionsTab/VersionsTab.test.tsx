import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within, act } from "@testing-library/react";
import type { Skill, SkillVersionEntry } from "@devdigest/shared";
import { SkillsTestProviders } from "@/test/skills-intl";

const hooks = vi.hoisted(() => ({
  useSkillVersions: vi.fn(),
  useSkillVersionBody: vi.fn(),
  restore: vi.fn(),
}));
vi.mock("@/lib/hooks/skills", () => ({
  useSkillVersions: hooks.useSkillVersions,
  useSkillVersionBody: hooks.useSkillVersionBody,
  useRestoreSkillVersion: () => ({
    mutate: hooks.restore,
    reset: vi.fn(),
    isPending: false,
    isError: false,
  }),
}));

import { VersionsTab } from "./VersionsTab";

const SKILL: Skill = {
  id: "s1",
  name: "flaky-test-patterns",
  description: "d",
  type: "rubric",
  source: "manual",
  body: "# Rule\nkeep this\nnew line",
  enabled: true,
  version: 3,
  created_at: "2026-09-01T00:00:00Z",
};

const VERSIONS: SkillVersionEntry[] = [
  { version: 3, note: "Tightened wording", created_at: "2026-09-03T10:00:00Z", is_current: true },
  { version: 2, note: "Restored v1", created_at: "2026-09-02T10:00:00Z", is_current: false },
  { version: 1, note: null, created_at: "2026-09-01T10:00:00Z", is_current: false },
];

function renderTab() {
  const onRestored = vi.fn();
  render(
    <SkillsTestProviders>
      <VersionsTab skill={SKILL} onRestored={onRestored} />
    </SkillsTestProviders>,
  );
  return { onRestored };
}

beforeEach(() => {
  hooks.useSkillVersions.mockReturnValue({ data: VERSIONS, isLoading: false, isError: false, refetch: vi.fn() });
  hooks.useSkillVersionBody.mockReturnValue({
    data: { version: 2, body: "# Rule\nold line\nkeep this" },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("VersionsTab", () => {
  it("renders the heading, the count chip and the explanatory line", () => {
    renderTab();
    expect(screen.getByRole("heading", { name: "Version history" })).toBeInTheDocument();
    expect(screen.getByText("3 versions")).toBeInTheDocument();
    expect(screen.getByText(/read against the exact text it ran on/)).toBeInTheDocument();
    expect(screen.getByText("No change note")).toBeInTheDocument();
  });

  it("badges the Current row and gives it no actions; older rows get Diff and Restore", () => {
    renderTab();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);

    const current = rows[0]!;
    expect(within(current).getByText("v3")).toBeInTheDocument();
    expect(within(current).getByText("Current")).toBeInTheDocument();
    expect(within(current).queryByRole("button")).not.toBeInTheDocument();

    for (const row of rows.slice(1)) {
      expect(within(row).queryByText("Current")).not.toBeInTheDocument();
      expect(within(row).getByRole("button", { name: /^Diff v/ })).toBeInTheDocument();
      expect(within(row).getByRole("button", { name: /^Restore v/ })).toBeInTheDocument();
    }
  });

  it("opens a diff against the current body with additions and deletions marked by symbol and kind", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Diff v2 against the current body" }));

    expect(hooks.useSkillVersionBody).toHaveBeenLastCalledWith("s1", 2);
    const dialog = screen.getByRole("dialog");
    const removed = dialog.querySelector('[data-kind="del"]')!;
    const added = dialog.querySelector('[data-kind="add"]')!;
    expect(removed).toHaveTextContent("−");
    expect(removed).toHaveTextContent("old line");
    expect(added).toHaveTextContent("+");
    expect(added).toHaveTextContent("new line");
    expect(dialog.querySelectorAll('[data-kind="same"]')).toHaveLength(2);
    expect(dialog).toHaveTextContent("+1 line added");
    expect(dialog).toHaveTextContent("−1 line removed");
  });

  it("says so when a version is identical to the current body", () => {
    hooks.useSkillVersionBody.mockReturnValue({ data: { version: 2, body: SKILL.body }, isLoading: false, isError: false });
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Diff v2 against the current body" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("identical to the current body");
  });

  it("confirms before restoring, then restores and reports back", () => {
    const { onRestored } = renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Restore v2" }));

    expect(hooks.restore).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Restore v2?");
    expect(dialog).toHaveTextContent("becomes current as v4");

    fireEvent.click(within(dialog).getByRole("button", { name: "Restore as v4" }));
    expect(hooks.restore).toHaveBeenCalledWith({ id: "s1", version: 2 }, expect.objectContaining({ onSuccess: expect.any(Function) }));
    expect(onRestored).not.toHaveBeenCalled();

    act(() => hooks.restore.mock.calls[0]![1].onSuccess());
    expect(onRestored).toHaveBeenCalled();
  });

  it("cancelling the confirmation posts nothing", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Restore v1" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(hooks.restore).not.toHaveBeenCalled();
  });

  it("shows a skeleton while loading and an error with retry on failure", () => {
    hooks.useSkillVersions.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { unmount } = render(
      <SkillsTestProviders>
        <VersionsTab skill={SKILL} onRestored={vi.fn()} />
      </SkillsTestProviders>,
    );
    expect(document.querySelector("[aria-busy='true']")).toBeInTheDocument();
    unmount();
    cleanup();

    const refetch = vi.fn();
    hooks.useSkillVersions.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    renderTab();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load the version history.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalled();
  });
});
