/* RiskAreas.test.tsx — T8 (red, docs/plans/pr-brief.plan.md). Written against
   the L1 interface (`RiskAreas({ prId, onOpenFile })` renders `null`) and the
   DOM contract fixed by the plan's Interfaces §UI: `aria-busy="true"` while
   loading; a severity icon `role="img"` with `aria-label = brief.risks.severity.<sev>`
   coloured `SEV.CRITICAL/WARNING/SUGGESTION.c` for high/medium/low; file refs
   are `<button>`s with text `path:s-e` or `path`; the expand toggle is a
   `<button aria-expanded aria-label={brief.risks.toggle({title})}>`. The
   component has no intent-shaped prop at all (AC-46: state comes only from the
   brief). `fetch` is mocked — never the hook. Every test is expected to fail on
   an assertion (nothing renders) rather than on an import/type error, since the
   component is still the L1 `return null` skeleton. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrBrief, Risk } from "@devdigest/shared";
import briefMessages from "../../../../../../../../../../messages/en/brief.json";
import { RiskAreas } from "./RiskAreas";

function risk(over: Partial<Risk>): Risk {
  return {
    kind: "config_secrets",
    title: "Secret key committed in config",
    explanation: "src/config.ts carries a live key; it must move to the environment.",
    severity: "high",
    file_refs: ["src/config.ts"],
    ...over,
  };
}

function brief(over: Partial<PrBrief>): PrBrief {
  return {
    pr_id: "pr1",
    head_sha: "sha1",
    summary: "x",
    risks: [],
    review_focus: [],
    missing_inputs: [],
    model: "deepseek/deepseek-v4-flash",
    provider: "openrouter",
    generated_at: "2026-10-01T12:00:00Z",
    stats: { tokens_in: 100, tokens_out: 50, cost_usd: 0.001, attempts: 1, duration_ms: 100 },
    ...over,
  };
}

type Resp = { status: number; body: unknown } | "pending";
let reply: Resp;
let fetchCalls: number;
let fetchMock: ReturnType<typeof vi.fn>;
let pendingResolvers: Array<(r: Response) => void>;

beforeEach(() => {
  reply = { status: 200, body: { brief: null, current_head_sha: "sha1", outdated: false, job: null } };
  fetchCalls = 0;
  pendingResolvers = [];
  fetchMock = vi.fn((url: string) => {
    void url;
    fetchCalls += 1;
    if (reply === "pending") {
      return new Promise<Response>((resolve) => pendingResolvers.push(resolve));
    }
    const r = reply;
    return Promise.resolve({ ok: r.status < 400, status: r.status, statusText: "", json: async () => r.body } as Response);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderAreas(onOpenFile?: (path: string, line: number | null) => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
        <RiskAreas prId="pr1" onOpenFile={onOpenFile} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("RiskAreas", () => {
  it("AC-48: shows a loading placeholder with aria-busy while the brief read is pending", () => {
    reply = "pending";
    renderAreas();
    const section = screen.getByText("Risk areas").closest("[aria-busy]");
    expect(section).toHaveAttribute("aria-busy", "true");
  });

  it("AC-49: shows an error line with a retry action when the brief read failed, and retry re-issues the request", async () => {
    reply = { status: 500, body: {} };
    renderAreas();
    expect(await screen.findByText("Couldn't load risk areas.")).toBeInTheDocument();
    const before = fetchCalls;
    reply = { status: 200, body: { brief: null, current_head_sha: "sha1", outdated: false, job: null } };
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(fetchCalls).toBeGreaterThan(before));
  });

  it("AC-50: shows the hint to generate the brief when no brief exists", async () => {
    renderAreas();
    expect(await screen.findByText("Generate the brief to see risk areas")).toBeInTheDocument();
  });

  it("AC-54: shows 'No specific risks identified' when the brief has zero risks", async () => {
    reply = { status: 200, body: { brief: brief({ risks: [] }), current_head_sha: "sha1", outdated: false, job: null } };
    renderAreas();
    expect(await screen.findByText("No specific risks identified")).toBeInTheDocument();
  });

  it("AC-46/51/52: shows the stored risks with an Outdated badge, severity icon+colour, title and file refs as path:s-e or path", async () => {
    const theBrief = brief({
      risks: [
        risk({ severity: "high", title: "Secret key committed in config", file_refs: ["src/config.ts:10-12"] }),
        risk({
          kind: "performance",
          severity: "medium",
          title: "Limiter runs on every public request",
          file_refs: ["src/middleware/ratelimit.ts"],
        }),
        risk({ kind: "test_coverage", severity: "low", title: "No test for the new limiter path", file_refs: ["src/middleware/ratelimit.ts:1-5"] }),
      ],
    });
    reply = { status: 200, body: { brief: theBrief, current_head_sha: "sha2", outdated: true, job: null } };
    renderAreas();

    expect(await screen.findByText("Outdated")).toBeInTheDocument();
    expect(screen.getByText("Secret key committed in config")).toBeInTheDocument();
    expect(screen.getByText("Limiter runs on every public request")).toBeInTheDocument();
    expect(screen.getByText("No test for the new limiter path")).toBeInTheDocument();

    const highIcon = screen.getByLabelText("High severity");
    expect(highIcon).toHaveAttribute("role", "img");
    expect(highIcon.style.color).toBe("var(--crit)");
    expect(screen.getByLabelText("Medium severity").style.color).toBe("var(--warn)");
    expect(screen.getByLabelText("Low severity").style.color).toBe("var(--sugg)");

    expect(screen.getByRole("button", { name: "src/config.ts:10-12" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "src/middleware/ratelimit.ts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "src/middleware/ratelimit.ts:1-5" })).toBeInTheDocument();
  });

  it("AC-53: toggling a risk's expand control shows and hides its explanation", async () => {
    const theBrief = brief({ risks: [risk({ title: "Secret key committed in config" })] });
    reply = { status: 200, body: { brief: theBrief, current_head_sha: "sha1", outdated: false, job: null } };
    renderAreas();
    await screen.findByText("Secret key committed in config");

    const toggle = screen.getByRole("button", { name: "Details for Secret key committed in config" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(theBrief.risks[0]!.explanation)).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(theBrief.risks[0]!.explanation)).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(theBrief.risks[0]!.explanation)).not.toBeInTheDocument();
  });

  it("AC-57: activating a risk's file reference opens the Files changed tab at that file and line", async () => {
    const onOpenFile = vi.fn();
    const theBrief = brief({
      risks: [
        risk({ file_refs: ["src/config.ts:10-12"] }),
        risk({ title: "No range", file_refs: ["src/middleware/ratelimit.ts"] }),
      ],
    });
    reply = { status: 200, body: { brief: theBrief, current_head_sha: "sha1", outdated: false, job: null } };
    renderAreas(onOpenFile);
    await screen.findByText("Secret key committed in config");

    fireEvent.click(screen.getByRole("button", { name: "src/config.ts:10-12" }));
    expect(onOpenFile).toHaveBeenCalledWith("src/config.ts", 10);

    fireEvent.click(screen.getByRole("button", { name: "src/middleware/ratelimit.ts" }));
    expect(onOpenFile).toHaveBeenCalledWith("src/middleware/ratelimit.ts", null);
  });

  it("AC-69: a risk title/explanation containing Markdown/HTML/a URL renders as plain text with no link", async () => {
    const hostile = risk({
      title: "See http://evil.example and **bold** <b>html</b>",
      explanation: "Click http://evil.example/steal for `details` and <i>italics</i>.",
    });
    const theBrief = brief({ risks: [hostile] });
    reply = { status: 200, body: { brief: theBrief, current_head_sha: "sha1", outdated: false, job: null } };
    renderAreas();

    expect(await screen.findByText(hostile.title)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: `Details for ${hostile.title}` }));
    expect(screen.getByText(hostile.explanation)).toBeInTheDocument();
    expect(screen.queryByText("details")).not.toBeInTheDocument();
    expect(screen.queryByText("italics")).not.toBeInTheDocument();
  });
});
