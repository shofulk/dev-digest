import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import {
  ResultsTestProviders,
  column,
  installEventSource,
  installFetch,
  multiRun,
  review,
} from "@/test/multi-agent-results-intl";

/* ---- module doubles ---- */

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

const PR = { id: "pr1", number: 482, title: "Harden the auth middleware" };

function serve(run = multiRun(), pr: Record<string, unknown> = PR) {
  return installFetch({
    "GET /multi-agent-runs/mr1": { status: 200, body: run },
    "GET /pulls/pr1": { status: 200, body: pr },
    "GET /pulls/pr1/reviews": { status: 200, body: [review("a1", []), review("a2", [])] },
  });
}

function renderView() {
  render(
    <ResultsTestProviders>
      <MultiRunView />
    </ResultsTestProviders>,
  );
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

describe("MultiRunView header", () => {
  it("AC-47 / AC-67 / AC-71: shows the PR number, the title as plain text and the meta line, with a dash for an unknown total cost", async () => {
    serve(multiRun({ total_cost_usd: null, total_duration_ms: 14000 }), {
      ...PR,
      title: "<img src=x onerror=alert(1)>Fix <b>auth</b>",
    });
    renderView();

    expect(await screen.findByText("#482")).toBeInTheDocument();
    // the HTML title is text, not markup
    expect(await screen.findByText("<img src=x onerror=alert(1)>Fix <b>auth</b>")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("b")).toBeNull();
    // 2 agents · parallel · 14s total · — (no price book entry)
    expect(screen.getByText("2 agents · parallel · 14s total · —")).toBeInTheDocument();
  });

  it("AC-47: shows the total cost when it is known", async () => {
    serve(multiRun({ total_cost_usd: 0.0246 }));
    renderView();
    expect(await screen.findByText("2 agents · parallel · 14s total · $0.025")).toBeInTheDocument();
  });
});

describe("MultiRunView Configure run button", () => {
  it("AC-47: the header 'Configure run' button opens Configure run for the same PR", async () => {
    serve();
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Configure run" }));
    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(nav.push).toHaveBeenCalledWith("/repos/r1/multi-agent?pr=pr1");
  });
});

describe("MultiRunView view mode", () => {
  it("AC-48: defaults to Columns, and the switch writes the chosen mode to the URL", async () => {
    serve(multiRun({ columns: [column({ agent_id: "a1" }), column({ agent_id: "a2" })] }));
    renderView();

    expect(await screen.findByRole("button", { name: "Columns", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tabs", pressed: false })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Agent a1" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Tabs" }));
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace.mock.calls[0]![0]).toContain("view=tabs");
  });

  it("AC-48: ?view=tabs renders the Tabs mode and marks it pressed; an unknown value falls back to Columns", async () => {
    nav.query = "view=tabs";
    serve();
    renderView();
    expect(await screen.findByRole("tablist", { name: "Agents" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tabs", pressed: true })).toBeInTheDocument();

    cleanup();
    nav.query = "view=bogus";
    serve();
    renderView();
    expect(await screen.findByRole("button", { name: "Columns", pressed: true })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });
});

describe("MultiRunView stale run", () => {
  it("AC-65: a stale run shows the banner with a link back to Configure run for the same PR", async () => {
    serve(multiRun({ stale: true }));
    renderView();

    expect(await screen.findByText("PR changed since this run")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Configure run" })).toHaveAttribute(
      "href",
      "/repos/r1/multi-agent?pr=pr1",
    );
  });

  it("AC-65: a fresh run shows no banner", async () => {
    serve(multiRun({ stale: false }));
    renderView();
    await screen.findByText("#482");
    expect(screen.queryByText("PR changed since this run")).not.toBeInTheDocument();
  });
});

describe("MultiRunView missing run", () => {
  it.each([404, 422])("AC-66: a %i answer shows 'Run not found' with a link back to Configure run", async (status) => {
    installFetch({ "GET /multi-agent-runs/mr1": { status, body: { error: { message: "nope" } } } });
    renderView();

    expect(await screen.findByRole("heading", { name: "Run not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Configure run" })).toHaveAttribute("href", "/repos/r1/multi-agent");
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByText("Where agents disagree")).not.toBeInTheDocument();
  });
});
