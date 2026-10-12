/* BriefBanner.errorCopy.test.tsx — fix-list F20 (round 3), retro class
   `test-oracle-weaker-than-plan`. The frozen `BriefBanner.errors.test.tsx`
   (F14, round 2, hash a3348c43) only asserts the status region is non-empty
   and does not contain the raw code — a single generic message would pass
   all three of its cases, so it never actually tells the 409/429/network
   branches apart. This NEW file (does not touch the frozen one) pins the
   EXACT per-branch copy from messages/en/brief.json, and additionally proves
   the three strings are pairwise distinct — if `BriefBanner.tsx` ever
   returned one branch's copy for another branch's error, the corresponding
   `toBe` assertion below fails (see comments per test for which assertion
   catches which swap). Per the fix-list's "Expected after the fix" column,
   this may already be green against current code
   (`BriefBanner.tsx:53-58`) — that is fine; see the Red proof table in the
   report. `fetch` and `EventSource` are mocked — never the hooks. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import briefMessages from "../../../../../../../../../../messages/en/brief.json";
import prReviewMessages from "../../../../../../../../../../messages/en/prReview.json";
import { BriefBanner } from "./BriefBanner";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

type Handler = () => { status: number; body: unknown } | "network-error";
let handlers: Record<string, Handler>;
let fetchMock: ReturnType<typeof vi.fn>;

function setHandler(method: string, path: string, body: unknown, status = 200) {
  handlers[`${method} ${path}`] = () => ({ status, body });
}

function setNetworkFailure(method: string, path: string) {
  handlers[`${method} ${path}`] = () => "network-error";
}

beforeEach(() => {
  handlers = {};
  setHandler("GET", "/pulls/pr1/reviews", []);
  setHandler("GET", "/pulls/pr1/brief", { brief: null, current_head_sha: "sha1", outdated: false, job: null });
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const method = init?.method ?? "GET";
    const h = handlers[`${method} ${u.pathname}`];
    if (!h) return { ok: false, status: 404, statusText: "", json: async () => ({}) } as Response;
    const outcome = h();
    if (outcome === "network-error") throw new TypeError("Failed to fetch");
    const { status, body } = outcome;
    return { ok: status < 400, status, statusText: "", json: async () => body } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderBanner() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ brief: briefMessages, prReview: prReviewMessages }}>
        <BriefBanner prId="pr1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("BriefBanner — each generate error branch shows its own copy (F20)", () => {
  it("the three branch strings in messages/en/brief.json are pairwise distinct", () => {
    // Guards all three tests below: if any two of these collapsed to the same
    // string in the JSON, every branch-specific `toBe` would still pass for
    // the wrong reason (one generic message satisfying every case).
    const { noChangedFiles, rateLimited, generateFailed } = briefMessages.banner;
    expect(noChangedFiles).not.toBe(rateLimited);
    expect(noChangedFiles).not.toBe(generateFailed);
    expect(rateLimited).not.toBe(generateFailed);
  });

  it("AC-64: a 409 no_changed_files generate failure shows exactly banner.noChangedFiles", async () => {
    renderBanner();
    await screen.findByText("No brief yet");

    setHandler("POST", "/pulls/pr1/brief/generate", { error: { code: "no_changed_files", message: "This PR has no changed files." } }, 409);
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    // If this branch ever returned banner.rateLimited or banner.generateFailed
    // instead, this exact-match assertion is the one that fails (the previous
    // frozen oracle's non-empty + no-raw-code checks would still pass).
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe(briefMessages.banner.noChangedFiles));
  });

  it("AC-43/AC-45: a 429 rate-limit generate failure shows exactly banner.rateLimited", async () => {
    renderBanner();
    await screen.findByText("No brief yet");

    setHandler("POST", "/pulls/pr1/brief/generate", { error: { code: "rate_limited", message: "Too many requests." } }, 429);
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    // If this branch ever returned banner.noChangedFiles or
    // banner.generateFailed instead, this exact-match assertion fails.
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe(briefMessages.banner.rateLimited));
  });

  it("a plain network failure on generate shows exactly banner.generateFailed", async () => {
    renderBanner();
    await screen.findByText("No brief yet");

    setNetworkFailure("POST", "/pulls/pr1/brief/generate");
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    // If this branch ever returned banner.noChangedFiles or banner.rateLimited
    // instead, this exact-match assertion fails.
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe(briefMessages.banner.generateFailed));
  });
});
