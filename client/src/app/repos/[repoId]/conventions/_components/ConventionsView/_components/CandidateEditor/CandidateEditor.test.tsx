import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { ConventionCandidate } from "@devdigest/shared";
import { ConventionsTestProviders } from "@/test/conventions-intl";
import { CandidateEditor } from "./CandidateEditor";

const CANDIDATE: ConventionCandidate = {
  id: "c1",
  repo_id: "r1",
  category: "naming",
  rule: "Hooks are named use*",
  rationale: "Keeps the lint rule honest",
  evidence_path: "src/lib/hooks/skills.ts",
  evidence_line: 12,
  evidence_snippet: "export function useSkills()",
  confidence: 0.91,
  status: "pending",
  created_at: "2026-09-01T00:00:00Z",
};

function renderEditor(over: Partial<React.ComponentProps<typeof CandidateEditor>> = {}) {
  const handlers = { onSave: vi.fn(), onCancel: vi.fn() };
  render(
    <ConventionsTestProviders>
      <CandidateEditor candidate={CANDIDATE} {...handlers} {...over} />
    </ConventionsTestProviders>,
  );
  return handlers;
}

const rule = () => screen.getByLabelText("Rule") as HTMLInputElement;
const rationale = () => screen.getByLabelText("Why it matters") as HTMLTextAreaElement;
const save = () => screen.getByRole("button", { name: "Save" });

afterEach(cleanup);

describe("CandidateEditor", () => {
  it("seeds both fields from the candidate", () => {
    renderEditor();
    expect(rule()).toHaveValue("Hooks are named use*");
    expect(rationale()).toHaveValue("Keeps the lint rule honest");
  });

  it("renders a null rationale as an empty field, not the string 'null'", () => {
    renderEditor({ candidate: { ...CANDIDATE, rationale: null } });
    expect(rationale()).toHaveValue("");
  });

  it("shows the evidence read-only — there is no control for it", () => {
    renderEditor();
    expect(screen.getByText(/Evidence: src\/lib\/hooks\/skills\.ts:12/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue("src/lib/hooks/skills.ts")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("export function useSkills()")).not.toBeInTheDocument();
  });

  it("saving sends the trimmed rule and the edited rationale", () => {
    const h = renderEditor();
    fireEvent.change(rule(), { target: { value: "  Hooks start with use  " } });
    fireEvent.change(rationale(), { target: { value: "  Because the lint rule says so  " } });
    fireEvent.click(save());

    expect(h.onSave).toHaveBeenCalledTimes(1);
    expect(h.onSave).toHaveBeenCalledWith({
      rule: "Hooks start with use",
      rationale: "Because the lint rule says so",
    });
  });

  it("an emptied rationale is saved as null", () => {
    const h = renderEditor();
    fireEvent.change(rationale(), { target: { value: "   " } });
    fireEvent.click(save());
    expect(h.onSave).toHaveBeenCalledWith({ rule: CANDIDATE.rule, rationale: null });
  });

  it("save is disabled for a blank rule and enabled again once one is typed", () => {
    renderEditor();
    fireEvent.change(rule(), { target: { value: "   " } });
    expect(save()).toBeDisabled();

    fireEvent.change(rule(), { target: { value: "Hooks start with use" } });
    expect(save()).toBeEnabled();
  });

  it("save is disabled and relabelled while the write is in flight", () => {
    renderEditor({ busy: true });
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  });

  it("cancel reports out and sends nothing", () => {
    const h = renderEditor();
    fireEvent.change(rule(), { target: { value: "edited away" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(h.onCancel).toHaveBeenCalledTimes(1);
    expect(h.onSave).not.toHaveBeenCalled();
  });
});
