/* BriefBanner.retrySameJob.test.tsx — fix-list F22 (round 4), spec AC-33/AC-43/AC-44.
   Retro decision (.harness/runs/pr-brief/39-retro-r4.md, Feed-forward) binds this
   oracle's shape: drive the real user path through BriefBanner, not the hook
   directly, with `fetch` + `EventSource` stubbed at the boundary.

   Defect under test: after a native `EventSource.onerror` (`useBriefJob` sets
   `failed: {code: "stream_error"}`), the user clicks Retry. The server's
   `generate()` can return the SAME running job id
   (`GenerateBriefAccepted` = `{job_id, reused: true}`,
   server/src/modules/brief/service.ts:108-109) when a generation is already in
   flight for this PR. `BriefBanner`'s `jobId` is keyed only on
   `generateBrief.data.job_id ?? data.job.id` (BriefBanner.tsx:32), and
   `useBriefJob`'s subscribe effect is keyed only on `[prId, jobId, qc]`
   (brief.ts:142) — when the new `job_id` is textually identical to the old one,
   neither the render-time reset nor the effect re-runs, so `failed` never
   clears and no new `EventSource` is ever opened. The brief never appears.

   This file is new (frozen per fix-list rule: existing BriefBanner.*.test.tsx
   files — streamError, retry, errors, errorCopy, forceBody, the base test —
   are never edited). `fetch` and `EventSource` are mocked at the boundary, the
   hook is exercised only through the rendered banner, matching the convention
   in the neighbouring BriefBanner.*.test.tsx files. */
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

let handlers: Record<string, (init?: RequestInit) => { status: number; body: unknown }>;
let fetchMock: ReturnType<typeof vi.fn>;
let briefGetCalls: number;

function setHandler(method: string, path: string, body: unknown, status = 200) {
  handlers[`${method} ${path}`] = () => ({ status, body });
}

beforeEach(() => {
  handlers = {};
  briefGetCalls = 0;
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
    if (method === "GET" && u.pathname === "/pulls/pr1/brief") briefGetCalls += 1;
    // The server returns the SAME running job id on a Retry click while a
    // generation is already in flight for this PR (`reused: true`) —
    // the real shape under test, per GenerateBriefAccepted in
    // server/src/vendor/shared/contracts/review-api.ts:109.
    if (method === "POST" && u.pathname === "/pulls/pr1/brief/generate") {
      return { ok: true, status: 202, statusText: "", json: async () => ({ job_id: "job1", reused: true }) } as Response;
    }
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

describe("BriefBanner — Retry after a stream drop when the server reuses the same job id (F22)", () => {
  it("AC-33/AC-43/AC-44: re-subscribes to a NEW EventSource and leaves the stream-error state, even though job_id is unchanged", async () => {
    renderBanner();

    // 1. first EventSource for /jobs/job1/events opens.
    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
    const first = FakeEventSource.instances[0]!;
    expect(first.url).toContain("/pulls/pr1/brief/jobs/job1/events");

    // 2. native error, no done/failed event → banner shows banner.streamError, Retry enabled.
    first.triggerError();
    const status = await screen.findByRole("status");
    await waitFor(() => expect(status.textContent).toBe(briefMessages.banner.streamError));
    const retryBtn = await screen.findByRole("button", { name: briefMessages.banner.retry });
    expect(retryBtn).not.toBeDisabled();

    // 3. click Retry; generate POST resolves {job_id: "job1", reused: true} — same id as before.
    fireEvent.click(retryBtn);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/pulls/pr1/brief/generate"),
        expect.objectContaining({ method: "POST" }),
      ),
    );

    // 4a. a NEW EventSource instance must be constructed for /jobs/job1/events
    // (count 1 → 2), even though the job id text is identical to the first
    // subscription's. A fix that only clears `failed` without re-subscribing
    // leaves this at 1 forever.
    await waitFor(() => expect(FakeEventSource.instances.length).toBe(2));
    const second = FakeEventSource.instances[1]!;
    expect(second.url).toContain("/pulls/pr1/brief/jobs/job1/events");
    expect(second).not.toBe(first);

    // 4b. the stream-error status text is gone / the banner shows running
    // state (Retry disabled while generating) — a fix that re-subscribes
    // without clearing `failed` would still show banner.streamError and an
    // enabled Retry here.
    await waitFor(() => expect(screen.getByRole("status").textContent).not.toBe(briefMessages.banner.streamError));
    await waitFor(() => expect(screen.getByRole("button", { name: briefMessages.banner.retry })).toBeDisabled());

    // 5. emit `done` on the NEW EventSource → the brief GET is refetched
    // (call count increases) and the banner leaves running.
    const briefGetCallsBeforeDone = briefGetCalls;
    second.emit("done", {
      type: "done",
      brief: {
        pr_id: "pr1",
        head_sha: "sha1",
        summary: "A retried brief.",
        risks: [],
        review_focus: [],
        missing_inputs: [],
        model: "deepseek/deepseek-v4-flash",
        provider: "openrouter",
        generated_at: "2026-10-04T12:00:00Z",
        stats: { tokens_in: 100, tokens_out: 50, cost_usd: 0.001, attempts: 1, duration_ms: 10 },
      },
    });

    await waitFor(() => expect(briefGetCalls).toBeGreaterThan(briefGetCallsBeforeDone));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: briefMessages.banner.retry })?.hasAttribute("disabled")).not.toBe(true),
    );
  });

  it("AC-33/AC-43/AC-44: the Generate button path (no stored brief) shows the same re-subscribe behaviour", async () => {
    renderBanner();

    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
    const first = FakeEventSource.instances[0]!;
    first.triggerError();

    await waitFor(() => expect(screen.getByRole("status").textContent).toBe(briefMessages.banner.streamError));

    // No stored brief → BriefBanner renders "Generate", not "Regenerate"
    // (BriefBanner.tsx: `!brief ? <Button>{t("banner.generate")}</Button> : …`).
    const generateBtn = await screen.findByRole("button", { name: briefMessages.banner.generate });
    expect(generateBtn).not.toBeDisabled();

    fireEvent.click(generateBtn);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/pulls/pr1/brief/generate"),
        expect.objectContaining({ method: "POST" }),
      ),
    );

    await waitFor(() => expect(FakeEventSource.instances.length).toBe(2));
    expect(FakeEventSource.instances[1]).not.toBe(first);
    await waitFor(() => expect(screen.getByRole("status").textContent).not.toBe(briefMessages.banner.streamError));
  });
});
