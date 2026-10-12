/* BriefBanner.forceBody.test.tsx — fix-list F17 (round 2), spec AC-44
   ("the generate request, with `force` for Regenerate") + AC-66 (Retry).
   The frozen BriefBanner.test.tsx's T7 "AC-44" test is titled as if it
   covers Regenerate's `force: true` body too, but only ever clicks
   Generate and asserts body `{}` (`BriefBanner.test.tsx:193-209`) — the
   Regenerate claim in its title was never backed by an assertion (retro
   `pr-brief.retro.md` it.2 #6). This file is a NEW, additional oracle; it
   does not touch BriefBanner.test.tsx.

   `fetch` and the global `EventSource` are mocked — never the hooks. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrBrief } from "@devdigest/shared";
import briefMessages from "../../../../../../../../../../messages/en/brief.json";
import prReviewMessages from "../../../../../../../../../../messages/en/prReview.json";
import { BriefBanner } from "./BriefBanner";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners: Record<string, Array<(ev: MessageEvent) => void>> = {};
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: (ev: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  removeEventListener() {}
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    for (const cb of this.listeners[type] ?? []) cb({ data: JSON.stringify(data) } as MessageEvent);
  }
}

const BRIEF: PrBrief = {
  pr_id: "pr1",
  head_sha: "sha1",
  summary: "Adds a token-bucket rate limiter in front of every public route.",
  risks: [],
  review_focus: [],
  missing_inputs: [],
  model: "deepseek/deepseek-v4-flash",
  provider: "openrouter",
  generated_at: "2026-10-01T12:00:00Z",
  stats: { tokens_in: 8200, tokens_out: 1300, cost_usd: 0.014, attempts: 1, duration_ms: 100 },
};

type Handler = () => { status: number; body: unknown };
let handlers: Record<string, Handler>;
let fetchMock: ReturnType<typeof vi.fn>;

function setHandler(method: string, path: string, body: unknown, status = 200) {
  handlers[`${method} ${path}`] = () => ({ status, body });
}

function postBodyFor(path: string) {
  const call = fetchMock.mock.calls.find(
    (c: unknown[]) => new URL(c[0] as string).pathname === path && (c[1] as RequestInit | undefined)?.method === "POST",
  );
  if (!call) return undefined;
  const body = (call[1] as RequestInit).body;
  return body == null ? {} : JSON.parse(String(body));
}

beforeEach(() => {
  handlers = {};
  setHandler("GET", "/pulls/pr1/reviews", []);
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

describe("BriefBanner — generate request body by action (F17)", () => {
  it("AC-44: clicking Regenerate with a stored brief POSTs body {force: true}", async () => {
    setHandler("GET", "/pulls/pr1/brief", { brief: BRIEF, current_head_sha: "sha1", outdated: false, job: null });
    renderBanner();
    await screen.findByText(BRIEF.summary);

    setHandler("POST", "/pulls/pr1/brief/generate", { job_id: "job1", reused: false }, 202);
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));

    await waitFor(() => expect(postBodyFor("/pulls/pr1/brief/generate")).toEqual({ force: true }));
  });

  it("AC-66: Retry after a failed job POSTs body {force: true} when a stored brief exists", async () => {
    setHandler("GET", "/pulls/pr1/brief", {
      brief: BRIEF,
      current_head_sha: "sha1",
      outdated: false,
      job: { id: "job1", phase: "calling_model" },
    });
    renderBanner();
    await screen.findByText(BRIEF.summary);
    await waitFor(() => expect(FakeEventSource.instances.some((e) => e.url.includes("/jobs/job1/events"))).toBe(true));

    const es = FakeEventSource.instances.find((e) => e.url.includes("/jobs/job1/events"))!;
    es.emit("failed", { type: "failed", code: "model_failed", message: "The model request failed." });
    await screen.findByRole("button", { name: "Retry" });

    setHandler("POST", "/pulls/pr1/brief/generate", { job_id: "job2", reused: false }, 202);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(postBodyFor("/pulls/pr1/brief/generate")).toEqual({ force: true }));
  });

  it("AC-66: Retry after a failed job POSTs no truthy force when no brief exists ({} or {force:false})", async () => {
    setHandler("GET", "/pulls/pr1/brief", {
      brief: null,
      current_head_sha: "sha1",
      outdated: false,
      job: { id: "job1", phase: "calling_model" },
    });
    renderBanner();
    await screen.findByText("No brief yet");
    await waitFor(() => expect(FakeEventSource.instances.some((e) => e.url.includes("/jobs/job1/events"))).toBe(true));

    const es = FakeEventSource.instances.find((e) => e.url.includes("/jobs/job1/events"))!;
    es.emit("failed", { type: "failed", code: "model_failed", message: "The model request failed." });
    await screen.findByRole("button", { name: "Retry" });

    setHandler("POST", "/pulls/pr1/brief/generate", { job_id: "job2", reused: false }, 202);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      const body = postBodyFor("/pulls/pr1/brief/generate");
      expect(body?.force ?? false).toBe(false);
    });
  });
});
