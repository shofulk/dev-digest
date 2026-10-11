import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCompare, EvalSuiteRun } from "@devdigest/shared/contracts/eval-ci";
import messages from "../../../../../../../../../../messages/en/eval.json";

let state: { data?: EvalCompare; isLoading: boolean; isError: boolean };
vi.mock("@/lib/hooks/eval", () => ({
  useEvalCompare: () => ({ ...state, refetch: vi.fn() }),
}));

import { CompareModal } from "./CompareModal";

afterEach(cleanup);

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
  cost_usd: null,
  ...over,
});

const COMPARE: EvalCompare = {
  a: run({ run_id: "ra", agent_version: 1 }),
  b: run({ run_id: "rb", agent_version: 2, recall: 0.8, precision: 0.5, traces_passed: 3 }),
  delta: { recall: 0.2, precision: -0.25, citation_accuracy: null, cost_usd: null },
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

function renderModal() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <CompareModal runA="ra" runB="rb" onClose={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe("CompareModal", () => {
  it("renders signed, toned deltas and a dash for a null side", () => {
    state = { data: COMPARE, isLoading: false, isError: false };
    renderModal();
    const tiles = screen.getAllByTestId("compare-tile");
    const recall = within(tiles[0]!);
    expect(recall.getByText("0.60 → 0.80")).toBeInTheDocument();
    expect(recall.getByText("+0.20")).toHaveAttribute("data-tone", "up");
    const precision = within(tiles[1]!);
    expect(precision.getByText("−0.25")).toHaveAttribute("data-tone", "down");
    const citation = within(tiles[2]!);
    expect(citation.getByText("— → —")).toBeInTheDocument();
  });

  it("prefixes added and removed prompt lines and lists the flipped case", () => {
    state = { data: COMPARE, isLoading: false, isError: false };
    renderModal();
    expect(screen.getByText(/^\+ Be thorough\.$/)).toHaveAttribute("data-op", "add");
    expect(screen.getByText(/^− Be terse\.$/)).toHaveAttribute("data-op", "del");
    expect(screen.getByText("leaky-key: pass → fail")).toBeInTheDocument();
    expect(screen.getByText(/new-case/)).toBeInTheDocument();
    expect(screen.getByText("v1 → v2")).toBeInTheDocument();
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
});
