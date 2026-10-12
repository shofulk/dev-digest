/* DiffTab.focus.test.tsx — T11 (red, docs/plans/pr-brief.plan.md). Written
   against the L1 interface: `DiffTab` already accepts `focusFile`/`focusLine`
   (both currently `void`-ed, unused) and `DiffViewer` accepts `focus` (also
   `void`-ed) — `resolveDiffFocus` always returns `{ kind: "none" }`. D4 fixes
   the shape: the target file's group and file card force-open on mount, the
   view scrolls the file card into view, and the matching new-side line gets
   `aria-current="location"`; a line outside every hunk means no highlighted
   line; a file that is not in the PR shows
   `prReview.smartDiff.focusFileMissing` and nothing scrolls.
   `Element.prototype.scrollIntoView` is stubbed (jsdom has none); `fetch` is
   mocked — never the hooks. Every test here is expected to fail on an
   assertion (nothing expands/scrolls/highlights) rather than on an
   import/type error. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrFile, SmartDiff } from "@devdigest/shared";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import shellMessages from "../../../../../../../../messages/en/shell.json";
import { DiffTab } from "./DiffTab";

// `docs/big.md` is in the `docs` Smart-order group (collapsed by default,
// client/src/components/diff-viewer/constants.ts DEFAULT_COLLAPSED_ROLES) and
// its additions+deletions (250) exceed AUTO_EXPAND_MAX_LINES (200), so its own
// FileCard also starts collapsed — both must expand before the tab can scroll
// to / highlight a line inside it (AC-59).
const FILES: PrFile[] = [
  { path: "src/index.ts", additions: 1, deletions: 0, patch: "@@ -1,1 +1,2 @@\n line one\n+line two" },
  {
    path: "docs/big.md",
    additions: 250,
    deletions: 0,
    patch: "@@ -1,2 +1,3 @@\n line one\n+docs change line\n line three",
  },
];

const SMART_DIFF: SmartDiff = {
  groups: [
    { role: "core", files: [{ path: "src/index.ts", pseudocode_summary: null, additions: 1, deletions: 0, finding_lines: [] }] },
    { role: "docs", files: [{ path: "docs/big.md", pseudocode_summary: null, additions: 250, deletions: 0, finding_lines: [] }] },
  ],
  split_suggestion: { too_big: false, total_lines: 251, proposed_splits: [] },
};

type Reply = { status: number; body: unknown };
let replies: Record<string, Reply>;
let fetchMock: ReturnType<typeof vi.fn>;
let scrollIntoViewMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  replies = {
    "/pulls/pr1/smart-diff": { status: 200, body: SMART_DIFF },
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
          filesCount={2}
          files={FILES}
          additions={251}
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

describe("DiffTab — Files changed focus (D4)", () => {
  it("AC-58/AC-59: expands the collapsed docs group and the collapsed file card, scrolls the file into view, and highlights the targeted new-side line", async () => {
    renderTab("docs/big.md", "2");
    await screen.findByText("Core");

    await waitFor(() => expect(scrollIntoViewMock).toHaveBeenCalled());
    expect(await screen.findByText("docs change line")).toBeInTheDocument();

    const highlighted = document.querySelectorAll('[aria-current="location"]');
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0]).toHaveTextContent("docs change line");
  });

  it("AC-60: when the line is not shown in the diff of that file, scrolls to the file card and highlights no line", async () => {
    renderTab("docs/big.md", "999");
    await screen.findByText("Core");

    await waitFor(() => expect(scrollIntoViewMock).toHaveBeenCalled());
    expect(await screen.findByText("docs change line")).toBeInTheDocument();
    expect(document.querySelectorAll('[aria-current="location"]')).toHaveLength(0);
  });

  it("AC-61: when the file is not a file of this PR, shows a notice and stays at the top (no scroll)", async () => {
    renderTab("src/not-in-pr.ts", "1");
    await screen.findByText("Core");

    expect(await screen.findByRole("status")).toHaveTextContent("This file is no longer in this PR.");
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });
});
