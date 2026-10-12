import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

const actionMutate = vi.fn();
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: actionMutate, isPending: false }),
}));

const draftMutate = vi.fn();
let draftPending = false;
vi.mock("../../../../../../../lib/hooks/eval", () => ({
  useEvalCaseDraft: () => ({ mutate: draftMutate, isPending: draftPending }),
}));

vi.mock("../../../../../../../components/eval-ui/EvalCaseModal", () => ({
  EvalCaseModal: ({
    agentId,
    source,
    returnFocusTo,
  }: {
    agentId: string;
    source: { kind: string; alreadyInSet?: boolean };
    returnFocusTo?: HTMLElement | null;
  }) => (
    <div data-testid="case-modal">
      {`${source.kind}|${agentId}|${source.alreadyInSet ? "already" : "fresh"}|${returnFocusTo?.tagName}`}
    </div>
  ),
}));

vi.mock("../../../../../../../lib/hooks/multi-agent", () => ({
  useLearnFinding: () => ({ mutate: vi.fn(), isPending: false }),
}));

const notifySuccess = vi.fn();
const notifyError = vi.fn();
vi.mock("../../../../../../../lib/toast", () => ({
  notify: { success: (m: string) => notifySuccess(m), error: (m: string) => notifyError(m) },
}));

import { ApiError } from "../../../../../../../lib/api";
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
  const accepted = { ...FINDINGS[0]!, accepted_at: "2026-10-01T00:00:00Z" };
  const EXISTING = { id: "c1", name: "saved" };
  const DRAFT = { name: "draft" };

  beforeEach(() => {
    draftMutate.mockReset();
    notifyError.mockClear();
    draftPending = false;
  });

  /** Click the action; the draft mutation answers via the given callback. */
  function clickWith(answer: (opts: { onSuccess: (r: unknown) => void; onError: (e: Error) => void }) => void) {
    draftMutate.mockImplementationOnce((_id: string, opts: never) => answer(opts));
    renderWithIntl(<FindingsPanel findings={[accepted]} prId="pr1" />);
    fireEvent.click(screen.getByRole("button", { name: /Turn into eval case/ }));
  }

  it("asks for the draft by finding id, and opens the modal on the draft with the agent id", () => {
    clickWith((o) => o.onSuccess({ agent_id: "ag1", existing_case: null, draft: DRAFT }));
    expect(draftMutate.mock.calls[0]![0]).toBe("f1");
    expect(screen.getByTestId("case-modal")).toHaveTextContent("finding|ag1|fresh|BUTTON");
  });

  it("opens the modal in edit mode, flagged already in the set, when a case exists", () => {
    clickWith((o) => o.onSuccess({ agent_id: "ag1", existing_case: EXISTING, draft: null }));
    expect(screen.getByTestId("case-modal")).toHaveTextContent("edit|ag1|already|BUTTON");
  });

  it("shows the translated message for a known error code and opens no modal", () => {
    clickWith((o) => o.onError(new ApiError("no diff", 422, "no_diff_available")));
    expect(notifyError).toHaveBeenCalledWith("This file has no stored diff to freeze into a case");
    expect(screen.queryByTestId("case-modal")).not.toBeInTheDocument();
  });

  it("falls back to the generic failure for an unknown code, and for an answer with neither case nor draft", () => {
    clickWith((o) => o.onError(new ApiError("500 Internal Server Error", 500)));
    expect(notifyError).toHaveBeenCalledWith("Could not create the eval case");
    cleanup();
    notifyError.mockClear();
    clickWith((o) => o.onSuccess({ agent_id: "ag1", existing_case: null, draft: null }));
    expect(notifyError).toHaveBeenCalledWith("Could not create the eval case");
    expect(screen.queryByTestId("case-modal")).not.toBeInTheDocument();
  });

  it("disables the button while the draft is pending", () => {
    draftPending = true;
    renderWithIntl(<FindingsPanel findings={[accepted]} prId="pr1" />);
    expect(screen.getByRole("button", { name: /Turn into eval case/ })).toBeDisabled();
  });
});

describe("FindingsPanel keyboard shortcuts", () => {
  const DISMISS = { findingId: "f1", action: "dismiss", prId: "pr1" };
  const press = (target: Element, key = "d") => fireEvent.keyDown(target, { key });

  beforeEach(() => {
    actionMutate.mockReset();
    draftMutate.mockReset();
    draftPending = false;
  });

  it("dismisses the focused finding on d, but not while the eval modal is open", () => {
    // Opening the (mocked) modal is what sets the panel's evalModal state.
    draftMutate.mockImplementationOnce((_id: string, opts: { onSuccess: (r: unknown) => void }) =>
      opts.onSuccess({ agent_id: "ag1", existing_case: null, draft: { name: "draft" } }),
    );
    renderWithIntl(<FindingsPanel findings={[{ ...FINDINGS[0]!, accepted_at: "2026-10-01T00:00:00Z" }]} prId="pr1" />);

    // Positive control: modal closed, the key reaches the action.
    expect(screen.queryByTestId("case-modal")).not.toBeInTheDocument();
    press(document.body);
    expect(actionMutate).toHaveBeenCalledTimes(1);
    expect(actionMutate).toHaveBeenLastCalledWith(DISMISS);

    // Same key with the modal open: nothing more is dispatched.
    fireEvent.click(screen.getByRole("button", { name: /Turn into eval case/ }));
    expect(screen.getByTestId("case-modal")).toBeInTheDocument();
    press(document.body);
    expect(actionMutate).toHaveBeenCalledTimes(1);
  });

  it("ignores d when focus is on a SELECT, inside a [role=dialog], or on a contentEditable element", () => {
    renderWithIntl(
      <div>
        <FindingsPanel findings={FINDINGS} prId="pr1" />
        <select aria-label="picker">
          <option value="x">x</option>
        </select>
        <div role="dialog">
          <button type="button">inside dialog</button>
        </div>
        <div aria-label="editor" />
      </div>,
    );
    // jsdom does not implement isContentEditable, so the editor flags itself the way a browser does.
    const editor = screen.getByLabelText("editor");
    Object.defineProperty(editor, "isContentEditable", { value: true });

    // Positive control first, so the ignores below cannot be a dead handler.
    press(document.body);
    expect(actionMutate).toHaveBeenCalledTimes(1);

    press(screen.getByRole("combobox", { name: "picker" }));
    press(within(screen.getByRole("dialog")).getByRole("button", { name: "inside dialog" }));
    press(editor);
    expect(actionMutate).toHaveBeenCalledTimes(1);

    // Rejected key: an unmapped or upper-case key never dispatches, even from the body.
    press(document.body, "D");
    press(document.body, "x");
    expect(actionMutate).toHaveBeenCalledTimes(1);

    // And the plain target still works after all of that.
    press(document.body);
    expect(actionMutate).toHaveBeenCalledTimes(2);
    expect(actionMutate).toHaveBeenLastCalledWith(DISMISS);
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
