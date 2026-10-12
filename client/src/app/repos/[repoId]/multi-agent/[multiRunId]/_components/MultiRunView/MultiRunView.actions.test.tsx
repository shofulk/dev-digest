import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within, act } from "@testing-library/react";
import {
  ResultsTestProviders,
  column,
  installEventSource,
  installFetch,
  multiRun,
  review,
  type Reply,
} from "@/test/multi-agent-results-intl";

/* SPEC-05 / SPEC-06, fix round 3, C16 (T41): the pending state of a column action is kept per
   agent, and the results page's load-error body never shows the raw API message. The page runs
   on the app's real `Providers` (M6), so its global QueryCache toasts a query error. */

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

function renderView() {
  render(
    <ResultsTestProviders>
      <MultiRunView />
    </ResultsTestProviders>,
  );
}

/** A reply the test settles by hand. */
function deferred() {
  let settle!: (r: Reply) => void;
  const promise = new Promise<Reply>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

beforeEach(() => {
  nav.query = "";
  installEventSource();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("results page per-agent pending", () => {
  it("C16 / AC-52 / AC-54: settling Retry on one agent leaves another agent's in-flight Cancel disabled", async () => {
    const retry = deferred();
    const cancel = deferred();
    installFetch({
      "GET /multi-agent-runs/mr1": {
        status: 200,
        body: multiRun({
          columns: [
            column({ agent_id: "a1", agent_name: "Agent a1", status: "failed", score: null, error: "boom" }),
            column({ agent_id: "a2", agent_name: "Agent a2", status: "running", score: null, duration_ms: null }),
          ],
        }),
      },
      "GET /pulls/pr1": { status: 200, body: { id: "pr1", number: 482, title: "Harden auth" } },
      "GET /pulls/pr1/reviews": { status: 200, body: [review("a1", []), review("a2", [])] },
      "POST /multi-agent-runs/mr1/agents/a1/retry": () => retry.promise,
      "POST /runs/run-a2/cancel": () => cancel.promise,
    });
    renderView();

    const a1 = within(await screen.findByRole("region", { name: "Agent a1" }));
    const a2 = within(await screen.findByRole("region", { name: "Agent a2" }));
    fireEvent.click(a1.getByRole("button", { name: "Retry" }));
    fireEvent.click(a2.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(a2.getByRole("button", { name: "Cancel" })).toBeDisabled());

    // A's retry fails: its mutation settles (the toast is the observable signal), B's is still in flight
    await act(async () => {
      retry.settle({ status: 500, body: { error: { message: "retry boom" } } });
    });
    expect(await screen.findByText("retry boom")).toBeInTheDocument();
    await act(async () => {});

    expect(a2.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(a1.getByRole("button", { name: "Retry" })).toBeEnabled();
  });
});

describe("results page load error", () => {
  async function renderFailing() {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installFetch({
      "GET /multi-agent-runs/mr1": { status: 500, body: { error: { message: "db exploded" } } },
    });
    renderView();
    // `retryRead` backs off 1 s, then 2 s, before the query reaches `isError`
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    return screen.findByRole("alert");
  }

  it("C16 / AC-66: a 500 answer shows the fixed body, never the raw API message", async () => {
    const alert = await renderFailing();

    expect(within(alert).getByText("The multi-agent run could not be loaded.")).toBeInTheDocument();
    expect(alert).not.toHaveTextContent("db exploded");
  });

  it("C16 / M6: the same 500 raises exactly one toast through the app's global QueryCache", async () => {
    await renderFailing();

    const toasts = screen.getByRole("status");
    expect(within(toasts).getAllByText("db exploded")).toHaveLength(1);
  });
});
