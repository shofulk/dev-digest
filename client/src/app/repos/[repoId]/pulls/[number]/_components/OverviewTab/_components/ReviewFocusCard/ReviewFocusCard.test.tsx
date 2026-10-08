/* ReviewFocusCard.test.tsx — T9 (red, docs/plans/pr-brief.plan.md). Written
   against the L1 interface (`ReviewFocusCard({ prId, onOpenFile })` renders
   `null`) and the DOM contract fixed by the plan's Interfaces §UI: an `<ol>`
   whose each `<li>` holds one `<button>` with text `path:line — reason` or
   `path — reason`. `fetch` is mocked — never the hook. Every test is expected
   to fail on an assertion (nothing renders) rather than on an import/type
   error, since the component is still the L1 `return null` skeleton. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrBrief, ReviewFocusItem } from "@devdigest/shared";
import briefMessages from "../../../../../../../../../../messages/en/brief.json";
import { ReviewFocusCard } from "./ReviewFocusCard";

function focusItem(over: Partial<ReviewFocusItem>): ReviewFocusItem {
  return { file: "src/middleware/ratelimit.ts", line: null, reason: "Start here", ...over };
}

function brief(over: Partial<PrBrief>): PrBrief {
  return {
    pr_id: "pr1",
    head_sha: "sha1",
    summary: "x",
    risks: [],
    review_focus: [],
    missing_inputs: [],
    model: "deepseek/deepseek-v4-flash",
    provider: "openrouter",
    generated_at: "2026-10-01T12:00:00Z",
    stats: { tokens_in: 100, tokens_out: 50, cost_usd: 0.001, attempts: 1, duration_ms: 100 },
    ...over,
  };
}

let reply: { status: number; body: unknown };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  reply = { status: 200, body: { brief: null, current_head_sha: "sha1", outdated: false, job: null } };
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

function renderCard(onOpenFile?: (path: string, line: number | null) => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
        <ReviewFocusCard prId="pr1" onOpenFile={onOpenFile} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("ReviewFocusCard", () => {
  it("AC-56: shows the hint to generate the brief when no brief exists", async () => {
    renderCard();
    expect(await screen.findByText("Generate the brief to see where to start reading")).toBeInTheDocument();
  });

  it("AC-55: while a brief exists, shows its items as an ordered list with a count, each as path:line — reason or path — reason", async () => {
    const theBrief = brief({
      review_focus: [
        focusItem({ file: "src/middleware/ratelimit.ts", line: null, reason: "Start here" }),
        focusItem({ file: "src/config.ts", line: 10, reason: "Check the new limits" }),
      ],
    });
    reply = { status: 200, body: { brief: theBrief, current_head_sha: "sha1", outdated: false, job: null } };
    renderCard();

    expect(await screen.findByText("2 items")).toBeInTheDocument();
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("OL");
    expect(screen.getByRole("button", { name: "src/middleware/ratelimit.ts — Start here" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "src/config.ts:10 — Check the new limits" })).toBeInTheDocument();

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("src/middleware/ratelimit.ts — Start here");
    expect(items[1]).toHaveTextContent("src/config.ts:10 — Check the new limits");
  });

  it("AC-57: activating a Review focus item opens the Files changed tab at that file and line", async () => {
    const onOpenFile = vi.fn();
    const theBrief = brief({ review_focus: [focusItem({ file: "src/config.ts", line: 10, reason: "Check the new limits" })] });
    reply = { status: 200, body: { brief: theBrief, current_head_sha: "sha1", outdated: false, job: null } };
    renderCard(onOpenFile);

    const btn = await screen.findByRole("button", { name: "src/config.ts:10 — Check the new limits" });
    fireEvent.click(btn);
    expect(onOpenFile).toHaveBeenCalledWith("src/config.ts", 10);
  });

  it("AC-69: a focus item's reason containing Markdown/HTML/a URL renders as plain text with no link", async () => {
    const theBrief = brief({
      review_focus: [
        focusItem({
          file: "src/config.ts",
          line: null,
          reason: "See http://evil.example and **bold** <b>html</b> for context",
        }),
      ],
    });
    reply = { status: 200, body: { brief: theBrief, current_head_sha: "sha1", outdated: false, job: null } };
    renderCard();

    // Path and reason render in separate styled spans, so assert the joined
    // literal text (button name + list item text), not a single text node.
    const label = "src/config.ts — See http://evil.example and **bold** <b>html</b> for context";
    expect(await screen.findByRole("button", { name: label })).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveTextContent(label);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
