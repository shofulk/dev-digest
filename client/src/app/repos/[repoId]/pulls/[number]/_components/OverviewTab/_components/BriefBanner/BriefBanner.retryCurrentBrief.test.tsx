/* BriefBanner.retryCurrentBrief.test.tsx — round-4 follow-up oracle (F22b),
   after mode, written BEFORE the fix for the exit F22's `canRetry` left open.

   Defect under test: `canRetry` (BriefBanner.tsx:50-52) turns true on
   `job.failed` and only clears on `job.done`. When a stream drop/`failed`
   event leaves no stored brief and the user clicks Retry, the server may
   answer with `GenerateBriefCurrent` (`{brief}` — no `job_id`,
   server/src/vendor/shared/contracts/review-api.ts:109-116): the mutation's
   `onSuccess` (client/src/lib/hooks/brief.ts:60-69) writes the brief into the
   query with `job: null`, so `jobId` becomes `null` and `useBriefJob`'s
   `done` never turns `true` for that case — `canRetry` stays `true` forever,
   leaving a live Retry button next to a fresh brief. Clicking it would send
   `{force: true}}`, a paid regeneration nobody asked for.

   Boundary and harness copied from the frozen `BriefBanner.retrySameJob.test.tsx`
   (fetch + EventSource stubbed, banner driven through its real rendered DOM,
   never the hook directly). This file is new; it does not edit any frozen
   test. Must fail today on the "no Retry button" assertion (step 4 in Scenario A
   has caused the production canRetry bug) — the underlying brief render/clear
   assertions should already pass. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import briefMessages from "../../../../../../../../../../messages/en/brief.json";
import prReviewMessages from "../../../../../../../../../../messages/en/prReview.json";
import { BriefBanner } from "./BriefBanner";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onerror: ((ev: Event) => void) | null = null;
  listeners: Record<string, Array<(ev: MessageEvent) => void>> = {};
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: (ev: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  removeEventListener(type: string, cb: (ev: MessageEvent) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((c) => c !== cb);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    for (const cb of this.listeners[type] ?? []) cb({ data: JSON.stringify(data) } as MessageEvent);
  }
  triggerError() {
    this.onerror?.(new Event("error"));
  }
}

const CURRENT_BRIEF = {
  pr_id: "pr1",
  head_sha: "sha1",
  summary: "Nothing new since the last brief.",
  risks: [],
  review_focus: [],
  missing_inputs: [],
  model: "deepseek/deepseek-v4-flash",
  provider: "openrouter",
  generated_at: "2026-10-04T12:05:00Z",
  stats: { tokens_in: 10, tokens_out: 5, cost_usd: 0, attempts: 1, duration_ms: 1 },
};

let handlers: Record<string, (init?: RequestInit) => { status: number; body: unknown }>;
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
  // Retry/Generate always resolves with the "no generation needed, here is
  // the already-current brief" shape — `GenerateBriefCurrent` (`{brief}`,
  // no `job_id`) — never `GenerateBriefAccepted`.
  setHandler("POST", "/pulls/pr1/brief/generate", { brief: CURRENT_BRIEF }, 200);
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const method = init?.method ?? "GET";
    const h = handlers[`${method} ${u.pathname}`];
    if (!h) return { ok: false, status: 404, statusText: "", json: async () => ({}) } as Response;
    const { status, body } = h(init);
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

describe("BriefBanner — Retry resolves with the already-current brief (F22b)", () => {
  it("AC-43/AC-44: after a native stream error, Retry→current-brief renders the brief and drops the Retry button", async () => {
    renderBanner();

    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
    const es = FakeEventSource.instances[0]!;

    // 1. native error → streamError copy shown, Retry visible.
    es.triggerError();
    const status = await screen.findByRole("status");
    await waitFor(() => expect(status.textContent).toBe(briefMessages.banner.streamError));
    const retryBtn = await screen.findByRole("button", { name: briefMessages.banner.retry });
    expect(retryBtn).not.toBeDisabled();

    // 2. click Retry; the server answers with the current brief (no new job).
    fireEvent.click(retryBtn);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/pulls/pr1/brief/generate"),
        expect.objectContaining({ method: "POST" }),
      ),
    );

    // 3. the fresh brief's summary renders.
    await screen.findByText(CURRENT_BRIEF.summary);

    // 4. the stream-error status is gone...
    await waitFor(() => expect(screen.getByRole("status").textContent).not.toBe(briefMessages.banner.streamError));
    // ...and no Retry button remains next to the now-fresh brief (a fix that
    // only clears `canRetry` on `job.done` leaves this button behind forever,
    // since `jobId` is now null and `job.done` can never become true again).
    expect(screen.queryByRole("button", { name: briefMessages.banner.retry })).toBeNull();
  });

  it("AC-43/AC-44: after a server `failed` event, Retry→current-brief renders the brief and drops the Retry button", async () => {
    renderBanner();

    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
    const es = FakeEventSource.instances[0]!;

    // 1. server-reported failure (e.g. model_failed) → translated copy shown,
    // Retry visible.
    es.emit("failed", { type: "failed", code: "model_failed", message: "The model timed out." });
    const status = await screen.findByRole("status");
    await waitFor(() =>
      expect(status.textContent).toBe(
        briefMessages.banner.failed.replace("{message}", "The model timed out."),
      ),
    );
    const retryBtn = await screen.findByRole("button", { name: briefMessages.banner.retry });
    expect(retryBtn).not.toBeDisabled();

    // 2. click Retry; the server answers with the current brief (no new job).
    fireEvent.click(retryBtn);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/pulls/pr1/brief/generate"),
        expect.objectContaining({ method: "POST" }),
      ),
    );

    // 3. the fresh brief's summary renders.
    await screen.findByText(CURRENT_BRIEF.summary);

    // 4. no Retry button remains next to the now-fresh brief.
    expect(screen.queryByRole("button", { name: briefMessages.banner.retry })).toBeNull();
  });
});
