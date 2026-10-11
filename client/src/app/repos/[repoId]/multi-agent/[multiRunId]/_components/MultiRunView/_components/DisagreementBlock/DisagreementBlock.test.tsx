import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import type { Conflict } from "@devdigest/shared";
import {
  ResultsTestProviders,
  column,
  conflict,
  installEventSource,
  installFetch,
  multiRun,
  review,
} from "@/test/multi-agent-results-intl";

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
import { DisagreementBlock } from "./DisagreementBlock";

/* ---- fixtures ---- */

const DONE = [column({ agent_id: "a1", agent_name: "Security" }), column({ agent_id: "a2", agent_name: "Style" })];

const GROUPS: Conflict[] = [
  conflict({
    file: "src/db.ts",
    line: 42,
    title: "SQL injection",
    is_conflict: true,
    takes: [
      { agent_id: "a1", persona: "Security", verdict: "CRITICAL", note: "Unsanitised input reaches the query" },
      { agent_id: "a2", persona: "Style", verdict: "ignored", note: "Style saw nothing wrong here" },
    ],
  }),
  conflict({
    file: "src/util.ts",
    line: 5,
    title: "Magic number",
    is_conflict: false,
    takes: [
      { agent_id: "a1", persona: "Security", verdict: "SUGGESTION", note: "Name this constant" },
      { agent_id: "a2", persona: "Style", verdict: "SUGGESTION", note: "Extract a constant" },
    ],
  }),
];

function renderBlock(columns = DONE, groups = GROUPS) {
  render(
    <ResultsTestProviders>
      <DisagreementBlock columns={columns} groups={groups} />
    </ResultsTestProviders>,
  );
  return within(screen.getByRole("region", { name: "Where agents disagree" }));
}

beforeEach(() => {
  nav.query = "";
  installEventSource();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("DisagreementBlock", () => {
  it("AC-62: each group is a row with file:line and title, one cell per take with the agent and either severity plus title or 'did not flag' - and never the reason", () => {
    const block = renderBlock();

    expect(block.getByText("src/db.ts:42")).toBeInTheDocument();
    expect(block.getByText("SQL injection")).toBeInTheDocument();
    expect(block.getByText("src/util.ts:5")).toBeInTheDocument();
    expect(block.getByText("Magic number")).toBeInTheDocument();

    // the flagging take: agent, severity, finding title
    expect(block.getByText("Unsanitised input reaches the query")).toBeInTheDocument();
    expect(block.getByText(/critical/i)).toBeInTheDocument();
    // the other agent did not flag it: no title, no reason text
    expect(block.getAllByText("did not flag")).toHaveLength(1);
    expect(block.queryByText("Style saw nothing wrong here")).not.toBeInTheDocument();
    // each take names its agent (both rows list Security and Style)
    expect(block.getAllByText("Security")).toHaveLength(2);
    expect(block.getAllByText("Style")).toHaveLength(2);
  });

  it("AC-63: the toggle is off by default (all groups) and on shows only the conflicts", () => {
    const block = renderBlock();
    const toggle = block.getByRole("switch", { name: "Show only conflicts" });

    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(block.getByText("SQL injection")).toBeInTheDocument();
    expect(block.getByText("Magic number")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(block.getByText("SQL injection")).toBeInTheDocument();
    expect(block.queryByText("Magic number")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(block.getByText("Magic number")).toBeInTheDocument();
  });

  it("AC-64: fewer than two finished agents shows 'Not enough finished agents to compare' instead of rows", () => {
    const block = renderBlock([
      column({ agent_id: "a1", agent_name: "Security" }),
      column({ agent_id: "a2", agent_name: "Style", status: "running", score: null }),
    ]);
    expect(block.getByText("Not enough finished agents to compare")).toBeInTheDocument();
    expect(block.queryByText("SQL injection")).not.toBeInTheDocument();
    expect(block.queryByText("src/db.ts:42")).not.toBeInTheDocument();
  });

  it("AC-64: with two finished agents the notice is not shown", () => {
    const block = renderBlock();
    expect(block.queryByText("Not enough finished agents to compare")).not.toBeInTheDocument();
  });
});

describe("DisagreementBlock titles", () => {
  it("C10 / AC-67: the group title and a take's finding title render through Markdown, never as raw HTML", () => {
    const block = renderBlock(DONE, [
      conflict({
        file: "src/db.ts",
        line: 42,
        title: "Unsafe `eval` <img src=x onerror=alert(1)>",
        is_conflict: true,
        takes: [
          { agent_id: "a1", persona: "Security", verdict: "CRITICAL", note: "Input is **unsanitised**" },
          { agent_id: "a2", persona: "Style", verdict: "ignored", note: "" },
        ],
      }),
    ]);
    expect(block.getByText("eval").tagName).toBe("CODE");
    expect(block.getByText("unsanitised").tagName).toBe("STRONG");
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("DisagreementBlock on the results page", () => {
  it.each([
    ["columns", ""],
    ["tabs", "view=tabs"],
  ])("AC-62 / AC-64: the block is rendered in %s mode", async (_mode, query) => {
    nav.query = query;
    installFetch({
      "GET /multi-agent-runs/mr1": { status: 200, body: multiRun({ columns: DONE, conflicts: GROUPS }) },
      "GET /pulls/pr1": { status: 200, body: { id: "pr1", number: 482, title: "Harden auth" } },
      "GET /pulls/pr1/reviews": { status: 200, body: [review("a1", []), review("a2", [])] },
    });
    render(
      <ResultsTestProviders>
        <MultiRunView />
      </ResultsTestProviders>,
    );

    const block = within(await screen.findByRole("region", { name: "Where agents disagree" }));
    expect(block.getByText("src/db.ts:42")).toBeInTheDocument();
    expect(block.getByText("Unsanitised input reaches the query")).toBeInTheDocument();
    expect(block.getByRole("switch", { name: "Show only conflicts" })).toBeInTheDocument();
  });
});
