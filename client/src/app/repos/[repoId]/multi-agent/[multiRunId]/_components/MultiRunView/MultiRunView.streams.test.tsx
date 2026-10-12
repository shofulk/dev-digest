import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within, act } from "@testing-library/react";
import type { AgentColumn } from "@devdigest/shared";
import {
  ResultsTestProviders,
  column,
  installEventSource,
  installFetch,
  multiRun,
  review,
  type FakeEventSource,
} from "@/test/multi-agent-results-intl";

/* SPEC-05 / SPEC-06, fix round 3, C14 (T39): the results page serves every running column
   from ONE shared stream, GET /multi-agent-runs/:id/events?run_ids=. Streams are counted as
   the non-closed FakeEventSource instances, read by path and run_ids query. */

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
  RepoProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { MultiRunView } from "./MultiRunView";

/* ---- harness ---- */

let es: typeof FakeEventSource;

const RUNNING = { status: "running", score: null, duration_ms: null, cost_usd: null } as const;
const eight = (): AgentColumn[] =>
  Array.from({ length: 8 }, (_, i) => column({ agent_id: `a${i + 1}`, agent_name: `Agent a${i + 1}`, ...RUNNING }));
const RUN_IDS = eight().map((c) => c.run_id);

function serve(columns: AgentColumn[]) {
  const state = { columns };
  const fetcher = installFetch({
    "GET /multi-agent-runs/mr1": () => ({ status: 200, body: multiRun({ columns: state.columns }) }),
    "GET /pulls/pr1": { status: 200, body: { id: "pr1", number: 482, title: "Harden auth" } },
    "GET /pulls/pr1/reviews": { status: 200, body: [review("a1", []), review("a2", [])] },
    "GET /runs/run-a2/trace": { status: 404, body: { error: { message: "no trace" } } },
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

const open = () => es.instances.filter((s) => !s.closed);
const pathOf = (s: FakeEventSource) => new URL(s.url).pathname;
const idsOf = (s: FakeEventSource) => (new URL(s.url).searchParams.get("run_ids") ?? "").split(",").sort();

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

describe("results page live-log streams", () => {
  it("C14 / AC-50: Columns view with 8 running columns holds exactly one shared stream listing all 8 run ids", async () => {
    serve(eight());
    renderView();
    await screen.findByRole("region", { name: "Agent a8" });

    await waitFor(() => expect(open()).toHaveLength(1));
    const [source] = open();
    expect(pathOf(source!)).toBe("/multi-agent-runs/mr1/events");
    expect(idsOf(source!)).toEqual(RUN_IDS);
  });

  it("C14 / AC-50: an event tagged with a run id shows in that agent's column only", async () => {
    serve(eight());
    renderView();
    await screen.findByRole("region", { name: "Agent a3" });
    await waitFor(() => expect(open()).toHaveLength(1));

    act(() => open()[0]!.emit({ runId: "run-a3", kind: "info", msg: "step three" }));

    expect(await within(screen.getByRole("region", { name: "Agent a3" })).findByText("step three")).toBeInTheDocument();
    expect(screen.getAllByText("step three")).toHaveLength(1);
    expect(within(screen.getByRole("region", { name: "Agent a4" })).queryByText("step three")).not.toBeInTheDocument();
  });

  it("C14 / AC-55: View trace on a running column keeps the page at no more than 2 open streams", async () => {
    serve(eight());
    renderView();
    fireEvent.click(within(await screen.findByRole("region", { name: "Agent a2" })).getByRole("button", { name: "View trace" }));

    expect(await screen.findByText("Agent run · Agent a2")).toBeInTheDocument();
    // the drawer's own stream is open, so the count below is not taken before it mounted
    await waitFor(() => expect(open().some((s) => pathOf(s) === "/runs/run-a2/events")).toBe(true));
    expect(open().length).toBeLessThanOrEqual(2);
    expect(open().some((s) => pathOf(s) === "/multi-agent-runs/mr1/events")).toBe(true);
  });

  it("C14 / AC-50: Tabs view with 8 running columns holds exactly one shared stream, and the selected tab shows its events", async () => {
    nav.query = "view=tabs";
    serve(eight());
    renderView();
    await screen.findByRole("tabpanel");

    await waitFor(() => expect(open()).toHaveLength(1));
    const [source] = open();
    expect(pathOf(source!)).toBe("/multi-agent-runs/mr1/events");
    expect(idsOf(source!)).toEqual(RUN_IDS);

    act(() => source!.emit({ runId: "run-a1", kind: "info", msg: "step one" }));
    expect(await within(screen.getByRole("tabpanel")).findByText("step one")).toBeInTheDocument();
  });

  it("C14 / AC-51: when a refetch turns one column done, the open stream lists the 7 still-running ids and the earlier one is closed", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"], shouldAdvanceTime: true });
    const { state } = serve(eight());
    renderView();
    await screen.findByRole("region", { name: "Agent a4" });
    await waitFor(() => expect(open()).toHaveLength(1));
    const first = open()[0]!;
    expect(idsOf(first)).toEqual(RUN_IDS);

    state.columns = eight().map((c) => (c.agent_id === "a4" ? column({ agent_id: "a4", agent_name: "Agent a4" }) : c));
    await act(async () => {
      vi.advanceTimersByTime(3500);
    });

    await waitFor(() => expect(first.closed).toBe(true));
    await waitFor(() => expect(open()).toHaveLength(1));
    const [next] = open();
    expect(next).not.toBe(first);
    expect(pathOf(next!)).toBe("/multi-agent-runs/mr1/events");
    expect(idsOf(next!)).toEqual(RUN_IDS.filter((id) => id !== "run-a4"));
  });
});
