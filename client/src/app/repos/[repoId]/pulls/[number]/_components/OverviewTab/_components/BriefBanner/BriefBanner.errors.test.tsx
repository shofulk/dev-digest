/* BriefBanner.errors.test.tsx — fix-list F14 (round 2), spec AC-64 (server
   409 `no_changed_files`) + AC-43/AC-45 error surfacing generally. The
   frozen BriefBanner.test.tsx (T7) covers only the `config_error` generate
   failure (AC-63) and the `failed` job event (AC-66); today's
   `BriefBanner.tsx` sets `statusText` from nothing else, so a 409
   `no_changed_files`, a 429 rate limit, or a plain network failure on
   generate renders the `role="status"` region EMPTY. This file is a NEW,
   additional oracle; it does not touch BriefBanner.test.tsx.

   Expected copy this fix should add to `messages/en/brief.json` under
   `banner.*` (no key exists there yet for any of these):
     - a `noChangedFiles` string for `no_changed_files`
     - a `rateLimited` string for a 429
     - a generic `generateFailed` string for anything else (network, 5xx, …)
   Until those keys exist, this test only requires that the status region's
   text is non-empty and does not leak the raw error code/HTTP status to the
   user. `fetch` and `EventSource` are mocked — never the hooks. */
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

function assertStatusHasRealCopy(forbidden: RegExp) {
  const status = screen.getByRole("status");
  const text = status.textContent ?? "";
  expect(text.trim().length).toBeGreaterThan(0);
  expect(text).not.toMatch(forbidden);
}

describe("BriefBanner — generate errors beyond config_error (F14)", () => {
  it("AC-64: a 409 no_changed_files generate failure shows a non-empty status message naming no raw code", async () => {
    renderBanner();
    await screen.findByText("No brief yet");

    setHandler("POST", "/pulls/pr1/brief/generate", { error: { code: "no_changed_files", message: "This PR has no changed files." } }, 409);
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => assertStatusHasRealCopy(/no_changed_files/));
  });

  it("AC-43/AC-45: a 429 rate-limit generate failure shows a non-empty status message naming no raw status code", async () => {
    renderBanner();
    await screen.findByText("No brief yet");

    setHandler("POST", "/pulls/pr1/brief/generate", { error: { code: "rate_limited", message: "Too many requests." } }, 429);
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => assertStatusHasRealCopy(/rate_limited|\b429\b/));
  });

  it("a plain network failure on generate shows a non-empty status message naming no raw error code", async () => {
    renderBanner();
    await screen.findByText("No brief yet");

    setNetworkFailure("POST", "/pulls/pr1/brief/generate");
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => assertStatusHasRealCopy(/network_error/));
  });
});
