import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { FindingRecord } from "@devdigest/shared";
import {
  ResultsTestProviders,
  colFinding,
  column,
  findingRecord,
  installEventSource,
  installFetch,
  multiRun,
  review,
  type Route,
} from "@/test/multi-agent-results-intl";

/* The Tabs mode is exercised through the results page: its finding actions go through the
   page's hooks and the PR's persisted reviews, and the assertions are on what the user sees. */

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
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { MultiRunView } from "../../MultiRunView";

/* ---- harness ---- */

/** Two agents flag the same file:line; the run's two findings are different rows. */
function seed() {
  const records: Record<string, FindingRecord> = {
    f1: findingRecord({
      id: "f1",
      title: "SQL injection",
      severity: "CRITICAL",
      category: "perf",
      file: "src/a.ts",
      start_line: 10,
      end_line: 12,
      confidence: 0.85,
      rationale: "User input reaches the query unescaped.",
      suggestion: "Use a parameterised query.",
    }),
    f2: findingRecord({ id: "f2", title: "Weak hash", file: "src/b.ts", start_line: 3, end_line: 3 }),
    g1: findingRecord({ id: "g1", title: "Style nit on the same line", file: "src/a.ts", start_line: 10, end_line: 10 }),
  };
  const columns = [
    column({
      agent_id: "a1",
      agent_name: "Security",
      score: 72,
      summary: "Two **risky** spots.",
      findings: [
        colFinding({ id: "f1", title: "SQL injection", file: "src/a.ts", start_line: 10 }),
        colFinding({ id: "f2", title: "Weak hash", file: "src/b.ts", start_line: 3 }),
      ],
    }),
    column({
      agent_id: "a2",
      agent_name: "Style",
      score: 91,
      findings: [colFinding({ id: "g1", title: "Style nit on the same line", file: "src/a.ts", start_line: 10 })],
    }),
  ];
  return { records, columns };
}

function serve(
  opts: { records?: Record<string, FindingRecord>; columns?: ReturnType<typeof seed>["columns"]; extra?: Record<string, Route> } = {},
) {
  const base = seed();
  const records = opts.records ?? base.records;
  const columns = opts.columns ?? base.columns;
  const reviews = () => [
    review("a1", ["f1", "f2"].map((id) => records[id]!).filter(Boolean)),
    review("a2", ["g1"].map((id) => records[id]!).filter(Boolean)),
  ];
  const fetcher = installFetch({
    "GET /multi-agent-runs/mr1": { status: 200, body: multiRun({ columns }) },
    "GET /pulls/pr1": { status: 200, body: { id: "pr1", number: 482, title: "Harden auth" } },
    "GET /pulls/pr1/reviews": () => ({ status: 200, body: reviews() }),
    ...opts.extra,
  });
  return { ...fetcher, records };
}

function renderView() {
  render(
    <ResultsTestProviders>
      <MultiRunView />
    </ResultsTestProviders>,
  );
}

const expand = async (title: string) => {
  fireEvent.click(await screen.findByText(title));
};
const actionCalls = (calls: ReturnType<typeof serve>["calls"]) =>
  calls().filter((c) => c.method === "POST" && c.path.startsWith("/findings/"));

beforeEach(() => {
  nav.query = "view=tabs";
  installEventSource();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Tabs view", () => {
  it("AC-56: one tab per agent with its score, a summary card, and expandable finding cards with every field and the four actions", async () => {
    serve();
    renderView();

    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Security72", "Style91"]);
    expect(screen.getByRole("tab", { name: "Security 72", selected: true })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Style 91", selected: false })).toBeInTheDocument();

    // summary card of the selected agent
    const panel = within(screen.getByRole("tabpanel"));
    expect(panel.getByText("risky").tagName).toBe("STRONG");
    expect(panel.getByRole("button", { name: "View trace" })).toBeInTheDocument();
    expect(panel.getByText("12s · $0.012")).toBeInTheDocument();

    // cards start collapsed: the title and file:line are visible, the body is not
    expect(await panel.findByText("SQL injection")).toBeInTheDocument();
    expect(panel.getByText("src/a.ts:10-12")).toBeInTheDocument();
    expect(panel.queryByText("User input reaches the query unescaped.")).not.toBeInTheDocument();
    expect(panel.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();

    await expand("SQL injection");
    // severity is an icon-only badge in the card (no text); category and confidence are text
    expect(panel.getByText(/perf/i)).toBeInTheDocument();
    expect(panel.getAllByTitle("Model confidence")[0]).toHaveTextContent("85");
    expect(panel.getByText("User input reaches the query unescaped.")).toBeInTheDocument();
    expect(panel.getByText("Suggested fix")).toBeInTheDocument();
    expect(panel.getByText("Use a parameterised query.")).toBeInTheDocument();
    for (const name of ["Accept", "Dismiss", /Turn into eval case/, "Learn"]) {
      expect(panel.getByRole("button", { name })).toBeInTheDocument();
    }

    // switching tabs swaps the panel to that agent's findings
    fireEvent.click(screen.getByRole("tab", { name: "Style 91" }));
    expect(screen.getByRole("tab", { name: "Style 91", selected: true })).toBeInTheDocument();
    expect(await screen.findByText("Style nit on the same line")).toBeInTheDocument();
    expect(screen.queryByText("SQL injection")).not.toBeInTheDocument();
  });

  it("AC-56: the summary card shows the score ring and every finding card names its severity", async () => {
    serve();
    renderView();

    const panel = within(await screen.findByRole("tabpanel"));
    await panel.findByText("SQL injection");
    // summary card: the number inside a ring (72 -> warn band)
    expect(panel.getByText("72").parentElement!.querySelector("svg circle[stroke='var(--warn)']")).not.toBeNull();

    // severity is exposed by name on the collapsed card, matched to its finding
    const sev = (title: string) =>
      within(panel.getByText(title).closest("[data-finding-id]") as HTMLElement);
    expect(sev("SQL injection").getByRole("img", { name: "Critical" })).toBeInTheDocument();
    expect(sev("Weak hash").getByRole("img", { name: "Warning" })).toBeInTheDocument();
  });

  it("AC-57: accepting a finding calls the action for that id only, and the other agent's card on the same line is unchanged", async () => {
    const { calls, records } = serve({
      extra: {
        "POST /findings/f1/accept": { status: 200, body: { finding: {} } },
      },
    });
    renderView();

    await expand("SQL injection");
    // the server will now report f1 accepted
    records.f1 = { ...records.f1!, accepted_at: "2026-10-01T10:05:00Z" };
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() => expect(within(screen.getByRole("tabpanel")).getByText("accepted")).toBeInTheDocument());
    expect(actionCalls(calls).map((c) => c.path)).toEqual(["/findings/f1/accept"]);

    // the other agent's card for the same file:line was not touched
    fireEvent.click(screen.getByRole("tab", { name: "Style 91" }));
    await expand("Style nit on the same line");
    expect(within(screen.getByRole("tabpanel")).queryByText("accepted")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept" })).toBeEnabled();
    expect(actionCalls(calls)).toHaveLength(1);
  });

  it("AC-58: the eval-case action is disabled until the finding is triaged, then names its expectation", async () => {
    const { records } = serve({ extra: { "POST /findings/f1/dismiss": { status: 200, body: { finding: {} } } } });
    renderView();

    await expand("SQL injection");
    const evalBtn = () => screen.getByRole("button", { name: /Turn into eval case/ });
    expect(evalBtn()).toBeDisabled();

    records.f1 = { ...records.f1!, dismissed_at: "2026-10-01T10:05:00Z" };
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() => expect(evalBtn()).toBeEnabled());
    expect(evalBtn()).toHaveTextContent("as must_not_flag");
  });

  it("AC-61: a failing action raises a toast and leaves the card unchanged", async () => {
    const { calls } = serve({
      extra: { "POST /findings/f1/accept": { status: 500, body: { error: { message: "Could not accept finding" } } } },
    });
    renderView();

    await expand("SQL injection");
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    expect(await screen.findByText("Could not accept finding")).toBeInTheDocument();
    expect(actionCalls(calls).map((c) => c.path)).toEqual(["/findings/f1/accept"]);
    const panel = within(screen.getByRole("tabpanel"));
    expect(panel.queryByText("accepted")).not.toBeInTheDocument();
    expect(panel.getByRole("button", { name: "Accept" })).toBeEnabled();
    expect(panel.getByRole("button", { name: /Turn into eval case/ })).toBeDisabled();
  });

  it("AC-58: Turn into eval case loads the finding's draft and opens the eval-case editor on it", async () => {
    const base = seed();
    base.records.f1 = { ...base.records.f1!, dismissed_at: "2026-10-01T10:05:00Z" };
    const { calls } = serve({
      records: base.records,
      columns: base.columns,
      extra: {
        "GET /findings/f1/eval-case-draft": {
          status: 200,
          body: {
            agent_id: "a1",
            existing_case: null,
            draft: {
              name: "Drafted SQL injection case",
              input_diff: "diff --git a/src/a.ts b/src/a.ts",
              input_files: ["src/a.ts"],
              pr_title: "Harden auth",
              pr_body: null,
              expectation: {
                type: "must_not_flag",
                file: "src/a.ts",
                start_line: 10,
                end_line: 10,
                severity: "CRITICAL",
                category: "security",
                title: "SQL injection",
              },
              notes: null,
            },
          },
        },
      },
    });
    renderView();

    await expand("SQL injection");
    fireEvent.click(screen.getByRole("button", { name: /Turn into eval case/ }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByDisplayValue("Drafted SQL injection case")).toBeInTheDocument();
    expect(calls().map((c) => `${c.method} ${c.path}`)).toContain("GET /findings/f1/eval-case-draft");
    // opening the editor stores nothing
    expect(actionCalls(calls)).toEqual([]);
  });

  it("AC-61: a failing eval-case action toasts the API message and leaves the card unchanged", async () => {
    const base = seed();
    base.records.f1 = { ...base.records.f1!, dismissed_at: "2026-10-01T10:05:00Z" };
    const { calls } = serve({
      records: base.records,
      columns: base.columns,
      extra: {
        "GET /findings/f1/eval-case-draft": {
          status: 422,
          body: { error: { code: "expectation_not_grounded", message: "Expectation cites no line of the diff" } },
        },
      },
    });
    renderView();

    await expand("SQL injection");
    fireEvent.click(screen.getByRole("button", { name: /Turn into eval case/ }));

    // the API's own message reaches the user (the card's translated hint may sit beside it)
    expect(await screen.findByText("Expectation cites no line of the diff")).toBeInTheDocument();
    expect(calls().map((c) => `${c.method} ${c.path}`)).toContain("GET /findings/f1/eval-case-draft");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // nothing about the finding changed: still dismissed, no accept/dismiss/eval-case POST
    expect(actionCalls(calls)).toEqual([]);
    const panel = within(screen.getByRole("tabpanel"));
    expect(panel.getByText("dismissed")).toBeInTheDocument();
    expect(panel.queryByText("accepted")).not.toBeInTheDocument();
    expect(panel.getByRole("button", { name: /Turn into eval case/ })).toBeEnabled();
  });

  it("AC-72 / AC-73: Learn is always enabled and posts for that finding; a learned finding shows Learned", async () => {
    const base = seed();
    base.records.f2 = { ...base.records.f2!, learned: true };
    const { calls } = serve({
      records: base.records,
      columns: base.columns,
      extra: { "POST /findings/f1/learn": { status: 200, body: { memory_id: "m1", created: true } } },
    });
    renderView();

    await expand("SQL injection");
    const panel = within(screen.getByRole("tabpanel"));
    // untriaged and not yet learned: Learn is still available
    expect(panel.getByRole("button", { name: "Learn" })).toBeEnabled();

    await expand("Weak hash");
    const learned = panel.getByRole("button", { name: "Learned" });
    expect(learned).toBeEnabled();

    fireEvent.click(panel.getByRole("button", { name: "Learn" }));
    await waitFor(() =>
      expect(calls().some((c) => c.method === "POST" && c.path === "/findings/f1/learn")).toBe(true),
    );
  });

  it("AC-67: Markdown in the summary and in a finding never injects raw HTML", async () => {
    const base = seed();
    base.columns[0]!.summary = 'Looks fine <img src="x" onerror="alert(1)"> <script>alert(2)</script> **ok**';
    base.records.f1 = {
      ...base.records.f1!,
      rationale: 'Call `code` safely <b>bold html</b>\n\n<iframe src="https://evil.test"></iframe>',
    };
    serve({ records: base.records, columns: base.columns });
    renderView();

    await expand("SQL injection");
    const panel = within(screen.getByRole("tabpanel"));
    expect(panel.getByText("ok").tagName).toBe("STRONG");
    expect(panel.getByText("code").tagName).toBe("CODE");
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
    expect(document.querySelector("b")).toBeNull();
  });
});
