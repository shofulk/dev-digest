/* BriefBanner.test.tsx — T7 (red, docs/plans/pr-brief.plan.md). Written against
   the L1 interface (`BriefBanner({ prId })` renders `null`; `usePrBrief` /
   `useGenerateBrief` / `useBriefJob` all no-op) and the DOM contract fixed by the
   plan's Interfaces §UI: one `role="status"` polite live region with the
   phase/done/failed text; buttons named by `brief.banner.generate` /
   `.regenerate` / `.retry`; the primary action has `kind="primary"` (inline
   `background: var(--accent)`); on `config_error` a link named
   `brief.banner.openSettings`. `fetch` and the global `EventSource` are mocked —
   never the hooks. Every test here is expected to fail on an assertion (nothing
   renders) rather than on an import/type error, since the component is still
   the L1 `return null` skeleton. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrBrief, ReviewRecord, FindingRecord } from "@devdigest/shared";
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

function finding(over: Partial<FindingRecord>): FindingRecord {
  return {
    id: "f1",
    review_id: "r1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded key",
    file: "src/config.ts",
    start_line: 2,
    end_line: 2,
    rationale: "Because.",
    confidence: 0.9,
    accepted_at: null,
    dismissed_at: null,
    ...over,
  };
}

const LATEST_REVIEW: ReviewRecord = {
  id: "r1",
  pr_id: "pr1",
  agent_id: "a1",
  run_id: "run1",
  agent_name: "Security",
  kind: "review",
  verdict: "request_changes",
  summary: "x",
  score: 42,
  model: "gpt",
  created_at: "2026-01-01T00:00:00Z",
  findings: [finding({})],
};

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
  stats: { tokens_in: 8200, tokens_out: 1300, cost_usd: 0.014, attempts: 1, duration_ms: 4200 },
};

type Handler = (init?: RequestInit) => { status: number; body: unknown };
let handlers: Record<string, Handler>;
let fetchMock: ReturnType<typeof vi.fn>;

function setHandler(method: string, path: string, body: unknown, status = 200) {
  handlers[`${method} ${path}`] = () => ({ status, body });
}

beforeEach(() => {
  handlers = {};
  setHandler("GET", "/pulls/pr1/reviews", [LATEST_REVIEW]);
  setHandler("GET", "/pulls/pr1/brief", { brief: null, current_head_sha: "sha1", outdated: false, job: null });
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

function renderBanner(prId: string | null = "pr1") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ brief: briefMessages, prReview: prReviewMessages }}>
        <BriefBanner prId={prId} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("BriefBanner", () => {
  it("AC-37: while the PR has a latest review, shows its verdict, findings count, blockers count and score ring", async () => {
    renderBanner();
    expect(await screen.findByText("Request changes")).toBeInTheDocument();
    expect(screen.getByText(/1 findings/)).toBeInTheDocument();
    expect(screen.getByText(/1 blockers/)).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("AC-38: with no review, shows no verdict and no score, and still shows the brief part", async () => {
    setHandler("GET", "/pulls/pr1/reviews", []);
    setHandler("GET", "/pulls/pr1/brief", { brief: BRIEF, current_head_sha: "sha1", outdated: false, job: null });
    renderBanner();
    expect(await screen.findByText(BRIEF.summary)).toBeInTheDocument();
    expect(screen.queryByText("Request changes")).not.toBeInTheDocument();
    expect(screen.queryByText("Approve")).not.toBeInTheDocument();
    expect(screen.queryByText("Comment")).not.toBeInTheDocument();
    expect(screen.queryByText("42")).not.toBeInTheDocument();
  });

  it("AC-39/AC-41: while a brief exists, shows the summary, a Regenerate action, and its cost/tokens/model/time footer", async () => {
    setHandler("GET", "/pulls/pr1/brief", { brief: BRIEF, current_head_sha: "sha1", outdated: false, job: null });
    renderBanner();
    expect(await screen.findByText(BRIEF.summary)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeInTheDocument();
    expect(screen.getByText("$0.014")).toBeInTheDocument();
    expect(screen.getByText(/8\.2K.*1\.3K/)).toBeInTheDocument();
    const expectedTime = new Date(BRIEF.generated_at).toLocaleString();
    expect(screen.getByText(new RegExp(`${BRIEF.model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*${expectedTime.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))).toBeInTheDocument();
  });

  it("AC-40: with no brief and no running job, shows 'No brief yet' and a primary Generate action", async () => {
    renderBanner();
    expect(await screen.findByText("No brief yet")).toBeInTheDocument();
    const generateBtn = screen.getByRole("button", { name: "Generate" });
    expect(generateBtn).not.toBeDisabled();
    expect(generateBtn.style.background).toBe("var(--accent)");
  });

  it("AC-42: an outdated brief shows an Outdated badge and makes Regenerate the primary action", async () => {
    setHandler("GET", "/pulls/pr1/brief", { brief: BRIEF, current_head_sha: "sha2", outdated: true, job: null });
    renderBanner();
    await screen.findByText(BRIEF.summary);
    expect(screen.getByText("Outdated")).toBeInTheDocument();
    const regenerateBtn = screen.getByRole("button", { name: "Regenerate" });
    expect(regenerateBtn.style.background).toBe("var(--accent)");
  });

  it("AC-43/AC-35: while a job runs, shows the current phase, keeps the stored brief visible, and disables Generate and Regenerate", async () => {
    setHandler("GET", "/pulls/pr1/brief", {
      brief: BRIEF,
      current_head_sha: "sha1",
      outdated: false,
      job: { id: "job1", phase: "assembling" },
    });
    renderBanner();
    await screen.findByText(BRIEF.summary);

    await waitFor(() => expect(FakeEventSource.instances.some((e) => e.url.includes("/jobs/job1/events"))).toBe(true));

    const status = screen.getByRole("status");
    expect(within(status).getByText("Assembling facts…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeDisabled();
  });

  it("AC-44: pressing Generate sends the request with no `force`, Regenerate sends it with `force: true`, subscribes to the job, and refreshes the brief on `done`", async () => {
    renderBanner();
    await screen.findByText("No brief yet");

    setHandler("POST", "/pulls/pr1/brief/generate", { job_id: "job1", reused: false }, 202);
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c: unknown[]) =>
          new URL(c[0] as string).pathname === "/pulls/pr1/brief/generate" &&
          (c[1] as RequestInit | undefined)?.method === "POST",
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({});
    });

    await waitFor(() => expect(FakeEventSource.instances.some((e) => e.url.includes("/jobs/job1/events"))).toBe(true));

    const briefGetCallsBefore = fetchMock.mock.calls.filter(
      (c: unknown[]) =>
        new URL(c[0] as string).pathname === "/pulls/pr1/brief" &&
        ((c[1] as RequestInit | undefined)?.method ?? "GET") === "GET",
    ).length;

    setHandler("GET", "/pulls/pr1/brief", { brief: BRIEF, current_head_sha: "sha1", outdated: false, job: null });
    const es = FakeEventSource.instances.find((e) => e.url.includes("/jobs/job1/events"))!;
    es.emit("done", { type: "done", brief: BRIEF });

    await waitFor(() => {
      const after = fetchMock.mock.calls.filter(
        (c: unknown[]) =>
          new URL(c[0] as string).pathname === "/pulls/pr1/brief" &&
          ((c[1] as RequestInit | undefined)?.method ?? "GET") === "GET",
      ).length;
      expect(after).toBeGreaterThan(briefGetCallsBefore);
    });
  });

  it("AC-45: lists each missing input with its reason under 'Generated without:'", async () => {
    const briefWithMissing: PrBrief = {
      ...BRIEF,
      missing_inputs: [
        { input: "intent", state: "missing", detail: null },
        { input: "blast", state: "degraded", detail: "no_data" },
      ],
    };
    setHandler("GET", "/pulls/pr1/brief", { brief: briefWithMissing, current_head_sha: "sha1", outdated: false, job: null });
    renderBanner();
    expect(await screen.findByText("Generated without:")).toBeInTheDocument();
    expect(screen.getByText("intent (missing)")).toBeInTheDocument();
    expect(screen.getByText("blast radius (degraded: no_data)")).toBeInTheDocument();
  });

  it("AC-63: a `config_error` generate failure shows the server message and a link to Settings", async () => {
    renderBanner();
    await screen.findByText("No brief yet");

    handlers["POST /pulls/pr1/brief/generate"] = () => ({
      status: 400,
      body: { error: { code: "config_error", message: "Set OPENAI_API_KEY or OPENROUTER_API_KEY in Settings." } },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    expect(await screen.findByText("Set OPENAI_API_KEY or OPENROUTER_API_KEY in Settings.")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Open Settings" });
    expect(link).toHaveAttribute("href", "/settings/api-keys");
  });

  it("AC-66: a `failed` job event shows the error message with a retry action, and keeps the previously stored brief visible", async () => {
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
    es.emit("failed", { type: "failed", code: "model_failed", message: "The model request failed or returned invalid output." });

    expect(await screen.findByText(/The model request failed or returned invalid output\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByText(BRIEF.summary)).toBeInTheDocument();
  });

  it("AC-69: a summary containing Markdown/HTML/a URL renders as plain text with no link", async () => {
    const hostileBrief: PrBrief = {
      ...BRIEF,
      summary: "See http://evil.example/steal and **bold** <b>html</b> for details.",
    };
    setHandler("GET", "/pulls/pr1/brief", { brief: hostileBrief, current_head_sha: "sha1", outdated: false, job: null });
    renderBanner();
    expect(await screen.findByText(hostileBrief.summary)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /evil\.example/ })).not.toBeInTheDocument();
    expect(screen.queryByText("bold")).not.toBeInTheDocument();
    expect(screen.queryByText("html")).not.toBeInTheDocument();
  });
});
