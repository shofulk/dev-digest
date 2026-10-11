import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within, act } from "@testing-library/react";
import type { AgentColumn } from "@devdigest/shared";
import { agentLook } from "@/lib/agent-look";
import {
  ResultsTestProviders,
  colFinding,
  column,
  installEventSource,
  installFetch,
  multiRun,
  review,
  type FakeEventSource,
  type Route,
} from "@/test/multi-agent-results-intl";

/* The Columns mode is exercised through the results page, which owns the data hooks
   (polling, retry, cancel) the column actions depend on. */

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), query: "" }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1", multiRunId: "mr1" }),
  usePathname: () => "/repos/r1/multi-agent/mr1",
  useSearchParams: () => new URLSearchParams(nav.query),
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    activeRepo: { id: "r1", full_name: "acme/api", default_branch: "main" },
    repos: [],
    repoId: "r1",
    setRepoId: () => {},
    reposLoaded: true,
  }),
  useRepoNotFound: () => false,
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { MultiRunView } from "../../MultiRunView";

/* ---- harness ---- */

let es: typeof FakeEventSource;

function serve(columns: AgentColumn[], extra: Record<string, Route> = {}) {
  const state = { columns };
  const fetcher = installFetch({
    "GET /multi-agent-runs/mr1": () => ({ status: 200, body: multiRun({ columns: state.columns }) }),
    "GET /pulls/pr1": { status: 200, body: { id: "pr1", number: 482, title: "Harden auth" } },
    "GET /pulls/pr1/reviews": { status: 200, body: [review("a1", []), review("a2", [])] },
    ...extra,
  });
  return { ...fetcher, state };
}

function renderView() {
  render(
    <ResultsTestProviders>
      <MultiRunView />
    </ResultsTestProviders>,
  );
}

const card = (name: string) => screen.findByRole("region", { name });

beforeEach(() => {
  nav.query = "";
  es = installEventSource();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Columns view content", () => {
  it("AC-49 / AC-71: each column shows the agent, score, time, cost and its findings; an unknown cost is a dash", async () => {
    serve([
      column({
        agent_id: "a1",
        agent_name: "Security",
        score: 72,
        duration_ms: 12000,
        cost_usd: 0.0123,
        findings: [
          colFinding({ id: "f1", title: "SQL injection", file: "src/db.ts", start_line: 42 }),
          colFinding({ id: "f2", title: "Weak hash", file: "src/auth.ts", start_line: 7 }),
        ],
      }),
      column({ agent_id: "a2", agent_name: "Style", score: 95, cost_usd: null, findings: [] }),
    ]);
    renderView();

    const sec = within(await card("Security"));
    expect(sec.getByText("72")).toBeInTheDocument();
    expect(sec.getByText("12s · $0.012")).toBeInTheDocument();
    expect(sec.getByText("SQL injection")).toBeInTheDocument();
    expect(sec.getByText("src/db.ts:42")).toBeInTheDocument();
    expect(sec.getByText("Weak hash")).toBeInTheDocument();
    expect(sec.getByText("src/auth.ts:7")).toBeInTheDocument();
    expect(sec.getByText("2 findings")).toBeInTheDocument();

    const style = within(await card("Style"));
    expect(style.getByText("95")).toBeInTheDocument();
    expect(style.getByText("12s · —")).toBeInTheDocument();
    expect(style.getByText("No findings")).toBeInTheDocument();
    expect(style.getByText("0 findings")).toBeInTheDocument();
  });
});

describe("Columns view accent, severity and score ring", () => {
  it("AC-49: a column carries its agent's accent, each finding names its severity and the score is a ring", async () => {
    serve([
      column({
        agent_id: "a1",
        agent_name: "Security",
        score: 72,
        findings: [
          colFinding({ id: "f1", title: "SQL injection", severity: "CRITICAL" }),
          colFinding({ id: "f2", title: "Weak hash", severity: "WARNING" }),
          colFinding({ id: "f3", title: "Rename this", severity: "SUGGESTION" }),
        ],
      }),
      column({ agent_id: "a2", agent_name: "Style", score: 95, findings: [] }),
    ]);
    renderView();

    const region = await card("Security");
    // the accent from agentLook, per agent id: Security and Style differ
    expect(region).toHaveStyle({ borderTopColor: agentLook("a1").accent });
    expect(await card("Style")).toHaveStyle({ borderTopColor: agentLook("a2").accent });
    expect(agentLook("a1").accent).not.toBe(agentLook("a2").accent);

    // severity is named for assistive tech, one per finding, matched to its finding
    const sec = within(region);
    const sev = (name: string, title: string) =>
      expect(
        within(sec.getByText(title).closest("[data-finding-id]") as HTMLElement).getByRole("img", { name }),
      ).toBeInTheDocument();
    sev("Critical", "SQL injection");
    sev("Warning", "Weak hash");
    sev("Suggestion", "Rename this");

    // the score is a ring (svg arc) beside the number, coloured by band (72 -> warn)
    const ring = sec.getByText("72").parentElement!.querySelector("svg circle[stroke='var(--warn)']");
    expect(ring).not.toBeNull();
    expect(within(await card("Style")).getByText("95").parentElement!.querySelector("svg circle[stroke='var(--ok)']")).not.toBeNull();
  });
});

describe("Columns view finding titles", () => {
  it("C10 / AC-67: a finding title renders through Markdown and never injects raw HTML", async () => {
    serve([
      column({
        agent_id: "a1",
        agent_name: "Security",
        findings: [colFinding({ id: "f1", title: "Unsafe `eval` of **input** <img src=x onerror=alert(1)>" })],
      }),
    ]);
    renderView();

    const sec = within(await card("Security"));
    expect(sec.getByText("eval").tagName).toBe("CODE");
    expect(sec.getByText("input").tagName).toBe("STRONG");
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("Columns view running agent", () => {
  it("AC-50: a running column shows its status and the live log lines streamed for that run", async () => {
    serve([column({ agent_id: "a1" }), column({ agent_id: "a2", status: "running", score: null, duration_ms: null })]);
    renderView();

    const running = within(await card("Agent a2"));
    // the status badge (the live log shows its own "Running" marker too)
    expect(running.getAllByText("Running").length).toBeGreaterThan(0);

    await waitFor(() => expect(es.instances.map((i) => i.url)).toContain("http://localhost:3001/runs/run-a2/events"));
    // only the running agent streams
    expect(es.instances.map((i) => i.url)).not.toContain("http://localhost:3001/runs/run-a1/events");

    const source = es.instances.find((i) => i.url.endsWith("/runs/run-a2/events"))!;
    act(() => source.emit({ t: "00.40", kind: "info", msg: "Reading the diff of src/db.ts" }));
    expect(await running.findByText("Reading the diff of src/db.ts")).toBeInTheDocument();
  });

  it("AC-51: when a refetch turns the running column done it re-renders in place, without a reload", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"], shouldAdvanceTime: true });
    const { state } = serve([
      column({ agent_id: "a1" }),
      column({ agent_id: "a2", status: "running", score: null, duration_ms: null, cost_usd: null }),
    ]);
    renderView();

    const running = within(await card("Agent a2"));
    expect(running.getAllByText("Running").length).toBeGreaterThan(0);
    expect(running.queryByText("93")).not.toBeInTheDocument();

    state.columns = [
      column({ agent_id: "a1" }),
      column({
        agent_id: "a2",
        status: "done",
        score: 93,
        findings: [colFinding({ id: "f9", title: "Late finding" })],
      }),
    ];
    await act(async () => {
      vi.advanceTimersByTime(3500);
    });

    const done = within(await card("Agent a2"));
    expect(await done.findByText("93")).toBeInTheDocument();
    expect(done.getByText("Late finding")).toBeInTheDocument();
    expect(done.queryByText("Running")).not.toBeInTheDocument();
  });
});

describe("Columns view failed and cancelled agents", () => {
  it("AC-52: a failed column shows its error and View trace, and Retry posts the retry for that agent", async () => {
    const { calls } = serve(
      [column({ agent_id: "a1" }), column({ agent_id: "a2", status: "failed", score: null, error: "Provider timed out" })],
      { "POST /multi-agent-runs/mr1/agents/a2/retry": { status: 200, body: { run_id: "run-new" } } },
    );
    renderView();

    const failed = within(await card("Agent a2"));
    expect(failed.getByText("Failed")).toBeInTheDocument();
    expect(failed.getByText("Provider timed out")).toBeInTheDocument();
    expect(failed.getByRole("button", { name: "View trace" })).toBeInTheDocument();

    fireEvent.click(failed.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(calls().filter((c) => c.method === "POST").map((c) => c.path)).toEqual([
        "/multi-agent-runs/mr1/agents/a2/retry",
      ]),
    );
    // the healthy column offers no Retry
    expect(within(await card("Agent a1")).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("AC-53: a cancelled column shows its status and a Retry button", async () => {
    serve([column({ agent_id: "a1" }), column({ agent_id: "a2", status: "cancelled", score: null })]);
    renderView();

    const cancelled = within(await card("Agent a2"));
    expect(cancelled.getByText("Cancelled")).toBeInTheDocument();
    expect(cancelled.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("Columns view cancel", () => {
  it("AC-54: while an agent runs there is a Cancel all and a per-column Cancel; each posts its own cancel", async () => {
    const { calls } = serve(
      [column({ agent_id: "a1" }), column({ agent_id: "a2", status: "running", score: null })],
      {
        "POST /multi-agent-runs/mr1/cancel": { status: 200, body: { ok: true, run_ids: ["run-a2"] } },
        "POST /runs/run-a2/cancel": { status: 200, body: { ok: true } },
      },
    );
    renderView();

    const running = within(await card("Agent a2"));
    expect(screen.getByRole("button", { name: "Cancel all" })).toBeInTheDocument();
    // done column has no Cancel; the running one does
    expect(within(await card("Agent a1")).queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();

    fireEvent.click(running.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(calls().some((c) => c.method === "POST" && c.path === "/runs/run-a2/cancel")).toBe(true));
    expect(calls().some((c) => c.path === "/multi-agent-runs/mr1/cancel")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Cancel all" }));
    await waitFor(() => expect(calls().some((c) => c.method === "POST" && c.path === "/multi-agent-runs/mr1/cancel")).toBe(true));
  });

  it("AC-54: once nothing is running, neither Cancel all nor Cancel is offered", async () => {
    serve([column({ agent_id: "a1" }), column({ agent_id: "a2", status: "failed", score: null, error: "x" })]);
    renderView();
    await card("Agent a1");
    expect(screen.queryByRole("button", { name: "Cancel all" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });
});

describe("Columns view trace", () => {
  it("AC-55: View trace opens the trace drawer for that column's run", async () => {
    const { calls } = serve(
      [column({ agent_id: "a1" }), column({ agent_id: "a2", status: "failed", score: null, error: "boom" })],
      { "GET /runs/run-a2/trace": { status: 404, body: { error: { message: "no trace" } } } },
    );
    renderView();

    fireEvent.click(within(await card("Agent a2")).getByRole("button", { name: "View trace" }));

    expect(await screen.findByText("Agent run · Agent a2")).toBeInTheDocument();
    await waitFor(() => expect(calls().map((c) => c.path)).toContain("/runs/run-a2/trace"));
    expect(calls().map((c) => c.path)).not.toContain("/runs/run-a1/trace");
  });
});
