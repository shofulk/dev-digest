import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { OverviewTab } from "./OverviewTab";

vi.mock("./_components/IntentCard", () => ({ IntentCard: () => null }));
const blastRadiusCardMock = vi.fn((props: unknown) => React.createElement("div", { "data-testid": "blast-radius-mock" }, JSON.stringify(props)));
vi.mock("./_components/BlastRadiusCard", () => ({
  BlastRadiusCard: (props: unknown) => blastRadiusCardMock(props),
}));

describe("OverviewTab", () => {
  it("renders the PR description as markdown, not raw text", () => {
    const body = "## What's done\n\nGroups files **by role**.\n\n| Path | Role |\n|---|---|\n| `a.ts` | core |";
    render(<OverviewTab prId="pr1" prBody={body} repoFullName="acme/api" headSha="abc123" />);

    expect(screen.getByRole("heading", { level: 2, name: "What's done" })).toBeInTheDocument();
    expect(screen.getByText("by role").tagName).toBe("STRONG");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByText(/## What's done/)).not.toBeInTheDocument();
  });

  it("renders no description section when the PR body is empty", () => {
    render(<OverviewTab prId="pr1" prBody={null} repoFullName="acme/api" headSha="abc123" />);
    expect(screen.queryByText("Description")).not.toBeInTheDocument();
  });

  it("renders BlastRadiusCard with the PR/repo props, before the Description section", () => {
    render(<OverviewTab prId="pr1" prBody="## Description body" repoFullName="acme/api" headSha="abc123" />);
    expect(blastRadiusCardMock).toHaveBeenCalledWith({ prId: "pr1", repoFullName: "acme/api", headSha: "abc123" });
    const blast = screen.getByTestId("blast-radius-mock");
    const description = screen.getByText("Description");
    expect(blast.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
