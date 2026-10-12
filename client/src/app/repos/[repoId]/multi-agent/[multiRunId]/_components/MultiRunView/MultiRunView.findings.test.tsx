import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within, act } from "@testing-library/react";
import type { AgentColumn, RunTrace } from "@devdigest/shared";
import {
  ResultsTestProviders,
  colFinding,
  column,
  installEventSource,
  installFetch,
  multiRun,
  review,
  type Reply,
} from "@/test/multi-agent-results-intl";

/* SPEC-05 / SPEC-06, fix round 3, C15 (T40): the findings of a tab (and of the trace drawer)
   come from the PR's reviews. While those load, or fail, the tab must not claim the agent has
   no findings. The Skeleton primitive carries no role, so rows are found by its `.skeleton` class. */

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), query: "view=tabs" }));
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
  RepoProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { MultiRunView } from "./MultiRunView";

/* ---- harness ---- */

const EMPTY = "This agent has no findings to show.";
const FINDINGS_ERROR = "Could not load the findings of this agent.";
const TRACE_EMPTY = "No findings for this run.";
const REVIEWS = "/pulls/pr1/reviews";

const TRACE: RunTrace = {
  config: { agent: "Security", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
  stats: { duration_ms: 8200, tokens_in: 12000, tokens_out: 1500, cost_usd: 0.06, findings: 2, grounding: "2/2 passed" },
  prompt_assembly: { system: "You are a reviewer.", skills: "### skill", memory: null, specs: null, user: "Review PR #482" },
  tool_calls: [],
  raw_output: "{}",
  memory_pulled: [],
  specs_read: [],
  log: [],
};

const twoFindings = (): AgentColumn =>
  column({
    agent_id: "a1",
    agent_name: "Security",
    findings: [colFinding({ id: "f1", title: "SQL injection" }), colFinding({ id: "f2", title: "Weak hash" })],
  });

function serve(columns: AgentColumn[], reviews: Reply | (() => Reply | Promise<Reply>)) {
  const state = { columns };
  const fetcher = installFetch({
    "GET /multi-agent-runs/mr1": () => ({ status: 200, body: multiRun({ columns: state.columns }) }),
    "GET /pulls/pr1": { status: 200, body: { id: "pr1", number: 482, title: "Harden auth" } },
    [`GET ${REVIEWS}`]: reviews,
    "GET /runs/run-a1/trace": { status: 200, body: TRACE },
  });
  const reviewGets = () => fetcher.calls().filter((c) => c.method === "GET" && c.path === REVIEWS).length;
  return { ...fetcher, state, reviewGets };
}

const held = (): Promise<Reply> => new Promise<Reply>(() => {});

function renderView() {
  render(
    <ResultsTestProviders>
      <MultiRunView />
    </ResultsTestProviders>,
  );
}

const skeletons = (el: HTMLElement) => el.querySelectorAll(".skeleton").length;

beforeEach(() => {
  nav.query = "view=tabs";
  installEventSource();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Tabs view findings load state", () => {
  it("C15 / AC-56: while the PR's reviews are pending the tab shows skeleton rows, never the empty text", async () => {
    serve([twoFindings()], held);
    renderView();

    const panel = await screen.findByRole("tabpanel");
    expect(within(panel).getByText("Security", { selector: "div" })).toBeInTheDocument();
    expect(skeletons(panel)).toBeGreaterThan(0);
    expect(within(panel).queryByText(EMPTY)).not.toBeInTheDocument();
  });

  it("C15 / AC-56: when the reviews GET answers 500 the tab says the findings could not load, offers Retry that re-sends the GET, and never shows the empty text", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { reviewGets } = serve([twoFindings()], { status: 500, body: { error: { message: "db down" } } });
    renderView();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });

    const panel = await screen.findByRole("tabpanel");
    expect(await within(panel).findByText(FINDINGS_ERROR)).toBeInTheDocument();
    expect(within(panel).queryByText(EMPTY)).not.toBeInTheDocument();

    const before = reviewGets();
    fireEvent.click(within(panel).getByRole("button", { name: "Retry" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    await waitFor(() => expect(reviewGets()).toBeGreaterThan(before));
  });

  it("C15 / AC-56: guard, a done column with no findings and loaded reviews shows the empty text", async () => {
    serve([column({ agent_id: "a1", agent_name: "Security", findings: [] })], { status: 200, body: [review("a1", [])] });
    renderView();

    const panel = await screen.findByRole("tabpanel");
    expect(await within(panel).findByText(EMPTY)).toBeInTheDocument();
    expect(skeletons(panel)).toBe(0);
  });

  it("C15 / AC-51: a refetch that turns a running column done sends a new GET of the PR's reviews", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"], shouldAdvanceTime: true });
    const { state, reviewGets } = serve(
      [column({ agent_id: "a1", agent_name: "Security", status: "running", score: null, duration_ms: null, cost_usd: null })],
      { status: 200, body: [] },
    );
    renderView();

    await screen.findByRole("tabpanel");
    await waitFor(() => expect(reviewGets()).toBe(1));

    state.columns = [twoFindings()];
    await act(async () => {
      vi.advanceTimersByTime(3500);
    });

    await waitFor(() => expect(within(screen.getByRole("tabpanel")).queryByText("Running")).not.toBeInTheDocument());
    await waitFor(() => expect(reviewGets()).toBeGreaterThan(1));
  });

  it("C15 / AC-55: View trace on a done column while the reviews are pending shows no 'No findings' text in the drawer", async () => {
    serve([twoFindings()], held);
    renderView();

    fireEvent.click(within(await screen.findByRole("tabpanel")).getByRole("button", { name: "View trace" }));

    expect(await screen.findByText("Agent run · Security")).toBeInTheDocument();
    // the persisted trace has rendered, so its Findings section is on screen
    expect(await screen.findByText("2/2 passed")).toBeInTheDocument();
    expect(screen.queryByText(TRACE_EMPTY)).not.toBeInTheDocument();
  });
});
