import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { OverviewTab } from "./OverviewTab";

vi.mock("./_components/IntentCard", () => ({ IntentCard: () => null }));

describe("OverviewTab", () => {
  it("renders the PR description as markdown, not raw text", () => {
    const body = "## What's done\n\nGroups files **by role**.\n\n| Path | Role |\n|---|---|\n| `a.ts` | core |";
    render(<OverviewTab prId="pr1" prBody={body} />);

    expect(screen.getByRole("heading", { level: 2, name: "What's done" })).toBeInTheDocument();
    expect(screen.getByText("by role").tagName).toBe("STRONG");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByText(/## What's done/)).not.toBeInTheDocument();
  });

  it("renders no description section when the PR body is empty", () => {
    render(<OverviewTab prId="pr1" prBody={null} />);
    expect(screen.queryByText("Description")).not.toBeInTheDocument();
  });
});
