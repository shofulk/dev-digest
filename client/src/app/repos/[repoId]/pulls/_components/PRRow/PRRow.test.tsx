/**
 * PRRow — the COST cell. The grid template, COLUMN_KEYS and the row's hand-written
 * cells are coupled only by convention, so this guards that the cost cell exists
 * and that an unpriced PR reads as unknown rather than as free.
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
