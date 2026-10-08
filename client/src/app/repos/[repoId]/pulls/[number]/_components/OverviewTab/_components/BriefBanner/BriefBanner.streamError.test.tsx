/* BriefBanner.streamError.test.tsx — fix-list F19 (round 3), spec AC-33/AC-43/AC-44 +
   plan constraint C-strings / NFR-11 ("User-facing strings live in
   messages/<locale>/*.json"). This oracle is RED today: `useBriefJob`'s native
   `onerror` handler hard-codes an English literal in
   `client/src/lib/hooks/brief.ts:70` (`STREAM_ERROR_MESSAGE`) and
   `BriefBanner.tsx:46` renders it verbatim via
   `t("banner.failed", { message: job.failed.message })` — so the banner never
   actually reads `banner.streamError` from messages/en/brief.json, even though
   that key exists (it is currently dead, per `32-fix-list-r3.md` F19).

   Per the fix-list's "Hint for the implementer contract": the hook should carry
   only a stable `code: "stream_error"`, and `BriefBanner` should map that code to
   `t("banner.streamError")` itself — this file asserts exactly that observable
   result, not the internal shape. `fetch` and `EventSource` are mocked — never
   the hook. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import briefMessages from "../../../../../../../../../../messages/en/brief.json";
import prReviewMessages from "../../../../../../../../../../messages/en/prReview.json";
import { BriefBanner } from "./BriefBanner";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onerror: ((ev: Event) => void) | null = null;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener() {}
  removeEventListener() {}
  close() {}
  triggerError() {
    this.onerror?.(new Event("error"));
  }
}

type Handler = () => { status: number; body: unknown };
let handlers: Record<string, Handler>;
let fetchMock: ReturnType<typeof vi.fn>;

function setHandler(method: string, path: string, body: unknown, status = 200) {
  handlers[`${method} ${path}`] = () => ({ status, body });
}

beforeEach(() => {
  handlers = {};
  setHandler("GET", "/pulls/pr1/reviews", []);
  setHandler("GET", "/pulls/pr1/brief", {
    brief: null,
    current_head_sha: "sha1",
    outdated: false,
    job: { id: "job1", phase: "assembling" },
  });
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const method = init?.method ?? "GET";
    const h = handlers[`${method} ${u.pathname}`];
    if (!h) return { ok: false, status: 404, statusText: "", json: async () => ({}) } as Response;
    const { status, body } = h();
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

describe("BriefBanner — stream error copy comes from messages, not the hook (F19)", () => {
  it("AC-33/AC-43: a native stream drop (no done/failed event) shows exactly messages/en/brief.json banner.streamError, never the raw code", async () => {
    renderBanner();
    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
    const es = FakeEventSource.instances.at(-1)!;

    es.triggerError();

    const status = await screen.findByRole("status");
    await waitFor(() => expect(status.textContent).toBe(briefMessages.banner.streamError));
    expect(status.textContent).not.toMatch(/stream_error/);
  });
});
