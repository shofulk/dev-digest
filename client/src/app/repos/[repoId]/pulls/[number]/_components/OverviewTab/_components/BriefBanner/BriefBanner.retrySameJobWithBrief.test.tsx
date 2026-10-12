/* BriefBanner.retrySameJobWithBrief.test.tsx — fix-list F23 (round 5),
   spec AC-33/AC-43/AC-44. Retro decision (.harness/runs/pr-brief/47-retro-r5.md,
   Feed-forward) binds this oracle's shape: one test per exit of the failed
   state, starting from a fixture WITH A STORED BRIEF, asserting Retry
   presence, its enabled/disabled state, and the generate POST body.

   Test gap this closes: `BriefBanner.retrySameJob.test.tsx` (frozen, round 4)
   started from a fixture with NO stored brief (`brief: null`), so its final
   assertion —
     `screen.queryByRole("button", { name: retry })?.hasAttribute("disabled")`
     `.not.toBe(true)`
   — passes whether the Retry button is present-but-enabled OR entirely
   absent from the DOM (`queryByRole` returns `null`, and
   `null?.hasAttribute(...)` is `undefined`, which is also `.not.toBe(true)`).
   It never actually pinned "Retry disappears once a stored brief exists at
   the new head" (plan-verifier r4 F22 partial; fix-list F23). This file
   starts from a fixture with a STORED brief AND a running job `J`
   ("job1") — matching the retro's binding — and asserts absence with
   `queryByRole(...)` returning `null`, not merely "not disabled".

   Harness copied verbatim from the frozen `BriefBanner.retrySameJob.test.tsx`
   (fetch + EventSource stubbed at the boundary, banner driven only through
   its rendered DOM). This file is new; no frozen test is edited.
   `user-event` is not installed in this package — `fireEvent` is used, per
   the existing convention in every neighbouring BriefBanner.*.test.tsx. */
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

const STORED_BRIEF = {
  pr_id: "pr1",
  head_sha: "sha1",
  summary: "The stored brief, already at head.",
  risks: [],
  review_focus: [],
  missing_inputs: [],
  model: "deepseek/deepseek-v4-flash",
  provider: "openrouter",
  generated_at: "2026-10-04T11:00:00Z",
  stats: { tokens_in: 80, tokens_out: 40, cost_usd: 0.0008, attempts: 1, duration_ms: 8 },
};

const REGENERATED_BRIEF = {
  ...STORED_BRIEF,
  summary: "The re-generated brief, after Retry reused job J.",
  generated_at: "2026-10-04T12:10:00Z",
};

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
  // Fixture WITH a stored brief at the current head AND a running job J
  // ("job1") — the retro-decision shape for F23.
  setHandler("GET", "/pulls/pr1/brief", {
    brief: STORED_BRIEF,
    current_head_sha: "sha1",
    outdated: false,
    job: { id: "job1", phase: "assembling" },
  });
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const method = init?.method ?? "GET";
    if (method === "GET" && u.pathname === "/pulls/pr1/brief") briefGetCalls += 1;
    // The server returns the SAME running job id on a Retry click while a
    // generation is already in flight for this PR (`reused: true`,
    // GenerateBriefAccepted, server/src/vendor/shared/contracts/review-api.ts:109).
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

describe("BriefBanner — exit (a): stored brief + running job J, stream drop, Retry reuses J (F23)", () => {
  it("AC-33/AC-43/AC-44: Retry sends {force:true}, the reused job reaches done, and Retry is ABSENT (not merely enabled)", async () => {
    renderBanner();

    // 1. first EventSource for the already-running job J ("job1") opens.
    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
    const first = FakeEventSource.instances[0]!;
    expect(first.url).toContain("/pulls/pr1/brief/jobs/job1/events");

    // 2. native stream drop → banner.streamError, Retry visible and enabled.
    first.triggerError();
    const status = await screen.findByRole("status");
    await waitFor(() => expect(status.textContent).toBe(briefMessages.banner.streamError));
    const retryBtn = await screen.findByRole("button", { name: briefMessages.banner.retry });
    expect(retryBtn).not.toBeDisabled();

    // 3. click Retry. A stored brief exists, so `onRetry` must send
    // {force: true} (BriefBanner.tsx:90, `force: !!brief`) — the exact POST
    // body, not just that a POST happened.
    fireEvent.click(retryBtn);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/pulls/pr1/brief/generate"),
        expect.objectContaining({ method: "POST", body: JSON.stringify({ force: true }) }),
      ),
    );

    // 4. the server reuses job J's id verbatim ({job_id:"job1", reused:true})
    // — a SECOND EventSource must still be constructed (count 1 → 2).
    await waitFor(() => expect(FakeEventSource.instances.length).toBe(2));
    const second = FakeEventSource.instances[1]!;
    expect(second.url).toContain("/pulls/pr1/brief/jobs/job1/events");
    expect(second).not.toBe(first);

    // 5. emit `done` on the second EventSource.
    const briefGetCallsBeforeDone = briefGetCalls;
    second.emit("done", { type: "done", brief: REGENERATED_BRIEF });

    // 6. the brief GET is refetched...
    await waitFor(() => expect(briefGetCalls).toBeGreaterThan(briefGetCallsBeforeDone));
    // ...and the Retry button is gone from the DOM entirely — `queryByRole`
    // returns `null`, not merely "present but not disabled" (the weaker
    // oracle F23 reports against).
    await waitFor(() => expect(screen.queryByRole("button", { name: briefMessages.banner.retry })).toBeNull());
  });
});
