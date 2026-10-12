/* OverviewTab.brief.test.tsx — T10 (red, docs/plans/pr-brief.plan.md). Written
   against the L1 interface: `OverviewTab` already renders `BriefBanner`,
   `RiskAreas` (passed to `IntentCard` as `riskAreas`) and `ReviewFocusCard` in
   the AC-36 order — but each of those three is still an L1 `return null`
   skeleton, so this file mocks them by module path (as the existing
   `OverviewTab.test.tsx` already does for `BlastRadiusCard`) to pin the DOM
   *order* independent of their own red state, and exercises the real
   `IntentCard` (AC-47: its existing empty/error state still shows Risk areas
   below it). `fetch` is mocked for the intent read — never the hook. Expected
   to fail on an assertion (the real IntentCard currently renders no Risk areas
   section — it has no `riskAreas` consumer bug, but the order/marker
   assertions below are written against the full AC-36/AC-47 behaviour, which
   is only complete once BriefBanner/RiskAreas/ReviewFocusCard are real), never
   on an import/type error. */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import { OverviewTab } from "./OverviewTab";

vi.mock("./_components/BriefBanner", () => ({
  BriefBanner: () => React.createElement("div", { "data-testid": "brief-banner-mock" }),
}));
vi.mock("./_components/BlastRadiusCard", () => ({
  BlastRadiusCard: () => React.createElement("div", { "data-testid": "blast-radius-mock" }),
}));
vi.mock("./_components/RiskAreas", () => ({
  RiskAreas: () => React.createElement("div", { "data-testid": "risk-areas-mock" }, "RiskAreasMarker"),
}));
vi.mock("./_components/ReviewFocusCard", () => ({
  ReviewFocusCard: () => React.createElement("div", { "data-testid": "review-focus-mock" }),
}));

let reply: { status: number; body: unknown };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  reply = { status: 404, body: { error: { code: "not_found" } } };
  fetchMock = vi.fn(async () => {
    const r = reply;
    return { ok: r.status < 400, status: r.status, statusText: "", json: async () => r.body } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ prReview: prReviewMessages }}>
        <OverviewTab prId="pr1" prBody="## Description body" repoFullName="acme/api" headSha="sha1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("OverviewTab — PR Brief", () => {
  it("AC-36: renders, in order, the PR Brief banner, the Intent+Blast row, the Review focus card, then the Description", async () => {
    renderTab();
    await screen.findByText("Couldn’t load the PR intent");

    const banner = screen.getByTestId("brief-banner-mock");
    const intentRiskMarker = screen.getByTestId("risk-areas-mock");
    const blast = screen.getByTestId("blast-radius-mock");
    const focus = screen.getByTestId("review-focus-mock");
    const description = screen.getByText("Description");

    expect(banner.compareDocumentPosition(intentRiskMarker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(intentRiskMarker.compareDocumentPosition(blast) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(blast.compareDocumentPosition(focus) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(focus.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("AC-47: when the intent read fails, the Intent card shows its existing error state and still shows the Risk areas section below it", async () => {
    renderTab();
    const errorState = await screen.findByText("Couldn’t load the PR intent");
    const marker = screen.getByTestId("risk-areas-mock");
    expect(errorState.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("AC-47: when the intent is empty (never derived), the Intent card shows its existing empty state and still shows the Risk areas section below it", async () => {
    reply = { status: 200, body: { intent: null } };
    renderTab();
    const emptyState = await screen.findByText("No intent derived yet");
    const marker = screen.getByTestId("risk-areas-mock");
    expect(emptyState.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
