import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

const createEvalCase = vi.fn();
vi.mock("../../../../../../../lib/hooks/eval", () => ({
  useCreateEvalCase: () => ({ mutate: createEvalCase, isPending: false }),
}));

const notifySuccess = vi.fn();
vi.mock("../../../../../../../lib/toast", () => ({
  notify: { success: (m: string) => notifySuccess(m), error: vi.fn() },
}));

import { FindingsPanel } from "./FindingsPanel";
import { visibleFindings } from "./helpers";

afterEach(cleanup);

const BASE: Omit<FindingRecord, "id" | "severity" | "title" | "confidence"> = {
  category: "security",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "Because.",
  suggestion: null,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

const MIXED: FindingRecord[] = [
  { ...BASE, id: "s1", severity: "SUGGESTION", title: "Extract magic number", confidence: 0.62 },
  { ...BASE, id: "c1", severity: "CRITICAL", title: "Hardcoded secret key", confidence: 0.95 },
  { ...BASE, id: "c2", severity: "CRITICAL", title: "Unverified webhook", confidence: 0.4 },
  { ...BASE, id: "w1", severity: "WARNING", title: "N+1 query", confidence: 0.86 },
];

const FINDINGS: FindingRecord[] = [
  {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A secret is committed.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  },
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });

  it("renders only the selected severity", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" severity="CRITICAL" />);
    expect(screen.getByText("Hardcoded secret key")).toBeInTheDocument();
    expect(screen.getByText("Unverified webhook")).toBeInTheDocument();
    expect(screen.queryByText("N+1 query")).not.toBeInTheDocument();
    expect(screen.queryByText("Extract magic number")).not.toBeInTheDocument();
  });

  it("shows the empty state when the selected severity has no findings", () => {
    const noCriticals = MIXED.filter((f) => f.severity !== "CRITICAL");
    renderWithIntl(<FindingsPanel findings={noCriticals} prId="pr1" severity="CRITICAL" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });
});

describe("FindingsPanel eval-case action", () => {
  it("passes the accepted finding's id to the create-eval-case mutation", () => {
    const accepted = { ...FINDINGS[0]!, accepted_at: "2026-10-01T00:00:00Z" };
    renderWithIntl(<FindingsPanel findings={[accepted]} prId="pr1" />);
    fireEvent.click(screen.getByRole("button", { name: /Turn into eval case/ }));
    expect(createEvalCase).toHaveBeenCalledTimes(1);
    expect(createEvalCase.mock.calls[0]![0]).toBe("f1");
  });
});

describe("FindingsPanel eval-case toast", () => {
  const accepted = { ...FINDINGS[0]!, accepted_at: "2026-10-01T00:00:00Z" };

  /** Click the action and let the mutation succeed with the given `created` flag. */
  function clickAndSucceed(created: boolean) {
    createEvalCase.mockImplementationOnce((_id: string, opts: { onSuccess: (r: { created: boolean }) => void }) =>
      opts.onSuccess({ created }),
    );
    renderWithIntl(<FindingsPanel findings={[accepted]} prId="pr1" />);
    fireEvent.click(screen.getByRole("button", { name: /Turn into eval case/ }));
  }

  it("says the case was created when the server created it", () => {
    notifySuccess.mockClear();
    clickAndSucceed(true);
    expect(notifySuccess).toHaveBeenCalledWith("Eval case created");
  });

  it("says it is already in the eval set when the server reused an existing case", () => {
    notifySuccess.mockClear();
    clickAndSucceed(false);
    expect(notifySuccess).toHaveBeenCalledWith("Already in the eval set");
  });
});

describe("visibleFindings", () => {
  it("keeps everything and sorts by severity when unfiltered", () => {
    const shown = visibleFindings(MIXED, { hideLow: false, severity: null });
    expect(shown.map((f) => f.severity)).toEqual([
      "CRITICAL",
      "CRITICAL",
      "WARNING",
      "SUGGESTION",
    ]);
  });

  it("keeps ties in input order, so j/k is deterministic", () => {
    const shown = visibleFindings(MIXED, { hideLow: false, severity: null });
    expect(shown.slice(0, 2).map((f) => f.id)).toEqual(["c1", "c2"]);
  });

  it("filters by severity even though criticals sort first", () => {
    const shown = visibleFindings(MIXED, { hideLow: false, severity: "WARNING" });
    expect(shown.map((f) => f.id)).toEqual(["w1"]);
  });

  it("composes severity with hideLow", () => {
    const shown = visibleFindings(MIXED, { hideLow: true, severity: "CRITICAL" });
    expect(shown.map((f) => f.id)).toEqual(["c1"]);
  });

  it("returns an empty list, without throwing, when nothing matches", () => {
    const shown = visibleFindings(
      MIXED.filter((f) => f.severity !== "SUGGESTION"),
      { hideLow: false, severity: "SUGGESTION" },
    );
    expect(shown).toEqual([]);
  });

  it("does not mutate its input", () => {
    const order = MIXED.map((f) => f.id);
    visibleFindings(MIXED, { hideLow: false, severity: null });
    expect(MIXED.map((f) => f.id)).toEqual(order);
  });
});
