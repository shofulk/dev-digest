/* DiffTab.highlight.test.tsx — fix-list F12 (round 2), spec AC-58: "the tab
   shall scroll the file card of that file into view AND highlight the
   new-side line given by `line`". The frozen DiffTab.focus.test.tsx (T11)
   only proves `aria-current="location"` lands on the right row (the plan's
   DOM contract) — the retro (`pr-brief.retro.md` it.2 #2) flags that as
   insufficient: AC-58 names a *highlight*, i.e. a visible style, and a
   *scroll to that row*, not to the card. This file is a NEW, additional
   oracle; it does not touch DiffTab.focus.test.tsx.

   Written against the spec clause text, not the plan's DOM contract: a
   stub that only sets `aria-current` (today's code) must fail both
   assertions here. `Element.prototype.scrollIntoView` is stubbed (jsdom has
   none); `fetch` is mocked — never the hooks (AGENTS.md "Mock the boundary
   you own"). */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrFile } from "@devdigest/shared";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import shellMessages from "../../../../../../../../messages/en/shell.json";
import { DiffTab } from "./DiffTab";

// One file, two added lines (newNo 1 and 2) — both "add" kind, no findings,
// so the only thing that can legitimately differ between the two rendered
// rows is whether the Files changed tab's focus target picked one of them.
const FILES: PrFile[] = [
  { path: "src/index.ts", additions: 2, deletions: 0, patch: "@@ -0,0 +1,2 @@\n+line one\n+line two" },
];

type Reply = { status: number; body: unknown };
let replies: Record<string, Reply>;
let fetchMock: ReturnType<typeof vi.fn>;
let scrollIntoViewMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  replies = {
    "/pulls/pr1/smart-diff": { status: 200, body: { groups: [], split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] } } },
    "/pulls/pr1/reviews": { status: 200, body: [] },
    "/pulls/pr1/comments": { status: 200, body: [] },
  };
  fetchMock = vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    const r = replies[path] ?? { status: 404, body: {} };
    return { ok: r.status < 400, status: r.status, statusText: "", json: async () => r.body } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  scrollIntoViewMock = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoViewMock;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderTab(focusFile?: string | null, focusLine?: string | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ prReview: prReviewMessages, shell: shellMessages }}>
        <DiffTab
          prId="pr1"
          filesCount={1}
          files={FILES}
          additions={2}
          deletions={0}
          repoFullName="acme/api"
          headSha="sha1"
          canComment
          focusFile={focusFile}
          focusLine={focusLine}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("DiffTab — AC-58 visible highlight and row-level scroll (F13)", () => {
  it("AC-58: the focused new-side row has a visibly different style from an unfocused row of the same kind", async () => {
    renderTab("src/index.ts", "2");
    const line1 = await screen.findByText("line one");
    const line2 = await screen.findByText("line two");

    // Both rows are plain "add" lines with no findings — `rowStyle` in
    // CodeLine.tsx is otherwise identical for the two, so any difference in
    // the rendered inline style can only come from one of them being the
    // AC-58 highlight target.
    const row1Style = line1.parentElement!.getAttribute("style");
    const row2Style = line2.parentElement!.getAttribute("style");
    expect(row2Style).not.toBe(row1Style);
  });

  it("AC-58: scrollIntoView is called on the focused row itself, not only the file card", async () => {
    renderTab("src/index.ts", "2");
    await screen.findByText("line two");
    await waitFor(() => expect(scrollIntoViewMock).toHaveBeenCalled());

    const highlightedRow = document.querySelector('[aria-current="location"]');
    expect(highlightedRow).not.toBeNull();

    const lastCallReceiver = scrollIntoViewMock.mock.contexts.at(-1);
    expect(lastCallReceiver).toBe(highlightedRow);
  });

  it("AC-58: with no line, falls back to scrolling the file card (not a row)", async () => {
    renderTab("src/index.ts", null);
    const fileHeader = await screen.findByText("src/index.ts");
    const fileCard = fileHeader.parentElement!.parentElement!;
    await waitFor(() => expect(scrollIntoViewMock).toHaveBeenCalled());

    expect(document.querySelector('[aria-current="location"]')).toBeNull();
    const lastCallReceiver = scrollIntoViewMock.mock.contexts.at(-1);
    expect(lastCallReceiver).toBe(fileCard);
  });
});
