import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FindingRecord, PrFile, ReviewRecord, SmartDiff } from "@devdigest/shared";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import shellMessages from "../../../../../../../../messages/en/shell.json";
import { DiffTab } from "./DiffTab";

const FILES: PrFile[] = [
  { path: "src/config.ts", additions: 4, deletions: 0, patch: "@@ -1,2 +1,3 @@\n line one\n+line two\n line three" },
  { path: "src/api/users.ts", additions: 5, deletions: 0, patch: null },
];

function finding(over: Partial<FindingRecord>): FindingRecord {
  return {
    id: "f1",
    review_id: "r1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded key",
    file: "src/config.ts",
    start_line: 2,
    end_line: 2,
    rationale: "Because.",
    confidence: 0.9,
    accepted_at: null,
    dismissed_at: null,
    ...over,
  };
}

const REVIEWS: ReviewRecord[] = [
  {
    id: "r1",
    pr_id: "pr1",
    agent_id: "a1",
    run_id: "run1",
    agent_name: "Security",
    kind: "review",
    verdict: "request_changes",
    summary: "x",
    score: 61,
    model: "gpt",
    created_at: "2026-01-01T00:00:00Z",
    findings: [finding({})],
  },
];

const SMART_DIFF: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [
        { path: "src/config.ts", pseudocode_summary: null, additions: 4, deletions: 0, finding_lines: [2] },
        { path: "src/api/users.ts", pseudocode_summary: null, additions: 5, deletions: 0, finding_lines: [] },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 9, proposed_splits: [] },
};

const REVIEWS_DISMISSED: ReviewRecord[] = [
  { ...REVIEWS[0]!, findings: [finding({ dismissed_at: "2026-01-02T00:00:00Z" })] },
];

type Reply = { status: number; body: unknown };
let replies: Record<string, Reply>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  replies = {
    "/pulls/pr1/smart-diff": { status: 200, body: SMART_DIFF },
    "/pulls/pr1/reviews": { status: 200, body: REVIEWS },
    "/pulls/pr1/comments": { status: 200, body: [] },
    "/findings/f1/accept": { status: 200, body: { finding: { ...finding({}), accepted_at: "2026-01-02T00:00:00Z" } } },
    "/findings/f1/dismiss": { status: 200, body: { finding: { ...finding({}), dismissed_at: "2026-01-02T00:00:00Z" } } },
  };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    void init;
    // Dismissing f1 also flips what the next `/reviews` refetch returns —
    // `useFindingAction` invalidates `["reviews", prId]` on success, and the
    // refetched list is what should clear the dot and the group counter.
    if (path === "/findings/f1/dismiss") {
      replies["/pulls/pr1/reviews"] = { status: 200, body: REVIEWS_DISMISSED };
    }
    const r = replies[path] ?? { status: 404, body: {} };
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
      <NextIntlClientProvider locale="en" messages={{ prReview: prReviewMessages, shell: shellMessages }}>
        <DiffTab
          prId="pr1"
          filesCount={9}
          files={FILES}
          additions={247}
          deletions={38}
          repoFullName="acme/api"
          headSha="sha1"
          canComment
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("DiffTab", () => {
  it("shows the header summary and Smart order groups by default", async () => {
    renderTab();
    expect(await screen.findByText(/9 files · \+247 −38/)).toBeInTheDocument();
    const smartBtn = await screen.findByRole("button", { name: "Smart order" });
    expect(smartBtn).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("Core")).toBeInTheDocument();
  });

  it("clicking Accept on the inline card POSTs /findings/:id/accept", async () => {
    renderTab();
    await screen.findByText("Core");
    const acceptBtn = await screen.findByRole("button", { name: "Accept" });
    fireEvent.click(acceptBtn);
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => new URL(u as string).pathname === "/findings/f1/accept");
      expect(call).toBeTruthy();
    });
  });

  it("switching to Original order shows the flat GitHub order with no group headers, and keeps the dot and the inline finding", async () => {
    renderTab();
    await screen.findByText("Core");
    fireEvent.click(screen.getByRole("button", { name: "Original order" }));
    expect(screen.queryByText("Core")).not.toBeInTheDocument();

    // Flat DOM order equals `PrDetail.files` (FILES) order: config.ts, then users.ts.
    const configEl = screen.getByText("src/config.ts");
    const usersEl = screen.getByText("src/api/users.ts");
    expect(configEl.compareDocumentPosition(usersEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // The open-findings dot and the inline finding card both survive the switch.
    expect(screen.getByLabelText("This file has open findings")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded key")).toBeInTheDocument();
  });

  it("a smart-diff load failure shows the error state, and retry re-issues the smart-diff request", async () => {
    replies["/pulls/pr1/smart-diff"] = { status: 500, body: {} };
    renderTab();
    expect(await screen.findByText("Couldn't load the reviewer-ordered diff.")).toBeInTheDocument();
    const smartDiffCalls = () =>
      fetchMock.mock.calls.filter((c: unknown[]) => new URL(c[0] as string).pathname === "/pulls/pr1/smart-diff")
        .length;
    const callsBefore = smartDiffCalls();

    replies["/pulls/pr1/smart-diff"] = { status: 200, body: SMART_DIFF };
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await screen.findByText("Core");
    const callsAfter = smartDiffCalls();
    expect(callsAfter).toBeGreaterThan(callsBefore);
  });

  it("dismissing the finding clears the dot and the group's open-findings counter", async () => {
    renderTab();
    await screen.findByText("Core");
    expect(screen.getByLabelText("This file has open findings")).toBeInTheDocument();
    expect(screen.getByLabelText("1 files with findings")).toBeInTheDocument();

    const dismissBtn = await screen.findByRole("button", { name: "Dismiss" });
    fireEvent.click(dismissBtn);

    await waitFor(() => {
      expect(screen.queryByLabelText("This file has open findings")).not.toBeInTheDocument();
    });
    expect(screen.queryByLabelText("1 files with findings")).not.toBeInTheDocument();
  });
});
