import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act, within } from "@testing-library/react";
import type { Skill } from "@devdigest/shared";
import { SkillsTestProviders } from "@/test/skills-intl";

const hooks = vi.hoisted(() => ({ update: vi.fn(), tokens: vi.fn(), pending: false }));
vi.mock("@/lib/hooks/skills", () => ({
  useUpdateSkill: () => ({ mutate: hooks.update, isPending: hooks.pending, isError: false, error: null }),
  useSkillTokens: () => ({ mutate: hooks.tokens }),
}));

import { ConfigTab } from "./ConfigTab";

const SKILL: Skill = {
  id: "s1",
  name: "flaky-test-patterns",
  description: "Apply when tests are flaky.",
  type: "rubric",
  source: "manual",
  body: "# Rule\nDo the thing.",
  enabled: true,
  version: 4,
  created_at: "2026-09-01T00:00:00Z",
  tokens: 9,
};

function renderTab(over: Partial<React.ComponentProps<typeof ConfigTab>> = {}, skill: Skill = SKILL) {
  const props = { skill, onDraftBodyChange: vi.fn(), ...over };
  const view = render(
    <SkillsTestProviders>
      <ConfigTab {...props} />
    </SkillsTestProviders>,
  );
  const rerender = (next: React.ComponentProps<typeof ConfigTab>) =>
    view.rerender(
      <SkillsTestProviders>
        <ConfigTab {...next} />
      </SkillsTestProviders>,
    );
  return { props, rerender };
}

const saveButton = () => screen.getByRole("button", { name: "Save changes" });
const bodyBox = () => screen.getByRole("textbox", { name: "Skill body (Markdown)" });

beforeEach(() => {
  hooks.pending = false;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ConfigTab", () => {
  it("renders the fields, the version chip, the Enabled switch and the description hint", () => {
    renderTab();
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("flaky-test-patterns");
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("Apply when tests are flaky.");
    const type = within(screen.getByRole("group", { name: "Type" })).getByRole("combobox");
    expect(type).toHaveValue("rubric");
    expect(within(type).getAllByRole("option").map((o) => o.getAttribute("value"))).toEqual([
      "rubric",
      "convention",
      "security",
      "custom",
    ]);
    expect(bodyBox()).toHaveValue("# Rule\nDo the thing.");
    expect(screen.getByText("v4")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enabled" })).toBeChecked();
    expect(screen.getByText(/description is the skill's interface/i)).toHaveTextContent("instruction");
  });

  it("keeps Save disabled while nothing changed, and does not mark the form dirty", () => {
    const { props } = renderTab();
    expect(saveButton()).toBeDisabled();
    expect(screen.queryByText("unsaved")).not.toBeInTheDocument();
    expect(props.onDraftBodyChange).toHaveBeenLastCalledWith(null);
  });

  it("shows `unsaved`, enables Save and reports the draft when the body is edited; reverting clears it", () => {
    const { props } = renderTab();
    fireEvent.change(bodyBox(), { target: { value: "# Rule\nEdited." } });
    expect(screen.getByText("unsaved")).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
    expect(props.onDraftBodyChange).toHaveBeenLastCalledWith("# Rule\nEdited.");

    fireEvent.change(bodyBox(), { target: { value: SKILL.body } });
    expect(screen.queryByText("unsaved")).not.toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    expect(props.onDraftBodyChange).toHaveBeenLastCalledWith(null);
  });

  it("disables Save while a save is in flight", () => {
    hooks.pending = true;
    renderTab({}, SKILL);
    fireEvent.change(bodyBox(), { target: { value: "x" } });
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  });

  it("asks for a prefilled change note on a body save and sends it", () => {
    const { props, rerender } = renderTab();
    fireEvent.change(bodyBox(), { target: { value: "# Rule\nEdited." } });
    fireEvent.click(saveButton());
    expect(hooks.update).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog");
    const note = within(dialog).getByRole("textbox", { name: "Change note" });
    expect(note).toHaveValue("Updated flaky-test-patterns");
    fireEvent.change(note, { target: { value: "Tightened the rule" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save version" }));

    expect(hooks.update).toHaveBeenCalledTimes(1);
    expect(hooks.update.mock.calls[0]![0]).toEqual({
      id: "s1",
      patch: { body: "# Rule\nEdited.", note: "Tightened the rule" },
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // after the save lands the draft is cleared and the form shows the saved copy
    const saved = { ...SKILL, body: "# Rule\nEdited.", version: 5 };
    act(() => hooks.update.mock.calls[0]![1].onSuccess(saved));
    rerender({ ...props, skill: saved }); // the hook's cache write hands the tab the new skill
    expect(screen.getByText("v5")).toBeInTheDocument();
    expect(props.onDraftBodyChange).toHaveBeenLastCalledWith(null);
    expect(screen.queryByText("unsaved")).not.toBeInTheDocument();
  });

  it("lets the note be skipped: the body is saved with no note", () => {
    renderTab();
    fireEvent.change(bodyBox(), { target: { value: "# Rule\nEdited." } });
    fireEvent.click(saveButton());
    fireEvent.click(screen.getByRole("button", { name: "Skip note" }));
    const arg = hooks.update.mock.calls[0]![0];
    expect(arg.patch).toEqual({ body: "# Rule\nEdited." });
    expect("note" in arg.patch).toBe(false);
  });

  it("saves nothing when the note prompt is dismissed", () => {
    renderTab();
    fireEvent.change(bodyBox(), { target: { value: "# Rule\nEdited." } });
    fireEvent.click(saveButton());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(hooks.update).not.toHaveBeenCalled();
  });

  it("saves a metadata-only change at once, with no note and no body", () => {
    renderTab();
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), { target: { value: "New description." } });
    expect(screen.queryByText("unsaved")).not.toBeInTheDocument();
    fireEvent.click(saveButton());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(hooks.update).toHaveBeenCalledTimes(1);
    expect(hooks.update.mock.calls[0]![0]).toEqual({ id: "s1", patch: { description: "New description." } });
  });

  it("refuses to save an empty name", () => {
    renderTab();
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "  " } });
    expect(saveButton()).toBeDisabled();
  });

  it("writes the global Enabled switch straight away, independent of Save", () => {
    renderTab();
    fireEvent.click(screen.getByRole("switch", { name: "Enabled" }));
    expect(hooks.update.mock.calls[0]![0]).toEqual({ id: "s1", patch: { enabled: false } });
  });

  it("starts from the shell's unsaved body when remounted after a tab switch", () => {
    renderTab({ draftBody: "# Rule\nKept across tabs." });
    expect(bodyBox()).toHaveValue("# Rule\nKept across tabs.");
    expect(screen.getByText("unsaved")).toBeInTheDocument();
  });

  it("resets the form when another skill is selected", () => {
    const { props, rerender } = renderTab();
    fireEvent.change(bodyBox(), { target: { value: "half-typed" } });
    rerender({ ...props, skill: { ...SKILL, id: "s2", name: "other", body: "# Other" } });
    expect(bodyBox()).toHaveValue("# Other");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("other");
    expect(screen.queryByText("unsaved")).not.toBeInTheDocument();
  });
});
