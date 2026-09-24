import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { ConventionCandidate } from "@devdigest/shared";
import { ConventionsTestProviders } from "@/test/conventions-intl";

/* ---- module doubles ---- */

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), query: "" }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1" }),
  usePathname: () => "/repos/r1/conventions",
  useSearchParams: () => new URLSearchParams(nav.query),
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
}));

const repo = vi.hoisted(() => ({ notFound: false }));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    activeRepo: { id: "r1", full_name: "acme/api", default_branch: "main" },
    repos: [],
    repoId: "r1",
    setRepoId: () => {},
    reposLoaded: true,
  }),
  useRepoNotFound: () => repo.notFound,
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ crumb, children }: { crumb?: { label: string }[]; children: React.ReactNode }) => (
    <div>
      <nav aria-label="breadcrumb">{crumb?.map((c) => c.label).join(" › ")}</nav>
      {children}
    </div>
  ),
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/toast", () => ({ notify: toast }));

import { ConventionsView } from "./ConventionsView";

/* ---- fixtures ---- */

function candidate(over: Partial<ConventionCandidate> = {}): ConventionCandidate {
  return {
    id: "c1",
    repo_id: "r1",
    category: "naming",
    rule: "Hooks are named use*",
    rationale: "Keeps the lint rule honest",
    evidence_path: "src/lib/hooks/skills.ts",
    evidence_line: 12,
    evidence_snippet: "export function useSkills()",
    confidence: 0.92,
    status: "pending",
    created_at: "2026-09-01T00:00:00Z",
    ...over,
  };
}

const BOARD: ConventionCandidate[] = [
  candidate({ id: "c1", rule: "Hooks are named use*", confidence: 0.92 }),
  candidate({ id: "c2", rule: "Errors go through ApiError", confidence: 0.5, category: "errors" }),
  candidate({ id: "c3", rule: "Tests live beside the code", confidence: 0.81, status: "accepted" }),
  candidate({ id: "c4", rule: "No default exports", confidence: 0.7, status: "rejected" }),
];

/* ---- fetch double ---- */

type Reply = { status: number; body: unknown };
let replies: Record<string, Reply>;
/** Paths held open until the test releases them — how the optimistic frame is observed. */
let gates: Record<string, { promise: Promise<void>; open: () => void }>;
let fetchMock: ReturnType<typeof vi.fn>;

function hold(path: string) {
  let open!: () => void;
  const promise = new Promise<void>((r) => (open = r));
  gates[path] = { promise, open };
}

const calls = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    method: (init?.method ?? "GET") as string,
    path: new URL(url as string).pathname,
    body: init?.body ? JSON.parse(init.body as string) : undefined,
  }));

beforeEach(() => {
  nav.query = "";
  repo.notFound = false;
  gates = {};
  replies = {
    "/repos/r1/conventions": { status: 200, body: BOARD },
    "/conventions/c1": { status: 200, body: candidate({ id: "c1", status: "accepted" }) },
    "/conventions/c2": { status: 200, body: candidate({ id: "c2", status: "rejected" }) },
    "/repos/r1/conventions/scan": { status: 202, body: { scan_id: "scan-1" } },
  };
  fetchMock = vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    if (gates[path]) await gates[path].promise;
    const r = replies[path] ?? { status: 404, body: {} };
    return { ok: r.status < 400, status: r.status, statusText: "", json: async () => r.body } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderView() {
  render(
    <ConventionsTestProviders>
      <ConventionsView />
    </ConventionsTestProviders>,
  );
}

const cards = () => screen.getAllByTestId("candidate-card");
const showAll = () => fireEvent.click(screen.getByRole("button", { name: /^All\s*\d+$/ }));

/* ---- tests ---- */

describe("ConventionsView — board states", () => {
  it("shows the skeleton while the board is loading and no candidate yet", () => {
    hold("/repos/r1/conventions");
    renderView();
    expect(screen.getByTestId("conventions-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("candidate-card")).not.toBeInTheDocument();
    gates["/repos/r1/conventions"]!.open();
  });

  it("shows a retryable error state when the board cannot be loaded", async () => {
    replies["/repos/r1/conventions"] = {
      status: 500,
      body: { error: { code: "internal", message: "boom" } },
    };
    renderView();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load conventions.");
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(calls().filter((c) => c.path === "/repos/r1/conventions").length).toBe(2));
  });

  it("an empty board offers the first scan and shows no filter chips", async () => {
    replies["/repos/r1/conventions"] = { status: 200, body: [] };
    renderView();

    expect(await screen.findByText("No conventions extracted yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^All\s*\d+$/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Run extraction" }).length).toBeGreaterThan(0);
  });

  it("a populated board lists the pending rows first, highest confidence first", async () => {
    renderView();
    await screen.findAllByTestId("candidate-card");

    expect(cards()).toHaveLength(2);
    expect(cards()[0]).toHaveTextContent("Hooks are named use*");
    expect(cards()[1]).toHaveTextContent("Errors go through ApiError");
    expect(screen.getByText(/2 candidates/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Conventions in acme/api");
    expect(screen.getByRole("navigation", { name: "breadcrumb" })).toHaveTextContent(
      "Skills Lab › Conventions",
    );
  });

  it("renders confidence as a whole percent", async () => {
    renderView();
    await screen.findAllByTestId("candidate-card");
    expect(within(cards()[0]!).getByText("92%")).toBeInTheDocument();
    expect(within(cards()[1]!).getByText("50%")).toBeInTheDocument();
  });

  it("chip counts come from the whole board, and a chip narrows the list", async () => {
    renderView();
    await screen.findAllByTestId("candidate-card");

    expect(screen.getByRole("button", { name: /^Pending\s*2$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Accepted\s*1$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Rejected\s*1$/ })).toBeInTheDocument();

    showAll();
    expect(cards()).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: /^Rejected\s*1$/ }));
    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toHaveTextContent("No default exports");
  });

  it("a filter with nothing in it says so instead of looking broken", async () => {
    replies["/repos/r1/conventions"] = { status: 200, body: [candidate({ id: "c3", status: "accepted" })] };
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: /^Rejected\s*0$/ }));
    expect(screen.getByText("Nothing in this state")).toBeInTheDocument();
    expect(screen.queryByTestId("candidate-card")).not.toBeInTheDocument();
  });

  it("an unknown repo shows the repo empty state and never fetches the board", () => {
    repo.notFound = true;
    renderView();
    expect(screen.getByText("No repo selected")).toBeInTheDocument();
    expect(screen.queryByTestId("candidate-card")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });
});

describe("ConventionsView — triage", () => {
  it("accept applies optimistically before the server answers, then keeps the server row", async () => {
    hold("/conventions/c1");
    renderView();
    await screen.findAllByTestId("candidate-card");
    showAll();

    fireEvent.click(within(cards()[0]!).getByRole("button", { name: "Accept" }));

    // the card flips without a round-trip
    await waitFor(() =>
      expect(within(cards()[0]!).getByRole("button", { name: "Accepted" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /^Accepted\s*2$/ })).toBeInTheDocument();

    gates["/conventions/c1"]!.open();
    await waitFor(() =>
      expect(calls()).toContainEqual({
        method: "PATCH",
        path: "/conventions/c1",
        body: { status: "accepted" },
      }),
    );
    expect(within(cards()[0]!).getByRole("button", { name: "Accepted" })).toBeInTheDocument();
  });

  it("a failed reject rolls the card back to its previous state", async () => {
    replies["/conventions/c2"] = {
      status: 500,
      body: { error: { code: "internal", message: "boom" } },
    };
    hold("/conventions/c2");
    renderView();
    await screen.findAllByTestId("candidate-card");
    showAll();

    const card = () => cards().find((c) => c.textContent?.includes("Errors go through ApiError"))!;
    fireEvent.click(within(card()).getByRole("button", { name: "Reject" }));
    await waitFor(() =>
      expect(within(card()).getByRole("button", { name: "Rejected" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /^Rejected\s*2$/ })).toBeInTheDocument();

    gates["/conventions/c2"]!.open();
    await waitFor(() =>
      expect(within(card()).getByRole("button", { name: "Reject" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /^Rejected\s*1$/ })).toBeInTheDocument();
  });

  it("accepting one card never mutates another", async () => {
    renderView();
    await screen.findAllByTestId("candidate-card");
    showAll();

    fireEvent.click(within(cards()[0]!).getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(calls().some((c) => c.method === "PATCH")).toBe(true));
    expect(calls().filter((c) => c.method === "PATCH").map((c) => c.path)).toEqual(["/conventions/c1"]);
  });

  it("delete removes the row with a DELETE and leaves the rest alone", async () => {
    replies["/conventions/c1"] = { status: 200, body: { ok: true } };
    renderView();
    await screen.findAllByTestId("candidate-card");

    fireEvent.click(within(cards()[0]!).getByRole("button", { name: "Delete candidate" }));
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(calls()).toContainEqual({ method: "DELETE", path: "/conventions/c1", body: undefined });
    expect(cards()[0]).toHaveTextContent("Errors go through ApiError");
  });
});

describe("ConventionsView — inline editing", () => {
  it("edit puts the candidate id in the URL instead of opening a local-only editor", async () => {
    renderView();
    await screen.findAllByTestId("candidate-card");

    fireEvent.click(within(cards()[0]!).getByRole("button", { name: "Edit rule" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/repos/r1/conventions?candidate=c1", {
      scroll: false,
    });
    expect(screen.queryByTestId("candidate-editor")).not.toBeInTheDocument();
  });

  it("?candidate= swaps exactly that card for the editor", async () => {
    nav.query = "candidate=c1";
    renderView();
    await screen.findByTestId("candidate-editor");

    expect(screen.getByLabelText("Rule")).toHaveValue("Hooks are named use*");
    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toHaveTextContent("Errors go through ApiError");
  });

  it("saving the editor PATCHes the edited fields and closes the editor", async () => {
    nav.query = "candidate=c1";
    renderView();
    await screen.findByTestId("candidate-editor");

    fireEvent.change(screen.getByLabelText("Rule"), { target: { value: "Hooks start with use" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(calls()).toContainEqual({
        method: "PATCH",
        path: "/conventions/c1",
        body: { rule: "Hooks start with use", rationale: "Keeps the lint rule honest" },
      }),
    );
    expect(nav.replace).toHaveBeenLastCalledWith("/repos/r1/conventions", { scroll: false });
  });

  it("cancelling clears ?candidate= and writes nothing", async () => {
    nav.query = "candidate=c1";
    renderView();
    await screen.findByTestId("candidate-editor");

    fireEvent.change(screen.getByLabelText("Rule"), { target: { value: "thrown away" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(nav.replace).toHaveBeenLastCalledWith("/repos/r1/conventions", { scroll: false });
    expect(calls().every((c) => c.method === "GET")).toBe(true);
  });
});

describe("ConventionsView — scan and skill creation", () => {
  it("the scan button POSTs once and reports a refusal as a toast", async () => {
    renderView();
    await screen.findAllByTestId("candidate-card");

    fireEvent.click(screen.getByRole("button", { name: "Re-scan" }));
    await waitFor(() =>
      expect(calls()).toContainEqual({ method: "POST", path: "/repos/r1/conventions/scan", body: {} }),
    );
    expect(toast.error).not.toHaveBeenCalled();

    replies["/repos/r1/conventions/scan"] = {
      status: 500,
      body: { error: { code: "internal", message: "boom" } },
    };
    fireEvent.click(screen.getByRole("button", { name: "Re-scan" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Extraction failed"));
  });

  it("Create skill is disabled once every accepted row is deselected", async () => {
    renderView();
    await screen.findAllByTestId("candidate-card");

    expect(screen.getByRole("button", { name: "Create skill" })).toBeEnabled();
    expect(screen.getByText("1 of 1 accepted selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Deselect all" }));
    expect(screen.getByText("0 of 1 accepted selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create skill" })).toBeDisabled();
  });

  it("Create skill asks the server for a draft over the SELECTED ids and opens the modal on it", async () => {
    replies["/repos/r1/conventions/skill"] = {
      status: 200,
      body: {
        name: "acme-api-conventions",
        description: "House rules",
        type: "convention",
        body: "# Conventions",
        evidence_files: ["src/lib/hooks/skills.ts"],
        convention_ids: ["c3"],
      },
    };
    replies["/agents"] = { status: 200, body: [] };
    replies["/skills/tokens"] = { status: 200, body: { tokens: 3 } };
    renderView();
    await screen.findAllByTestId("candidate-card");

    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(await screen.findByLabelText("Name")).toHaveValue("acme-api-conventions");
    expect(calls()).toContainEqual({
      method: "POST",
      path: "/repos/r1/conventions/skill",
      body: { convention_ids: ["c3"] },
    });
    // the draft persists nothing
    expect(calls().some((c) => c.path === "/skills/extracted")).toBe(false);
  });

  it("a failed draft closes the modal and says so", async () => {
    replies["/repos/r1/conventions/skill"] = {
      status: 500,
      body: { error: { code: "internal", message: "boom" } },
    };
    renderView();
    await screen.findAllByTestId("candidate-card");

    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Could not assemble the skill draft."),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
