import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  HistoryTestProviders,
  installHistoryFetch,
  runSummary,
  type Reply,
  type Route,
} from "@/test/multi-agent-history-intl";
import type { PrDetail } from "@/lib/types";

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1" }),
  usePathname: () => "/repos/r1/pulls/7",
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { PrDetailHeader } from "../../PrDetailHeader";

const LIST = "GET /repos/r1/multi-agent-runs";
const LINK_NAME = "Open multi-agent review";
let routes: Record<string, Route>;

const PR = {
  id: "pr7",
  number: 7,
  title: "Add cache",
  author: "dev",
  branch: "feat",
  base: "main",
  additions: 1,
  deletions: 1,
  files_count: 1,
  status: "open",
} as unknown as PrDetail;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  routes = {
    "GET /agents": { status: 200, body: [] },
    "GET /run-estimates": { status: 200, body: [] },
    [LIST]: { status: 200, body: [] },
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

function setup() {
  const net = installHistoryFetch(routes);
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const view = render(
    <HistoryTestProviders>
      <PrDetailHeader
        pr={PR}
        prId="pr7"
        repoId="r1"
        tab="overview"
        findingsCount={0}
        severityCounts={{ CRITICAL: 0, WARNING: 0, SUGGESTION: 0, NITPICK: 0 } as never}
        activeSeverity={null}
        githubUrl="https://github.com/acme/api/pull/7"
        onSetTab={vi.fn()}
        onSelectSeverity={vi.fn()}
        onRunStart={vi.fn()}
        onRunsStarted={vi.fn()}
      />
    </HistoryTestProviders>,
  );
  return { net, user, view };
}

const link = () => screen.queryByRole("link", { name: LINK_NAME });

describe("OpenMultiRunLink in PrDetailHeader", () => {
  it("AC-98: with several multi-runs, the link points to the first (newest) item's results page and asks for this PR only", async () => {
    routes[LIST] = { status: 200, body: [runSummary({ id: "m-new" }), runSummary({ id: "m-old" })] };
    const { net } = setup();

    const a = await screen.findByRole("link", { name: LINK_NAME });
    expect(a).toHaveAttribute("href", "/repos/r1/multi-agent/m-new");
    expect(net.paths()).toContain(`${LIST}?pr_id=pr7`);
  });

  it("AC-99: with an empty list there is no link, no error text and no toast", async () => {
    const { net } = setup();
    await advance(200);
    expect(net.paths().some((p) => p.startsWith(LIST))).toBe(true);
    expect(link()).toBeNull();
    expect(screen.queryByText(/recent runs|multi-agent runs/i)).toBeNull();
    expect(within(screen.getByRole("status")).queryByText(/./)).toBeNull();
  });

  it("AC-99: while the request is pending there is no link, no error text and no toast", async () => {
    routes[LIST] = () => new Promise<Reply>(() => {});
    const { net } = setup();
    await advance(500);
    expect(net.paths().some((p) => p.startsWith(LIST))).toBe(true);
    expect(link()).toBeNull();
    expect(screen.queryByText(/could not|error/i)).toBeNull();
    expect(within(screen.getByRole("status")).queryByText(/./)).toBeNull();
  });

  it("AC-99: on a 500 there is no link, no error text and no toast", async () => {
    routes[LIST] = { status: 500, body: { error: { message: "Boom 500" } } };
    const { net } = setup();
    // the read retries twice (1s, 2s backoff) before it gives up
    await advance(3500);
    expect(net.paths().filter((p) => p.startsWith(LIST)).length).toBeGreaterThan(1);
    expect(link()).toBeNull();
    expect(screen.queryByText("Boom 500")).toBeNull();
    expect(screen.queryByText(/could not|error/i)).toBeNull();
    expect(within(screen.getByRole("status")).queryByText(/./)).toBeNull();
  });

  it("H-NFR-5: Tab reaches the link, and Enter on it activates it", async () => {
    routes[LIST] = { status: 200, body: [runSummary({ id: "m-new" })] };
    const { user } = setup();
    const a = await screen.findByRole("link", { name: LINK_NAME });

    // jsdom has no router: swallow the anchor's default navigation, observe the click
    const clicked = vi.fn((e: Event) => e.preventDefault());
    a.addEventListener("click", clicked);
    for (let i = 0; i < 30 && document.activeElement !== a; i++) await user.tab();
    expect(a).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(clicked).toHaveBeenCalledTimes(1);
  });
});
