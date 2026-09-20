/**
 * PRRow — the COST and FINDINGS cells. The grid template, COLUMN_KEYS and the row's
 * hand-written cells are coupled only by convention, so this guards that both cells exist,
 * that an unpriced PR reads as unknown rather than as free, and that the three findings
 * states (counts / reviewed-and-clean / never reviewed) stay distinguishable.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/prReview.json";
import { COLUMN_KEYS, GRID } from "../../constants";
import { PRRow } from "./PRRow";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

afterEach(cleanup);

function pr(o: Partial<PrMeta> = {}): PrMeta {
  return {
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
    findings_by_severity: { CRITICAL: 2, WARNING: 3, SUGGESTION: 0 },
    ...o,
  };
}

function renderRow(p: PrMeta) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <PRRow pr={p} repoId="repo-1" />
    </NextIntlClientProvider>,
  );
}

describe("PRRow cost cell", () => {
  it("renders the PR's total cost", () => {
    renderRow(pr());
    expect(screen.getByText("$0.014")).toBeTruthy();
  });

  it("keeps a sub-cent total legible instead of showing $0.00", () => {
    renderRow(pr({ cost_usd: 0.0013 }));
    expect(screen.getByText("$0.0013")).toBeTruthy();
  });

  it("shows an em dash — not $0.00 — for a PR with no priced run", () => {
    renderRow(pr({ cost_usd: null }));
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.queryByText("$0.00")).toBeNull();
  });

  it("has one grid track per column key, so header and cells stay aligned", () => {
    expect(GRID.trim().split(/\s+/)).toHaveLength(COLUMN_KEYS.length);
  });
});

describe("PRRow findings cell", () => {
  it("renders a counter per non-empty severity", () => {
    renderRow(pr());
    const counters = screen.getByRole("group", { name: "Filter findings by severity" });
    expect(counters).toHaveTextContent("2");
    expect(counters).toHaveTextContent("3");
    // SUGGESTION is 0 — dropped in the cell, not rendered as a zero.
    expect(counters.querySelectorAll("button")).toHaveLength(2);
  });

  it("marks a reviewed PR with no findings as clean, not as unknown", () => {
    renderRow(pr({ findings_by_severity: { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 } }));
    expect(screen.getByLabelText("No findings")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Filter findings by severity" })?.querySelectorAll("button") ?? []).toHaveLength(0);
  });

  it("reads as unknown for a PR that was never reviewed", () => {
    renderRow(pr({ score: null, cost_usd: null }));
    expect(screen.getByTitle("Not reviewed yet")).toBeTruthy();
    expect(screen.queryByLabelText("No findings")).toBeNull();
  });
});
