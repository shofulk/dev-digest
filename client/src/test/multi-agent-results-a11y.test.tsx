import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import {
  ResultsTestProviders,
  colFinding,
  column,
  conflict,
  findingRecord,
  installEventSource,
  installFetch,
  multiRun,
  review,
} from "./multi-agent-results-intl";

/* NFR-7 / NFR-8 for the results page in both modes. jsdom computes no layout, so colour
   contrast is not checked here (plan R6: a manual axe DevTools pass covers it). */

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
  AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import { MultiRunView } from "@/app/repos/[repoId]/multi-agent/[multiRunId]/_components/MultiRunView";

/* ---- harness ---- */

function serve() {
  const columns = [
    column({
      agent_id: "a1",
      agent_name: "Security",
      summary: "Two **risky** spots.",
      findings: [colFinding({ id: "f1", title: "SQL injection" })],
    }),
    column({ agent_id: "a2", agent_name: "Style", status: "running", score: null, duration_ms: null }),
    column({ agent_id: "a3", agent_name: "Perf", status: "failed", score: null, error: "Provider timed out" }),
    column({ agent_id: "a4", agent_name: "Docs", status: "cancelled", score: null }),
  ];
  installFetch({
    "GET /multi-agent-runs/mr1": {
      status: 200,
      body: multiRun({
        columns,
        stale: true,
        conflicts: [
          conflict({
            title: "SQL injection",
            takes: [
              { agent_id: "a1", persona: "Security", verdict: "CRITICAL", note: "Unsanitised input" },
              { agent_id: "a4", persona: "Docs", verdict: "ignored", note: "" },
            ],
          }),
        ],
      }),
    },
    "GET /pulls/pr1": { status: 200, body: { id: "pr1", number: 482, title: "Harden auth" } },
    "GET /pulls/pr1/reviews": {
      status: 200,
      body: [review("a1", [findingRecord({ id: "f1", title: "SQL injection", suggestion: "Parameterise." })])],
    },
  });
}

function renderView() {
  render(
    <ResultsTestProviders>
      <MultiRunView />
    </ResultsTestProviders>,
  );
}

async function violations() {
  const result = await axe.run(document.body, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    rules: { "color-contrast": { enabled: false } },
  });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
}

/** Press Tab until `el` holds focus (real keyboard traversal, not `el.focus()`). */
async function tabTo(user: ReturnType<typeof userEvent.setup>, el: HTMLElement, max = 40) {
  for (let i = 0; i < max && document.activeElement !== el; i++) await user.tab();
  expect(el).toHaveFocus();
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  nav.query = "";
  installEventSource();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const missingMessages = () =>
  consoleError.mock.calls.filter((args: unknown[]) => args.some((a) => String(a).includes("MISSING_MESSAGE")));

describe("multi-agent results accessibility", () => {
  it("NFR-7: Columns mode has no WCAG A/AA violations and no missing message", async () => {
    serve();
    renderView();
    await screen.findByRole("region", { name: "Security" });

    expect(await violations()).toEqual([]);
    expect(missingMessages()).toEqual([]);
  });

  it("NFR-7: Tabs mode (with a finding card expanded) has no WCAG A/AA violations and no missing message", async () => {
    nav.query = "view=tabs";
    serve();
    renderView();
    fireEvent.click(await within(await screen.findByRole("tabpanel")).findByText("SQL injection"));
    await screen.findByText("Parameterise.");

    expect(await violations()).toEqual([]);
    expect(missingMessages()).toEqual([]);
  });

  it("NFR-8 / AC-48: the view switch is a native button that takes focus and toggles on activation", async () => {
    serve();
    renderView();
    const tabsBtn = await screen.findByRole("button", { name: "Tabs" });

    // native, enabled buttons are in the Tab order and activate on Enter / Space
    expect(tabsBtn.tagName).toBe("BUTTON");
    expect(tabsBtn).toBeEnabled();
    expect(tabsBtn.tabIndex).toBeGreaterThanOrEqual(0);
    const user = userEvent.setup();
    await tabTo(user, tabsBtn);
    await user.keyboard("{Enter}");
    expect(nav.replace).toHaveBeenCalledWith(expect.stringContaining("view=tabs"));
  });

  it("NFR-8 / AC-56: each agent tab is a native button in the Tab order and selects its agent on activation", async () => {
    nav.query = "view=tabs";
    serve();
    renderView();
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.length).toBe(4);
    for (const t of tabs) {
      expect(t.tagName).toBe("BUTTON");
      expect(t).toBeEnabled();
      expect(t.tabIndex).toBeGreaterThanOrEqual(0);
    }

    const user = userEvent.setup();
    await tabTo(user, tabs[2]!);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Perf" })).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByRole("tab", { name: /Security/ })).toHaveAttribute("aria-selected", "false");

    // Space activates a tab as well
    await tabTo(user, tabs[3]!);
    await user.keyboard(" ");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Docs" })).toHaveAttribute("aria-selected", "true"));
  });

  it("NFR-8 / AC-63: the conflicts toggle has an accessible name, takes focus and flips on activation", async () => {
    serve();
    renderView();
    const toggle = await screen.findByRole("switch", { name: "Show only conflicts" });

    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.tabIndex).toBeGreaterThanOrEqual(0);
    const user = userEvent.setup();
    await tabTo(user, toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await user.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });
});
