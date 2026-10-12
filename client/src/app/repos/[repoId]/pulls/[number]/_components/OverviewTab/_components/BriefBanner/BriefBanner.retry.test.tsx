/* BriefBanner.retry.test.tsx — fix F11 (plan-verifier handed off, AC-43): the
   Retry action (shown on a failed job, AC-66) must disable while a
   generation is running, same as Generate/Regenerate. Not the frozen
   BriefBanner.test.tsx — that file already covers Retry's appearance on a
   `failed` event (AC-66) and must not be touched; this file adds only the
   disabled-while-generating assertion. */
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

let handlers: Record<string, (init?: RequestInit) => { status: number; body: unknown }>;
let fetchMock: ReturnType<typeof vi.fn>;
let resolveGeneratePost: ((r: Response) => void) | null;

function setHandler(method: string, path: string, body: unknown, status = 200) {
  handlers[`${method} ${path}`] = () => ({ status, body });
}

beforeEach(() => {
  handlers = {};
  resolveGeneratePost = null;
  setHandler("GET", "/pulls/pr1/reviews", []);
  setHandler("GET", "/pulls/pr1/brief", {
    brief: BRIEF,
    current_head_sha: "sha1",
    outdated: false,
    job: { id: "job1", phase: "calling_model" },
  });
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const method = init?.method ?? "GET";
    if (method === "POST" && u.pathname === "/pulls/pr1/brief/generate") {
      // held open so generateBrief.isPending stays true until the test resolves it
      return new Promise<Response>((resolve) => {
        resolveGeneratePost = (r) => resolve(r);
      });
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

describe("BriefBanner — Retry disabled while generating (F11)", () => {
  it("AC-43: disables Retry once a new generation starts, same as Generate/Regenerate", async () => {
    renderBanner();
    await waitFor(() => expect(FakeEventSource.instances.some((e) => e.url.includes("/jobs/job1/events"))).toBe(true));

    const es = FakeEventSource.instances.find((e) => e.url.includes("/jobs/job1/events"))!;
    es.emit("failed", { type: "failed", code: "model_failed", message: "The model request failed or returned invalid output." });

    const retryBtn = await screen.findByRole("button", { name: "Retry" });
    expect(retryBtn).not.toBeDisabled();

    fireEvent.click(retryBtn);

    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeDisabled());

    // release the held-open POST so the test doesn't leak a pending fetch
    resolveGeneratePost?.({
      ok: true,
      status: 202,
      statusText: "",
      json: async () => ({ job_id: "job2", reused: false }),
    } as Response);
  });
});
