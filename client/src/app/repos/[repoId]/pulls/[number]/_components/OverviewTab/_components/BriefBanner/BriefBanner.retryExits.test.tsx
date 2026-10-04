/* BriefBanner.retryExits.test.tsx — fix-list F24 (round 5), spec
   AC-33/AC-43/AC-44/AC-64. Retro decision
   (.harness/runs/pr-brief/47-retro-r5.md, Feed-forward) binds this oracle's
   shape: one test per exit of the failed state, each starting from a
   fixture WITH A STORED BRIEF, each asserting (1) Retry presence,
   (2) its enabled/disabled state, and (3) the generate POST body;
   status copy where defined.

   Exits covered (fix-list F24, .harness/runs/pr-brief/46-fix-list-r5.md):
     (c) Retry → a NEW job id → done → Retry absent.
     (d) Retry → a new job → `failed` again → Retry present AND enabled,
         failure copy shown for the NEW failure.
     (e) Retry → a generate HTTP error (one test for 429, one for a network
         drop) → Retry present and enabled, no crash. Per the fix list and
         retro, the earlier-failure status-copy precedence
         (BriefBanner.tsx:71-84, plan-verifier r4 "Handed off", accepted open
         minor) is NOT asserted here — only Retry's presence/enabled state
         and that the POST was actually sent.
     (f) stored brief + failure → click REGENERATE (not Retry) → POST
         {force:true} → a new job → done → Retry absent.

   All six exits (this file's five plus F23's own file) start from the same
   fixture shape: a stored brief at the current head plus a running job J
   ("job1") that the first EventSource subscribes to and which is then
   driven into the failed state by a native stream drop
   (`EventSource.onerror`) — matching the convention in the frozen
   `BriefBanner.retrySameJob.test.tsx` and the new
   `BriefBanner.retrySameJobWithBrief.test.tsx` (F23). Harness (FakeEventSource,
   fetch stub, NextIntlClientProvider + QueryClientProvider) copied from
   those files; no frozen test is edited; `user-event` is not installed in
   this package, so `fireEvent` is used per the existing convention. */
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

function regeneratedBrief(summary: string) {
  return { ...STORED_BRIEF, summary, generated_at: "2026-10-04T12:20:00Z" };
}

type GenerateHandler = (init?: RequestInit) => Response | Promise<Response>;

let fetchMock: ReturnType<typeof vi.fn>;
let briefGetCalls: number;

function stubFetch(generateHandler: GenerateHandler) {
  briefGetCalls = 0;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const method = init?.method ?? "GET";
    if (method === "GET" && u.pathname === "/pulls/pr1/reviews") {
      return { ok: true, status: 200, statusText: "", json: async () => [] } as Response;
    }
    if (method === "GET" && u.pathname === "/pulls/pr1/brief") {
      // Fixture WITH a stored brief at the current head AND a running job J
      // ("job1") — the retro-decision shape, shared by every exit in this file.
      // Counted (`briefGetCalls`) so a test can wait for the real refetch a
      // `done`/`failed` SSE event triggers via `invalidateQueries`
      // (brief.ts) — the actual async signal that the state update has
      // flushed, rather than a synchronous `queryByRole` check that a bare
      // `waitFor` would evaluate once before that flush ever happens.
      briefGetCalls += 1;
      return {
        ok: true,
        status: 200,
        statusText: "",
        json: async () => ({
          brief: STORED_BRIEF,
          current_head_sha: "sha1",
          outdated: false,
          job: { id: "job1", phase: "assembling" },
        }),
      } as Response;
    }
    if (method === "POST" && u.pathname === "/pulls/pr1/brief/generate") {
      return generateHandler(init);
    }
    return { ok: false, status: 404, statusText: "", json: async () => ({}) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
}

function accepted(jobId: string, reused = false): Response {
  return { ok: true, status: 202, statusText: "", json: async () => ({ job_id: jobId, reused }) } as Response;
}

beforeEach(() => {
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

/** Drives the shared "first job (job1) hits a native stream drop" entry
 *  point every exit in this file starts from, and returns the first
 *  EventSource plus the enabled Retry button. */
async function enterFailedState() {
  renderBanner();
  await waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
  const first = FakeEventSource.instances[0]!;
  expect(first.url).toContain("/pulls/pr1/brief/jobs/job1/events");

  first.triggerError();
  const status = await screen.findByRole("status");
  await waitFor(() => expect(status.textContent).toBe(briefMessages.banner.streamError));
  const retryBtn = await screen.findByRole("button", { name: briefMessages.banner.retry });
  expect(retryBtn).not.toBeDisabled();
  return { first, retryBtn };
}

describe("BriefBanner — exit (c): Retry gets a NEW job id, which reaches done (F24)", () => {
  it("AC-33/AC-43: Retry sends {force:true}; the new job's done clears Retry", async () => {
    stubFetch(() => accepted("jobC"));
    const { first, retryBtn } = await enterFailedState();

    fireEvent.click(retryBtn);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/pulls/pr1/brief/generate"),
        expect.objectContaining({ method: "POST", body: JSON.stringify({ force: true }) }),
      ),
    );

    await waitFor(() => expect(FakeEventSource.instances.length).toBe(2));
    const second = FakeEventSource.instances[1]!;
    expect(second.url).toContain("/pulls/pr1/brief/jobs/jobC/events");
    expect(second).not.toBe(first);

    const briefGetCallsBeforeDone = briefGetCalls;
    second.emit("done", { type: "done", brief: regeneratedBrief("Brief from the new job C.") });

    // Settle on the real refetch `done` triggers (via `invalidateQueries`)
    // first — a bare `waitFor` on `queryByRole(...)` runs its FIRST check
    // synchronously, before that flush, and would trivially satisfy a
    // flipped `not.toBeNull()` negative control without the fix ever running.
    await waitFor(() => expect(briefGetCalls).toBeGreaterThan(briefGetCallsBeforeDone));
    await waitFor(() => expect(screen.queryByRole("button", { name: briefMessages.banner.retry })).toBeNull());
  });
});

describe("BriefBanner — exit (d): Retry's new job fails again (F24)", () => {
  it("AC-43: Retry stays visible AND enabled, showing the NEW failure's copy", async () => {
    stubFetch(() => accepted("jobD"));
    const { retryBtn } = await enterFailedState();

    fireEvent.click(retryBtn);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/pulls/pr1/brief/generate"),
        expect.objectContaining({ method: "POST", body: JSON.stringify({ force: true }) }),
      ),
    );

    await waitFor(() => expect(FakeEventSource.instances.length).toBe(2));
    const second = FakeEventSource.instances[1]!;
    expect(second.url).toContain("/pulls/pr1/brief/jobs/jobD/events");

    second.emit("failed", { type: "failed", code: "model_failed", message: "The model timed out again." });

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        briefMessages.banner.failed.replace("{message}", "The model timed out again."),
      ),
    );
    const retryAgain = await screen.findByRole("button", { name: briefMessages.banner.retry });
    expect(retryAgain).not.toBeDisabled();
  });
});

describe("BriefBanner — exit (e): Retry's generate call itself errors over HTTP (F24)", () => {
  it("AC-64: a 429 from /brief/generate leaves Retry visible and enabled; the POST is sent", async () => {
    stubFetch(() => ({ ok: false, status: 429, statusText: "Too Many Requests", json: async () => ({}) }) as Response);
    const { retryBtn } = await enterFailedState();

    fireEvent.click(retryBtn);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/pulls/pr1/brief/generate"),
        expect.objectContaining({ method: "POST", body: JSON.stringify({ force: true }) }),
      ),
    );

    // Earlier-failure status-copy precedence is an accepted open minor
    // (plan-verifier r4 "Handed off", fix-list F24) — not asserted here.
    // Only presence/enabled state and that the POST actually went out.
    await waitFor(() => expect(screen.getByRole("button", { name: briefMessages.banner.retry })).not.toBeDisabled());
  });

  it("AC-64: a network drop on /brief/generate leaves Retry visible and enabled, with no crash", async () => {
    stubFetch(() => {
      throw new Error("network down");
    });
    const { retryBtn } = await enterFailedState();

    fireEvent.click(retryBtn);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/pulls/pr1/brief/generate"),
        expect.objectContaining({ method: "POST", body: JSON.stringify({ force: true }) }),
      ),
    );

    await waitFor(() => expect(screen.getByRole("button", { name: briefMessages.banner.retry })).not.toBeDisabled());
  });
});

describe("BriefBanner — exit (f): Regenerate (not Retry) after a failure, with a stored brief (F24)", () => {
  it("AC-43/AC-44: Regenerate sends {force:true}; the new job's done clears Retry", async () => {
    stubFetch(() => accepted("jobF"));
    await enterFailedState();

    // A stored brief exists, so BOTH "Regenerate" and "Retry" render
    // (BriefBanner.tsx:182-195) — this exit clicks Regenerate.
    const regenerateBtn = await screen.findByRole("button", { name: briefMessages.banner.regenerate });
    expect(regenerateBtn).not.toBeDisabled();

    fireEvent.click(regenerateBtn);
    // `onRegenerate` always sends {force:true} (BriefBanner.tsx:89),
    // unconditionally — unlike Retry's `{force: !!brief}`.
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/pulls/pr1/brief/generate"),
        expect.objectContaining({ method: "POST", body: JSON.stringify({ force: true }) }),
      ),
    );

    await waitFor(() => expect(FakeEventSource.instances.length).toBe(2));
    const second = FakeEventSource.instances[1]!;
    expect(second.url).toContain("/pulls/pr1/brief/jobs/jobF/events");

    const briefGetCallsBeforeDone = briefGetCalls;
    second.emit("done", { type: "done", brief: regeneratedBrief("Brief from Regenerate's new job F.") });

    // Settle on the real refetch first — see the comment on the equivalent
    // step in exit (c), above.
    await waitFor(() => expect(briefGetCalls).toBeGreaterThan(briefGetCallsBeforeDone));
    await waitFor(() => expect(screen.queryByRole("button", { name: briefMessages.banner.retry })).toBeNull());
  });
});
