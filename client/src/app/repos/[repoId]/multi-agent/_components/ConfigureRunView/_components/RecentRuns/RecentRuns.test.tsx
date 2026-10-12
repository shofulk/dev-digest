import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { agent, estimate, pull } from "@/test/multi-agent-intl";
import {
  HistoryTestProviders,
  installHistoryFetch,
  runSummary,
  type Reply,
  type Route,
} from "@/test/multi-agent-history-intl";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1" }),
  usePathname: () => "/repos/r1/multi-agent",
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

/* The framework's router is not mounted in jsdom: a link click is reported as a push. */
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a
      href={href}
      {...rest}
      onClick={(e) => {
        e.preventDefault();
        nav.push(href);
      }}
    >
      {children}
    </a>
  ),
}));

import { ConfigureRunView } from "../../ConfigureRunView";

const LIST = "GET /repos/r1/multi-agent-runs";
let routes: Record<string, Route>;

const REAL_TZ = process.env.TZ;

beforeEach(() => {
  // The hover title is formatted in the viewer's zone (CH5); pin it so "10:00" is stable.
  process.env.TZ = "UTC";
  vi.useFakeTimers({ shouldAdvanceTime: true });
  nav.push.mockClear();
  routes = {
    "GET /repos": { status: 200, body: [{ id: "r1", full_name: "acme/api", default_branch: "main" }] },
    "GET /repos/r1/pulls": { status: 200, body: [pull({ number: 7, title: "Add cache" })] },
    "GET /agents": { status: 200, body: [agent({ id: "a1", name: "Security" })] },
    "GET /run-estimates": { status: 200, body: [estimate("a1", 10_000, 0.05)] },
    "POST /pulls/pr7/multi-agent-run": { status: 200, body: { multi_agent_run_id: "m9", runs: [] } },
    [LIST]: { status: 200, body: [] },
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (REAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = REAL_TZ;
});

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

function setup() {
  const net = installHistoryFetch(routes);
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(
    <HistoryTestProviders>
      <ConfigureRunView />
    </HistoryTestProviders>,
  );
  return { net, user };
}

const rowsOf = () => within(screen.getByRole("list")).getAllByRole("listitem");

describe("RecentRuns", () => {
  it("AC-89: the Recent runs heading comes after the Run button in DOM order, with rows in API order", async () => {
    routes[LIST] = {
      status: 200,
      body: [
        runSummary({ id: "m3", pr_number: 3, pr_title: "Third" }),
        runSummary({ id: "m1", pr_number: 1, pr_title: "First" }),
        runSummary({ id: "m2", pr_number: 2, pr_title: "Second" }),
      ],
    };
    setup();
    const heading = await screen.findByRole("heading", { name: "Recent runs" });
    const run = screen.getByRole("button", { name: /^Run multi-agent review/ });
    expect(run.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await screen.findByText("#3 · Third");
    const names = rowsOf().map((li) => within(li).getByRole("link").textContent ?? "");
    expect(names[0]).toContain("#3 · Third");
    expect(names[1]).toContain("#1 · First");
    expect(names[2]).toContain("#2 · Second");
  });

  it("AC-90: a row shows #n · title, a relative time with the full date on hover, the agent count, status, time and cost", async () => {
    routes[LIST] = { status: 200, body: [runSummary({ id: "m1" })] };
    setup();
    const link = await screen.findByRole("link", { name: /#482 · Harden the auth middleware/ });

    expect(within(link).getByText("#482 · Harden the auth middleware")).toBeInTheDocument();
    const time = link.querySelector("time")!;
    expect(time).toHaveTextContent("5 minutes ago");
    expect(time.getAttribute("title")).toMatch(/Oct 12, 2026/);
    expect(time.getAttribute("title")).toMatch(/10:00/);
    expect(time).toHaveAttribute("datetime", "2026-10-12T10:00:00Z");
    expect(within(link).getByText("4 agents")).toBeInTheDocument();
    expect(within(link).getByText("Done")).toBeInTheDocument();
    expect(within(link).getByText("12s")).toBeInTheDocument();
    expect(within(link).getByText("$0.012")).toBeInTheDocument();
  });

  it("AC-90: each of the four statuses has its own badge label", async () => {
    routes[LIST] = {
      status: 200,
      body: [
        runSummary({ id: "m1", status: "running" }),
        runSummary({ id: "m2", status: "done" }),
        runSummary({ id: "m3", status: "partial" }),
        runSummary({ id: "m4", status: "failed" }),
      ],
    };
    setup();
    await screen.findAllByRole("listitem");
    const labels = ["Running", "Done", "Partial", "Failed"];
    labels.forEach((label, i) => {
      expect(within(rowsOf()[i]!).getByText(label)).toBeInTheDocument();
    });
  });

  it("AC-105: a title with markup renders as literal text, with no img and no strong in the row", async () => {
    const title = "<img src=x onerror=alert(1)> **bold**";
    routes[LIST] = { status: 200, body: [runSummary({ id: "m1", pr_title: title })] };
    setup();
    const link = await screen.findByRole("link");

    expect(within(link).getByText(`#482 · ${title}`)).toBeInTheDocument();
    expect(link.querySelector("img")).toBeNull();
    expect(link.querySelector("strong")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  it("AC-91: an unknown cost shows a dash", async () => {
    routes[LIST] = { status: 200, body: [runSummary({ id: "m1", total_cost_usd: null })] };
    setup();
    const link = await screen.findByRole("link");
    expect(within(link).getByText("—")).toBeInTheDocument();
    expect(within(link).getByText("12s")).toBeInTheDocument();
  });

  it("AC-107: a total time of 0 shows a dash instead of 0s", async () => {
    routes[LIST] = { status: 200, body: [runSummary({ id: "m1", total_duration_ms: 0 })] };
    setup();
    const link = await screen.findByRole("link");
    expect(within(link).getByText("—")).toBeInTheDocument();
    expect(within(link).queryByText("0s")).toBeNull();
    expect(within(link).getByText("$0.012")).toBeInTheDocument();
  });

  it("AC-92: a row is a link to its results page; a click and Tab + Enter both navigate", async () => {
    routes[LIST] = { status: 200, body: [runSummary({ id: "m1" }), runSummary({ id: "m2", pr_number: 9, pr_title: "Other" })] };
    const { user } = setup();
    const first = await screen.findByRole("link", { name: /#482/ });
    const second = screen.getByRole("link", { name: /#9 · Other/ });
    expect(first).toHaveAttribute("href", "/repos/r1/multi-agent/m1");
    expect(second).toHaveAttribute("href", "/repos/r1/multi-agent/m2");

    await user.click(first);
    expect(nav.push).toHaveBeenLastCalledWith("/repos/r1/multi-agent/m1");

    for (let i = 0; i < 30 && document.activeElement !== second; i++) await user.tab();
    expect(second).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(nav.push).toHaveBeenLastCalledWith("/repos/r1/multi-agent/m2");
  });

  it("AC-93: while the list is pending, skeleton rows show and the PR select and Run button stay operable", async () => {
    routes[LIST] = () => new Promise<Reply>(() => {});
    const { net, user } = setup();

    const heading = await screen.findByRole("heading", { name: "Recent runs" });
    const section = heading.closest("section")!;
    expect(section.querySelectorAll(".skeleton")).toHaveLength(3);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByText("No multi-agent runs yet")).toBeNull();

    await user.selectOptions(await screen.findByRole("combobox"), "pr7");
    const run = await screen.findByRole("button", { name: "Run multi-agent review (1)" });
    expect(run).toBeEnabled();
    await user.click(run);
    await advance(100);
    expect(net.paths()).toContain("POST /pulls/pr7/multi-agent-run");
  });

  it("AC-93: starting a run opens the results page even while the list request is still pending", async () => {
    routes[LIST] = () => new Promise<Reply>(() => {});
    const { user } = setup();
    await user.selectOptions(await screen.findByRole("combobox"), "pr7");
    await user.click(await screen.findByRole("button", { name: "Run multi-agent review (1)" }));
    await advance(100);
    expect(nav.push).toHaveBeenCalledWith("/repos/r1/multi-agent/m9");
  });

  it("AC-94: an empty list shows the empty state", async () => {
    setup();
    expect(await screen.findByText("No multi-agent runs yet")).toBeInTheDocument();
    expect(screen.getByText("Runs you start here appear in this list.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("AC-96: a 500 shows an inline error with Retry that refetches; the form stays usable and no toast fires", async () => {
    routes[LIST] = { status: 500, body: { error: { message: "Boom 500" } } };
    const { net, user } = setup();

    // the read retries twice (1s, 2s backoff) before it gives up
    await advance(3500);
    expect(await screen.findByText("Could not load recent runs")).toBeInTheDocument();
    const listCalls = () => net.paths().filter((p) => p === LIST).length;
    const before = listCalls();
    expect(before).toBeGreaterThan(0);
    expect(screen.queryByText("Boom 500")).toBeNull();

    // the form above is still operable
    await user.selectOptions(await screen.findByRole("combobox"), "pr7");
    expect(await screen.findByRole("button", { name: "Run multi-agent review (1)" })).toBeEnabled();

    routes[LIST] = { status: 200, body: [runSummary({ id: "m1" })] };
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("link", { name: /#482/ })).toBeInTheDocument();
    expect(listCalls()).toBeGreaterThan(before);
    expect(screen.queryByText("Could not load recent runs")).toBeNull();
    expect(screen.queryByText("Boom 500")).toBeNull();
  });

  it("AC-95: a running row turns done with new totals after a 3 s poll, without remounting", async () => {
    routes[LIST] = {
      status: 200,
      body: [runSummary({ id: "m1", status: "running", total_duration_ms: 0, total_cost_usd: null })],
    };
    setup();
    const link = await screen.findByRole("link");
    expect(within(link).getByText("Running")).toBeInTheDocument();
    expect(within(link).getAllByText("—")).toHaveLength(2);

    routes[LIST] = {
      status: 200,
      body: [runSummary({ id: "m1", status: "done", total_duration_ms: 15_000, total_cost_usd: 0.05 })],
    };
    await advance(3100);

    await waitFor(() => expect(within(screen.getByRole("link")).getByText("Done")).toBeInTheDocument());
    const after = screen.getByRole("link");
    expect(after).toBe(link);
    expect(within(after).getByText("15s")).toBeInTheDocument();
    expect(within(after).getByText("$0.05")).toBeInTheDocument();
    expect(within(after).queryByText("Running")).toBeNull();
  });

  it("H-NFR-3: renders at most 20 rows for a 25-item response", async () => {
    routes[LIST] = {
      status: 200,
      body: Array.from({ length: 25 }, (_, i) => runSummary({ id: `m${i}`, pr_number: i + 1, pr_title: `PR ${i + 1}` })),
    };
    setup();
    await screen.findAllByRole("listitem");
    expect(rowsOf()).toHaveLength(20);
    expect(screen.getByText("#20 · PR 20")).toBeInTheDocument();
    expect(screen.queryByText("#21 · PR 21")).toBeNull();
  });
});
