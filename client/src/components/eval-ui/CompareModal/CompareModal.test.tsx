import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import type { EvalCompare, EvalSuiteRun } from "@devdigest/shared/contracts/eval-ci";
import messages from "../../../../messages/en/eval.json";

let state: { data?: EvalCompare; isLoading: boolean; isError: boolean };
let agentState: { data?: Agent };
const restoreMutate = vi.fn();
let restorePending = false;
vi.mock("@/lib/hooks/eval", () => ({
  useEvalCompare: () => ({ ...state, refetch: vi.fn() }),
}));
vi.mock("@/lib/hooks/agents", () => ({
  useAgent: () => agentState,
  useRestoreAgentVersion: () => ({ mutate: restoreMutate, isPending: restorePending }),
}));
const notifySuccess = vi.fn();
vi.mock("@/lib/toast", () => ({ notify: { success: (m: string) => notifySuccess(m), error: vi.fn() } }));

import { CompareModal } from "./CompareModal";

beforeEach(() => {
  agentState = { data: { id: "ag1", version: 5 } as unknown as Agent };
});
afterEach(() => {
  cleanup();
  restorePending = false;
  restoreMutate.mockReset();
  notifySuccess.mockReset();
});

const run = (over: Partial<EvalSuiteRun>): EvalSuiteRun => ({
  run_id: "r",
  agent_id: "ag1",
  status: "completed",
  agent_version: 1,
  started_at: "2026-10-01T10:00:00Z",
  finished_at: "2026-10-01T10:05:00Z",
  cases_total: 4,
  cases_done: 4,
  recall: 0.6,
  precision: 0.75,
  citation_accuracy: null,
  traces_passed: 2,
  traces_total: 4,
  cases_errored: 0,
  duration_ms: 1000,
  cost_usd: 0.01,
  ...over,
});

const COMPARE: EvalCompare = {
  a: run({ run_id: "ra", agent_version: 1 }),
  b: run({ run_id: "rb", agent_version: 3, recall: 0.8, precision: 0.5, traces_passed: 3, cost_usd: 0.02 }),
  delta: { recall: 0.2, precision: -0.25, citation_accuracy: null, cost_usd: 0.01 },
  flips: [{ case_id: "c1", name: "leaky-key", a_pass: true, b_pass: false, direction: "pass_to_fail" }],
  only_in_a: [],
  only_in_b: [{ case_id: "c9", name: "new-case" }],
  prompt_diff: [
    { op: "same", text: "You review code." },
    { op: "del", text: "Be terse." },
    { op: "add", text: "Be thorough." },
  ],
  prompt_available: true,
};

function renderModal(onClose = () => {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <CompareModal runA="ra" runB="rb" onClose={onClose} />
    </NextIntlClientProvider>,
  );
}

describe("CompareModal", () => {
  it("AC37: titles the comparison by version and shows the four tiles with signed, toned deltas", () => {
    state = { data: COMPARE, isLoading: false, isError: false };
    renderModal();
    expect(screen.getByText("Compare runs · v1 → v3")).toBeInTheDocument();
    expect(screen.getByText("Old prompt vs new")).toBeInTheDocument();
    const tiles = screen.getAllByTestId("compare-tile");
    expect(tiles.map((x) => x.firstChild?.textContent)).toEqual(["RECALL", "PRECISION", "CITATION", "COST"]);
    const recall = within(tiles[0]!);
    expect(recall.getByText("0.60 → 0.80")).toBeInTheDocument();
    expect(recall.getByText("+0.20")).toHaveAttribute("data-tone", "up");
    expect(within(tiles[1]!).getByText("−0.25")).toHaveAttribute("data-tone", "down");
    expect(within(tiles[2]!).getByText("— → —")).toBeInTheDocument();
    expect(screen.queryByText("PASSED")).not.toBeInTheDocument();
  });

  it("AC37: a cost increase is red (down tone), a decrease green", () => {
    state = { data: COMPARE, isLoading: false, isError: false };
    renderModal();
    const cost = within(screen.getAllByTestId("compare-tile")[3]!);
    expect(cost.getByText("$0.01 → $0.02")).toBeInTheDocument();
    expect(cost.getByText("+$0.01")).toHaveAttribute("data-tone", "down");
    cleanup();

    state = { data: { ...COMPARE, delta: { ...COMPARE.delta, cost_usd: -0.005 } }, isLoading: false, isError: false };
    renderModal();
    expect(within(screen.getAllByTestId("compare-tile")[3]!).getByText("−$0.005")).toHaveAttribute("data-tone", "up");
  });

  it("AC37: legend names both versions; added and removed lines keep their prefix and data-op; flips are listed", () => {
    state = { data: COMPARE, isLoading: false, isError: false };
    renderModal();
    expect(screen.getByText("v1 (old)")).toBeInTheDocument();
    expect(screen.getByText("v3 (new)")).toBeInTheDocument();
    expect(screen.getByText(/^\+ Be thorough\.$/)).toHaveAttribute("data-op", "add");
    expect(screen.getByText(/^− Be terse\.$/)).toHaveAttribute("data-op", "del");
    expect(screen.getByText("leaky-key: pass → fail")).toBeInTheDocument();
    expect(screen.getByText(/new-case/)).toBeInTheDocument();
  });

  it("explains an unavailable prompt instead of an empty diff", () => {
    state = { data: { ...COMPARE, prompt_available: false, prompt_diff: [] }, isLoading: false, isError: false };
    renderModal();
    expect(screen.getByText(/was not stored/)).toBeInTheDocument();
  });

  it("shows an error state with retry", () => {
    state = { isLoading: false, isError: true };
    renderModal();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("AC37/AC38: Promote is offered when the newer version is not current, and restores it", () => {
    state = { data: COMPARE, isLoading: false, isError: false };
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Promote v3" }));
    expect(restoreMutate).toHaveBeenCalledWith({ id: "ag1", version: 3 }, expect.any(Object));
  });

  it("AC38: a successful promote toasts and closes", () => {
    state = { data: COMPARE, isLoading: false, isError: false };
    const onClose = vi.fn();
    restoreMutate.mockImplementation((_v, o: { onSuccess: (a: Agent) => void }) =>
      o.onSuccess({ version: 6 } as unknown as Agent),
    );
    renderModal(onClose);
    fireEvent.click(screen.getByRole("button", { name: "Promote v3" }));
    expect(notifySuccess).toHaveBeenCalledWith("v3 restored as v6");
    expect(onClose).toHaveBeenCalled();
  });

  it("AC38: Promote is disabled while the restore mutation is pending", () => {
    state = { data: COMPARE, isLoading: false, isError: false };
    renderModal();
    expect(screen.getByRole("button", { name: "Promote v3" })).toBeEnabled();
    cleanup();

    restorePending = true;
    renderModal();
    expect(screen.getByRole("button", { name: /Promote v3/ })).toBeDisabled();
  });

  it("AC37: Promote is hidden when v3 is current, when the prompt is unavailable and while the agent loads", () => {
    state = { data: COMPARE, isLoading: false, isError: false };
    agentState = { data: { id: "ag1", version: 3 } as unknown as Agent };
    renderModal();
    expect(screen.queryByRole("button", { name: /Promote/ })).not.toBeInTheDocument();
    cleanup();

    agentState = { data: { id: "ag1", version: 5 } as unknown as Agent };
    state = { data: { ...COMPARE, prompt_available: false }, isLoading: false, isError: false };
    renderModal();
    expect(screen.queryByRole("button", { name: /Promote/ })).not.toBeInTheDocument();
    cleanup();

    agentState = {};
    state = { data: COMPARE, isLoading: false, isError: false };
    renderModal();
    expect(screen.queryByRole("button", { name: /Promote/ })).not.toBeInTheDocument();
  });

  it("Close calls onClose", () => {
    state = { data: COMPARE, isLoading: false, isError: false };
    const onClose = vi.fn();
    renderModal(onClose);
    // The header carries an X icon button labelled "Close" too; the footer one is the last.
    fireEvent.click(screen.getAllByRole("button", { name: "Close" }).pop()!);
    expect(onClose).toHaveBeenCalled();
  });
});
