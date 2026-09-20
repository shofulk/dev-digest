/**
 * FindingsCell + FindingsPopover — the interactive half of the list's FINDINGS column:
 * a counter opens that level's findings without navigating the row, the popover closes the
 * two ways it should, and scrolling re-anchors it rather than dismissing it.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrMeta, ReviewRecord } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/prReview.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const reviewsResult: { data: ReviewRecord[] | undefined; isLoading: boolean } = {
  data: undefined,
  isLoading: false,
};
vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: () => reviewsResult,
}));

import { FindingsCell } from "./FindingsCell";

afterEach(() => {
  cleanup();
  push.mockReset();
});

function finding(o: Partial<FindingRecord> & { id: string }): FindingRecord {
  return {
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded Stripe secret key",
    file: "src/config.ts",
    start_line: 12,
    end_line: 12,
    rationale: "Line 12 contains a literal string starting with sk_live_.",
    suggestion: null,
    confidence: 0.98,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

const REVIEWS = [
  {
    id: "r1",
    pr_id: "pr-1",
    agent_id: "a1",
    run_id: "run-1",
    agent_name: "Security Reviewer",
    kind: "review",
    verdict: "request_changes",
    summary: "s",
    score: 38,
    model: "m",
    created_at: "2026-06-13T08:00:00.000Z",
    findings: [
      finding({ id: "c1" }),
      finding({ id: "w1", severity: "WARNING", title: "N+1 query in user list endpoint" }),
    ],
  },
] as unknown as ReviewRecord[];

const PR = {
  id: "pr-1",
  number: 482,
  title: "Add rate limiting to public API endpoints",
  author: "marisa.koch",
  branch: "feat/rate-limit-public",
  base: "main",
  head_sha: "abc1234",
  additions: 247,
  deletions: 38,
  files_count: 9,
  status: "needs_review",
  opened_at: "2026-06-13T08:00:00.000Z",
  updated_at: "2026-06-13T08:00:00.000Z",
  score: 61,
  cost_usd: 0.014,
  findings_by_severity: { CRITICAL: 1, WARNING: 1, SUGGESTION: 0 },
} satisfies PrMeta;

function renderCell() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {/* The real row navigates on click; this stands in for that handler. */}
      <div onClick={() => push("/repos/repo-1/pulls/482")}>
        <FindingsCell pr={PR} repoId="repo-1" />
      </div>
    </NextIntlClientProvider>,
  );
}

function openCritical() {
  reviewsResult.data = REVIEWS;
  reviewsResult.isLoading = false;
  renderCell();
  fireEvent.click(screen.getAllByRole("button")[0]!);
}

describe("FindingsCell", () => {
  it("opens the popover with only that level's findings", () => {
    openCritical();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Hardcoded Stripe secret key");
    expect(dialog).not.toHaveTextContent("N+1 query in user list endpoint");
    expect(dialog).toHaveTextContent("src/config.ts:12");
  });

  it("does not navigate the row when a counter is clicked", () => {
    openCritical();
    expect(push).not.toHaveBeenCalled();
  });

  it("reports the count and level in the popover heading", () => {
    openCritical();
    expect(screen.getByRole("dialog")).toHaveTextContent("1 critical findings");
  });

  it("links through to the PR filtered to that severity", () => {
    openCritical();
    expect(screen.getByRole("link", { name: /Open in PR/ })).toHaveAttribute(
      "href",
      "/repos/repo-1/pulls/482?tab=findings&severity=CRITICAL",
    );
  });

  it("closes on Escape", () => {
    openCritical();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on a click outside", () => {
    openCritical();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("survives scrolling — including its own inner scroll — instead of closing", () => {
    openCritical();
    const dialog = screen.getByRole("dialog");
    fireEvent.scroll(dialog);
    fireEvent.scroll(window);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("closes when the same counter is clicked again", () => {
    openCritical();
    fireEvent.click(screen.getAllByRole("button")[0]!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("marks the open counter as expanded", () => {
    openCritical();
    expect(screen.getAllByRole("button")[0]).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("button")[1]).toHaveAttribute("aria-expanded", "false");
  });

  it("shows a loading state while the findings are in flight", () => {
    reviewsResult.data = undefined;
    reviewsResult.isLoading = true;
    renderCell();
    fireEvent.click(screen.getAllByRole("button")[0]!);
    expect(screen.getByRole("dialog")).toHaveTextContent("Loading findings…");
  });

  it("explains an empty level instead of rendering an empty box", () => {
    reviewsResult.data = [];
    reviewsResult.isLoading = false;
    renderCell();
    fireEvent.click(screen.getAllByRole("button")[0]!);
    expect(screen.getByRole("dialog")).toHaveTextContent("No findings at this level");
  });
});
