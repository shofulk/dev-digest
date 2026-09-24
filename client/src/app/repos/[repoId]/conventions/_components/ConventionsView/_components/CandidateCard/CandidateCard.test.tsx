import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import type { ConventionCandidate } from "@devdigest/shared";
import { ConventionsTestProviders } from "@/test/conventions-intl";
import { CandidateCard } from "./CandidateCard";

const CANDIDATE: ConventionCandidate = {
  id: "c1",
  repo_id: "r1",
  category: "naming",
  rule: "Hooks are named use*",
  rationale: "Keeps the lint rule honest",
  evidence_path: "src/lib/hooks/skills.ts",
  evidence_line: 12,
  evidence_snippet: "export function useSkills()",
  confidence: 0.876,
  status: "pending",
  created_at: "2026-09-01T00:00:00Z",
};

function renderCard(over: Partial<React.ComponentProps<typeof CandidateCard>> = {}) {
  const handlers = {
    onStatus: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onSelect: vi.fn(),
  };
  render(
    <ConventionsTestProviders>
      <CandidateCard candidate={CANDIDATE} {...handlers} {...over} />
    </ConventionsTestProviders>,
  );
  return handlers;
}

afterEach(cleanup);

describe("CandidateCard", () => {
  it("shows the rule, its category and the verified snippet", () => {
    renderCard();
    expect(screen.getByText("Hooks are named use*")).toBeInTheDocument();
    expect(screen.getByText("naming")).toBeInTheDocument();
    expect(screen.getByText("Keeps the lint rule honest")).toBeInTheDocument();
    expect(screen.getByText("export function useSkills()")).toBeInTheDocument();
  });

  it("renders confidence as a whole percent via toPercent (0.876 → 88%)", () => {
    renderCard();
    expect(screen.getByText("88%")).toBeInTheDocument();
    expect(screen.queryByText(/87\.6/)).not.toBeInTheDocument();
  });

  it("clamps and rounds an out-of-band confidence rather than printing NaN", () => {
    cleanup();
    renderCard({ candidate: { ...CANDIDATE, confidence: 0 } });
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("links the evidence to the exact line when a href is known", () => {
    renderCard({ evidenceHref: "https://github.com/acme/api/blob/main/src/lib/hooks/skills.ts#L12" });
    const link = screen.getByRole("link", { name: "Open this line on GitHub" });
    expect(link).toHaveAttribute("href", "https://github.com/acme/api/blob/main/src/lib/hooks/skills.ts#L12");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveTextContent("src/lib/hooks/skills.ts:12");
  });

  it("falls back to plain path:line text when there is no href", () => {
    renderCard({ evidenceHref: null });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("src/lib/hooks/skills.ts:12")).toBeInTheDocument();
  });

  it("a pending card accepts and rejects", () => {
    const h = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(h.onStatus).toHaveBeenCalledWith("accepted");

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(h.onStatus).toHaveBeenLastCalledWith("rejected");
  });

  it("an accepted card's accept button is the undo — it sends the row back to pending", () => {
    const h = renderCard({ candidate: { ...CANDIDATE, status: "accepted" } });
    fireEvent.click(screen.getByRole("button", { name: "Accepted" }));
    expect(h.onStatus).toHaveBeenCalledWith("pending");
  });

  it("a rejected card's reject button is the undo, and says so in its title", () => {
    const h = renderCard({ candidate: { ...CANDIDATE, status: "rejected" } });
    const undo = screen.getByRole("button", { name: "Rejected" });
    expect(undo).toHaveAttribute("title", "Move back to pending");
    fireEvent.click(undo);
    expect(h.onStatus).toHaveBeenCalledWith("pending");
  });

  it("only a selectable card carries the include checkbox, and it reports both directions", () => {
    renderCard();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    cleanup();

    const h = renderCard({ selectable: true, selected: true });
    const box = screen.getByRole("checkbox", { name: "Include in skill" });
    expect(box).toHaveAttribute("aria-checked", "true");
    fireEvent.click(box);
    expect(h.onSelect).toHaveBeenCalledWith(false);
  });

  it("edit and delete are labelled icon buttons", () => {
    const h = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Edit rule" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete candidate" }));
    expect(h.onEdit).toHaveBeenCalledTimes(1);
    expect(h.onDelete).toHaveBeenCalledTimes(1);
  });

  it("busy disables accept and reject but not edit or delete", () => {
    renderCard({ busy: true });
    const card = screen.getByTestId("candidate-card");
    expect(within(card).getByRole("button", { name: "Accept" })).toBeDisabled();
    expect(within(card).getByRole("button", { name: "Reject" })).toBeDisabled();
    expect(within(card).getByRole("button", { name: "Edit rule" })).toBeEnabled();
  });

  it("omits the rationale paragraph entirely when there is none", () => {
    renderCard({ candidate: { ...CANDIDATE, rationale: null } });
    expect(screen.queryByText("Keeps the lint rule honest")).not.toBeInTheDocument();
  });
});
