import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { agent, estimate, pull } from "@/test/multi-agent-intl";
import { HistoryTestProviders, installHistoryFetch, runSummary, type Route } from "@/test/multi-agent-history-intl";
import type { PrDetail } from "@/lib/types";

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1" }),
  usePathname: () => "/repos/r1/multi-agent",
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import { ConfigureRunView } from "@/app/repos/[repoId]/multi-agent/_components/ConfigureRunView";
import { PrDetailHeader } from "@/app/repos/[repoId]/pulls/[number]/_components/PrDetailHeader";

const LIST = "GET /repos/r1/multi-agent-runs";
let routes: Record<string, Route>;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  consoleError = vi.spyOn(console, "error");
  routes = {
    "GET /repos": { status: 200, body: [{ id: "r1", full_name: "acme/api", default_branch: "main" }] },
    "GET /repos/r1/pulls": { status: 200, body: [pull({ number: 7, title: "Add cache" })] },
    "GET /agents": { status: 200, body: [agent({ id: "a1", name: "Security" })] },
    "GET /run-estimates": { status: 200, body: [estimate("a1", 10_000, 0.05)] },
    [LIST]: { status: 200, body: [] },
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  consoleError.mockRestore();
});

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/** WCAG 2 A + AA. jsdom has no layout engine, so colour contrast is a manual pass (plan R6). */
async function violations(root: Element) {
  const res = await axe.run(root, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    rules: { "color-contrast": { enabled: false } },
  });
  return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

const missingMessages = () =>
  consoleError.mock.calls.filter((c) => String(c[0] instanceof Error ? c[0].message : c[0]).includes("MISSING_MESSAGE"));

function renderConfigure() {
  installHistoryFetch(routes);
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const { container } = render(
    <HistoryTestProviders>
      <ConfigureRunView />
    </HistoryTestProviders>,
  );
  return { user, container };
}

/** Press Tab until `el` holds focus (real keyboard traversal, not `el.focus()`). */
async function tabTo(user: ReturnType<typeof userEvent.setup>, el: HTMLElement, max = 40) {
  for (let i = 0; i < max && document.activeElement !== el; i++) await user.tab();
  expect(el).toHaveFocus();
}

/** Swallow an anchor's default navigation (jsdom has no router) and count the activations. */
function watchClicks(el: HTMLElement) {
  const clicked = vi.fn((e: Event) => e.preventDefault());
  el.addEventListener("click", clicked);
  return clicked;
}

describe("multi-agent history accessibility", () => {
  it("AC-90 / AC-92: Configure run with rows has no WCAG A/AA violations, Tab reaches every row link and Enter activates it", async () => {
    routes[LIST] = {
      status: 200,
      body: [
        runSummary({ id: "m1", status: "running" }),
        runSummary({ id: "m2", status: "partial", pr_number: 9, pr_title: "Other" }),
        runSummary({ id: "m3", status: "failed", pr_number: 3, pr_title: "Third", total_cost_usd: null, total_duration_ms: 0 }),
      ],
    };
    const { user, container } = renderConfigure();
    await screen.findByRole("link", { name: /#482/ });

    expect(await violations(container)).toEqual([]);

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
    for (const a of links) {
      const clicked = watchClicks(a);
      await tabTo(user, a);
      await user.keyboard("{Enter}");
      expect(clicked).toHaveBeenCalledTimes(1);
    }
    expect(missingMessages()).toEqual([]);
  });

  it("AC-94: Configure run with the empty state has no WCAG A/AA violations and no missing message", async () => {
    const { container } = renderConfigure();
    await screen.findByText("No multi-agent runs yet");
    expect(await violations(container)).toEqual([]);
    expect(missingMessages()).toEqual([]);
  });

  it("AC-96: Configure run with the error state has no WCAG A/AA violations, a keyboard-reachable Retry and no missing message", async () => {
    routes[LIST] = { status: 500, body: { error: { message: "Boom 500" } } };
    const { user, container } = renderConfigure();
    await advance(3500);
    await screen.findByText("Could not load recent runs");

    expect(await violations(container)).toEqual([]);
    await tabTo(user, screen.getByRole("button", { name: "Retry" }));
    expect(missingMessages()).toEqual([]);
  });

  it("AC-98: the PR-header link has no WCAG A/AA violations, Tab reaches it and Enter activates it", async () => {
    routes[LIST] = { status: 200, body: [runSummary({ id: "m-new" })] };
    installHistoryFetch(routes);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { container } = render(
      <HistoryTestProviders>
        <PrDetailHeader
          pr={
            {
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
            } as unknown as PrDetail
          }
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
    const a = await screen.findByRole("link", { name: "Open multi-agent review" });

    expect(await violations(container)).toEqual([]);
    const clicked = watchClicks(a);
    await tabTo(user, a);
    await user.keyboard("{Enter}");
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(missingMessages()).toEqual([]);
  });
});
