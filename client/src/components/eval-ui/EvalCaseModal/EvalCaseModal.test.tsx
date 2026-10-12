import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCaseDraft, EvalDryRunResult } from "@devdigest/shared/contracts/eval-ci";
import type { EvalCase } from "@devdigest/shared/contracts/knowledge";
import messages from "../../../../messages/en/eval.json";

type Opts = { onSuccess?: (r: unknown) => void; onError?: (e: Error) => void };

let agentBusy = false;
let dryRunPending = false;
const createMutate = vi.fn();
const updateMutate = vi.fn();
const fromFindingMutate = vi.fn();
const dryRunMutate = vi.fn();
vi.mock("@/lib/hooks/eval", () => ({
  useAgentEvalBusy: () => agentBusy,
  useCreateEvalCaseByHand: () => ({ mutate: createMutate, isPending: false }),
  useUpdateEvalCase: () => ({ mutate: updateMutate, isPending: false }),
  useSaveEvalCaseFromFinding: () => ({ mutate: fromFindingMutate, isPending: false }),
  useDryRunEvalCase: () => ({ mutate: dryRunMutate, isPending: dryRunPending }),
}));
const notifySuccess = vi.fn();
vi.mock("@/lib/toast", () => ({ notify: { success: (m: string) => notifySuccess(m), error: vi.fn() } }));

import { ApiError } from "@/lib/api";
import { EvalCaseModal, type EvalCaseModalSource } from "./EvalCaseModal";

const DIFF = "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n+x\n--- a/src/b.ts\n+++ b/src/b.ts\n@@ -1 +1 @@\n+y\n";

const draft: EvalCaseDraft = {
  name: "from-finding",
  input_diff: DIFF,
  input_files: ["src/a.ts"],
  pr_title: "T",
  pr_body: null,
  expectation: {
    type: "must_not_flag",
    file: "src/a.ts",
    start_line: 1,
    end_line: 2,
    severity: "WARNING",
    category: "perf",
    title: "slow loop",
  },
  notes: null,
};

const storedCase = (meta: Record<string, unknown> | null): EvalCase =>
  ({
    id: "c1",
    owner_kind: "agent",
    owner_id: "ag1",
    name: "stored",
    input_diff: DIFF,
    input_files: null,
    input_meta: meta,
    expected_output: {
      type: "must_find",
      file: "src/a.ts",
      start_line: 1,
      end_line: 1,
      severity: "CRITICAL",
      category: "bug",
      title: "t",
    },
    notes: null,
  }) as unknown as EvalCase;

const dryResult: EvalDryRunResult = {
  pass: true,
  findings: [
    { file: "src/a.ts", start_line: 1, end_line: 1, severity: "CRITICAL", category: "bug", title: "Hit one", matched: true },
    { file: "src/b.ts", start_line: 3, end_line: 4, severity: "WARNING", category: "style", title: "Stray one", matched: false },
  ],
  grounding_kept: 2,
  grounding_dropped: 1,
  cost_usd: 0.0123,
  duration_ms: 2500,
  agent_version: 7,
};

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  agentBusy = false;
  dryRunPending = false;
  for (const m of [createMutate, updateMutate, fromFindingMutate, dryRunMutate, notifySuccess]) m.mockReset();
  // NFR-6: any IntlError (missing key) is logged through console.error.
  const logged = errorSpy.mock.calls.length;
  errorSpy.mockRestore();
  expect(logged).toBe(0);
});

function renderModal(source: EvalCaseModalSource = { kind: "new" }, extra: { returnFocusTo?: HTMLElement } = {}) {
  const onClose = vi.fn();
  const tree = () => (
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <EvalCaseModal agentId="ag1" source={source} onClose={onClose} {...extra} />
    </NextIntlClientProvider>
  );
  const view = render(tree());
  /** Re-render the same modal after a mocked hook value changed (state is kept). */
  const refresh = () => view.rerender(tree());
  return { onClose, refresh, ...view };
}

/** Valid line numbers; the client blocks Save and Run case without them. */
const fillLines = (start = "1", end = "2") => {
  change("Start line", start);
  change("End line", end);
};

const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const lastOpts = (m: ReturnType<typeof vi.fn>) => m.mock.calls.at(-1)![1] as Opts;
/** Settle the last mutate call the way react-query would, inside act. */
const succeed = (m: ReturnType<typeof vi.fn>, data: unknown) => act(() => lastOpts(m).onSuccess!(data));
const fail = (m: ReturnType<typeof vi.fn>, err: Error) => act(() => lastOpts(m).onError!(err));
/** The wrapper of one labelled field (label + control + its inline error). */
const fieldOf = (label: string) => screen.getByText(label, { selector: "label" }).parentElement!;
const diffPre =() => screen.getByText(/\+\+\+ b\/src\/a\.ts/, { selector: "pre" });

describe("EvalCaseModal layout", () => {
  it("renders the new-case form with Diff and PR meta tabs that keep typed values, and focusable controls", () => {
    renderModal();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("New eval case")).toBeInTheDocument();

    change("Name", "my-case");
    change("Diff", DIFF);
    // File options come from the typed diff.
    const file = screen.getByLabelText("File") as HTMLSelectElement;
    expect([...file.options].map((o) => o.value)).toEqual(["", "src/a.ts", "src/b.ts"]);
    fireEvent.change(file, { target: { value: "src/b.ts" } });
    change("Start line", "3");
    change("End line", "4");
    change("Severity", "CRITICAL");
    change("Category", "security");
    change("Finding title", "Leak");
    change("Notes", "why");

    // PR meta tab, then back: typed values survive.
    fireEvent.click(screen.getByRole("button", { name: "PR meta" }));
    expect(screen.queryByLabelText("Diff")).toBeNull();
    change("Title", "PR title");
    change("Body", "PR body");
    fireEvent.click(screen.getByRole("button", { name: "Diff" }));
    expect(screen.getByLabelText("Diff")).toHaveValue(DIFF);
    expect(screen.getByLabelText("Name")).toHaveValue("my-case");
    fireEvent.click(screen.getByRole("button", { name: "PR meta" }));
    expect(screen.getByLabelText("Title")).toHaveValue("PR title");

    expect(screen.getByRole("button", { name: "Run case" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();

    // NFR-5: nothing is taken out of the tab order.
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("[tabindex='-1']")).toBeNull();
  });
});

describe("EvalCaseModal read-only sources", () => {
  it("keeps the type and the diff read-only for a finding source", () => {
    renderModal({ kind: "finding", findingId: "f1", draft });
    expect(screen.getByLabelText("Name")).toHaveValue("from-finding");
    expect(screen.getByText("must not flag").tagName).toBe("SPAN");
    expect(screen.queryByRole("combobox", { name: "Type" })).toBeNull();
    expect(diffPre()).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Diff" })).toBeNull();
    expect(screen.getByText("The type and the diff come from the finding and cannot be changed.")).toBeInTheDocument();
  });

  it("locks an edited from-finding case, leaves a hand-written one editable, and flags alreadyInSet", () => {
    const { unmount } = renderModal({ kind: "edit", evalCase: storedCase({ source_finding_id: "f9" }), alreadyInSet: true });
    expect(screen.getByText("must find").tagName).toBe("SPAN");
    expect(screen.queryByRole("combobox", { name: "Type" })).toBeNull();
    expect(diffPre()).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Diff" })).toBeNull();
    expect(screen.getByText("Already in the eval set")).toBeInTheDocument();
    unmount();

    renderModal({ kind: "edit", evalCase: storedCase(null) });
    expect(screen.getByRole("combobox", { name: "Type" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Diff" })).toBeInTheDocument();
    expect(screen.queryByText("Already in the eval set")).toBeNull();
  });
});

describe("EvalCaseModal Run case", () => {
  it("sends the form to the dry run and renders the verdict, matched markers, grounding and cost", () => {
    renderModal();
    change("Name", "n");
    change("Diff", DIFF);
    change("Start line", "1");
    change("End line", "2");
    click("Run case");

    expect(dryRunMutate).toHaveBeenCalledTimes(1);
    const fields = dryRunMutate.mock.calls[0]![0];
    expect(fields).toMatchObject({
      name: "n",
      input_diff: DIFF,
      expectation: { type: "must_find", start_line: 1, end_line: 2 },
    });

    // Before the run settles there is no result box.
    expect(screen.queryByTestId("dry-run-result")).toBeNull();
    succeed(dryRunMutate, dryResult);
    const box = screen.getByTestId("dry-run-result");
    expect(within(box).getByText("Pass")).toBeInTheDocument();
    // Each finding row carries its own marker.
    const hit = within(box).getByText("Hit one").parentElement!;
    expect(within(hit).getByText("matched")).toBeInTheDocument();
    expect(within(hit).queryByText("no match")).toBeNull();
    const stray = within(box).getByText("Stray one").parentElement!;
    expect(within(stray).getByText("no match")).toBeInTheDocument();
    expect(within(stray).queryByText("matched")).toBeNull();
    expect(within(box).getByText("2 kept · 1 dropped")).toBeInTheDocument();
    expect(within(box).getByText("Cost $0.012")).toBeInTheDocument();
    expect(within(box).getByText("2.5s")).toBeInTheDocument();
    expect(within(box).getByText("Agent v7")).toBeInTheDocument();
  });

  it("shows Running… and disables the button while the dry run is pending", () => {
    dryRunPending = true;
    renderModal();
    const btn = screen.getByRole("button", { name: "Running…" });
    expect(btn).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Run case" })).toBeNull();
  });

  it("disables Run case while another run is in progress, and reads Running… only while its own dry run is pending", () => {
    const busyHint = "A run is already in progress for this agent.";

    // The agent is merely busy: the button keeps its label, is disabled, the hint explains why.
    agentBusy = true;
    const { refresh } = renderModal();
    expect(screen.getByRole("button", { name: "Run case" })).toBeDisabled();
    expect(screen.getByText(busyHint)).toBeInTheDocument();
    expect(screen.queryByText("Running…")).toBeNull();

    // This modal's own dry run is pending: only now does the label change.
    agentBusy = false;
    dryRunPending = true;
    refresh();
    expect(screen.getByRole("button", { name: "Running…" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Run case" })).toBeNull();
    expect(screen.queryByText(busyHint)).toBeNull();

    // Neither: the button is back and enabled.
    dryRunPending = false;
    refresh();
    expect(screen.getByRole("button", { name: "Run case" })).toBeEnabled();
    expect(screen.queryByText("Running…")).toBeNull();
    expect(screen.queryByText(busyHint)).toBeNull();
  });

  it("drops a shown dry-run result as soon as any field is edited", () => {
    renderModal();
    change("Name", "n");
    change("Diff", DIFF);
    fillLines("1", "2");

    const edits: [string, () => void][] = [
      ["name", () => change("Name", "n2")],
      ["diff", () => change("Diff", `${DIFF}+z\n`)],
      ["start line", () => change("Start line", "2")],
      ["end line", () => change("End line", "3")],
      ["severity", () => change("Severity", "CRITICAL")],
      ["notes", () => change("Notes", "why")],
      [
        "PR title",
        () => {
          click("PR meta");
          change("Title", "T");
        },
      ],
    ];
    for (const [, edit] of edits) {
      click("Run case");
      succeed(dryRunMutate, dryResult);
      expect(screen.getByTestId("dry-run-result")).toBeInTheDocument();
      edit();
      expect(screen.queryByTestId("dry-run-result")).toBeNull();
    }
    expect(dryRunMutate).toHaveBeenCalledTimes(edits.length);
  });

  it("sends nothing and shows the lines error in the expectation slot for bad line values, and sends once they are valid", () => {
    renderModal();
    change("Name", "n");
    change("Diff", DIFF);
    const message = "Start and end lines must be whole numbers of 1 or more, with the end not before the start";

    const bad: [string, string, string][] = [
      ["fractional start", "12.5", "20"],
      ["empty start", "", "5"],
      ["zero start", "0", "3"],
      ["end before start", "5", "4"],
    ];
    for (const [, start, end] of bad) {
      fillLines(start, end);
      click("Save");
      let alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent(message);
      expect(fieldOf("File")).toContainElement(alert);
      click("Run case");
      alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent(message);
      expect(fieldOf("File")).toContainElement(alert);
    }
    expect(createMutate).not.toHaveBeenCalled();
    expect(updateMutate).not.toHaveBeenCalled();
    expect(fromFindingMutate).not.toHaveBeenCalled();
    expect(dryRunMutate).not.toHaveBeenCalled();

    // Valid whole numbers are sent, and the error is gone.
    fillLines("3", "4");
    click("Save");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(createMutate).toHaveBeenCalledTimes(1);
    expect(createMutate.mock.calls[0]![0]).toMatchObject({ expectation: { start_line: 3, end_line: 4 } });
    click("Run case");
    expect(dryRunMutate).toHaveBeenCalledTimes(1);
    expect(dryRunMutate.mock.calls[0]![0]).toMatchObject({ expectation: { start_line: 3, end_line: 4 } });
  });
});

describe("EvalCaseModal Save", () => {
  it("toasts 'Eval case created' and closes after a new case is saved", () => {
    const { onClose } = renderModal();
    change("Name", "n");
    fillLines();
    expect(createMutate).not.toHaveBeenCalled();
    click("Save");
    expect(createMutate).toHaveBeenCalledTimes(1);
    expect(createMutate.mock.calls[0]![0]).toMatchObject({ name: "n", expectation: { start_line: 1, end_line: 2 } });
    // Sent, but not yet answered: no toast, still open.
    expect(notifySuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    lastOpts(createMutate).onSuccess!({});
    expect(notifySuccess).toHaveBeenCalledWith("Eval case created");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("toasts 'Eval case saved' after an edit and for a finding that was already in the set", () => {
    const first = renderModal({ kind: "edit", evalCase: storedCase(null) });
    click("Save");
    expect(updateMutate.mock.calls[0]![0]).toMatchObject({ caseId: "c1" });
    lastOpts(updateMutate).onSuccess!({});
    expect(notifySuccess).toHaveBeenLastCalledWith("Eval case saved");
    expect(first.onClose).toHaveBeenCalledTimes(1);
    first.unmount();

    const second = renderModal({ kind: "finding", findingId: "f1", draft });
    click("Save");
    expect(fromFindingMutate.mock.calls[0]![0]).toMatchObject({ findingId: "f1" });
    lastOpts(fromFindingMutate).onSuccess!({ created: false });
    expect(notifySuccess).toHaveBeenLastCalledWith("Eval case saved");
    expect(second.onClose).toHaveBeenCalledTimes(1);
    second.unmount();

    const third = renderModal({ kind: "finding", findingId: "f1", draft });
    click("Save");
    lastOpts(fromFindingMutate).onSuccess!({ created: true });
    expect(notifySuccess).toHaveBeenLastCalledWith("Eval case created");
    expect(third.onClose).toHaveBeenCalledTimes(1);
  });
});

describe("EvalCaseModal errors", () => {
  it("shows each API error beside its field, keeps the input and leaves the modal open", async () => {
    const { onClose } = renderModal();
    change("Name", "kept-name");
    change("Diff", DIFF);
    fillLines();

    // Before any API answer there is no error anywhere.
    click("Save");
    expect(screen.queryByRole("alert")).toBeNull();
    fail(createMutate, new ApiError("Name is invalid", 400, "invalid_name"));
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Name must be 1–120 characters");
    expect(screen.queryByText("Name is invalid")).toBeNull();
    expect(fieldOf("Name")).toContainElement(alert);

    click("Save");
    fail(createMutate, new ApiError("Not grounded", 422, "expectation_not_grounded"));
    const grounded = screen.getByText("The expectation must point at a line of the diff");
    expect(screen.queryByText("Not grounded")).toBeNull();
    expect(fieldOf("File")).toContainElement(grounded);
    expect(screen.queryByText("Name must be 1–120 characters")).toBeNull();

    click("Run case");
    fail(dryRunMutate, new ApiError("Run in flight", 409, "run_in_flight"));
    const flight = screen.getByText("A run is already in flight for this agent");
    expect(screen.queryByText("Run in flight")).toBeNull();
    expect(fieldOf("Name")).not.toContainElement(flight);
    expect(fieldOf("File")).not.toContainElement(flight);
    // "above the footer": the message precedes the footer buttons in document order.
    expect(flight.compareDocumentPosition(screen.getByRole("button", { name: "Save" }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.queryByText("The expectation must point at a line of the diff")).toBeNull();

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("kept-name");
    expect(screen.getByLabelText("Diff")).toHaveValue(DIFF);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("EvalCaseModal error copy", () => {
  it("renders the generic text for an unknown error code, not the server message", () => {
    renderModal();
    change("Name", "n");
    fillLines();
    click("Save");
    expect(screen.queryByText("Something went wrong")).toBeNull();
    fail(createMutate, new ApiError("kaboom from server", 500, "some_future_code"));
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.queryByText("kaboom from server")).toBeNull();
    // A plain Error carries no code at all and falls back the same way.
    click("Save");
    expect(screen.queryByText("Something went wrong")).toBeNull();
    fail(createMutate, new Error("boom"));
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.queryByText("boom")).toBeNull();
  });

  it("renders the translated label for dry_run_failed, not the server reason", () => {
    renderModal();
    fillLines();
    click("Run case");
    expect(screen.queryByText("The model call failed")).toBeNull();
    fail(dryRunMutate, new ApiError("upstream 502: boom", 502, "dry_run_failed"));
    expect(screen.getByText("The model call failed")).toBeInTheDocument();
    expect(screen.queryByText("upstream 502: boom")).toBeNull();
  });
});

describe("EvalCaseModal discard guard", () => {
  const backdrop = () => screen.getByRole("dialog").previousElementSibling as HTMLElement;

  it("closes at once from Cancel, Escape and the backdrop while the form is clean", () => {
    const { onClose } = renderModal();
    click("Cancel");
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(backdrop());
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(screen.queryByText("Discard changes?")).toBeNull();
  });

  it("asks 'Discard changes?' from Cancel, Escape and the backdrop once dirty; Keep editing keeps values, Discard closes", () => {
    const { onClose } = renderModal();
    change("Name", "typed");

    click("Cancel");
    expect(screen.getByText("Discard changes?")).toBeInTheDocument();
    expect(screen.getByText("Your edits to this case will be lost.")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByText("Discard changes?")).toBeNull();
    expect(screen.getByLabelText("Name")).toHaveValue("typed");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByText("Discard changes?")).toBeInTheDocument();
    // Escape on the confirmation dismisses only the confirmation.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Discard changes?")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(backdrop());
    expect(screen.getByText("Discard changes?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("EvalCaseModal focus", () => {
  const opener = () => {
    const el = document.createElement("button");
    document.body.appendChild(el);
    return el;
  };
  const tab = (from: HTMLElement, shiftKey = false) => fireEvent.keyDown(from, { key: "Tab", shiftKey });

  it("moves focus to the name input on open", () => {
    const before = opener();
    before.focus();
    expect(before).toHaveFocus();

    renderModal({ kind: "new" }, { returnFocusTo: before });
    expect(screen.getByLabelText("Name")).toHaveFocus();
    expect(before).not.toHaveFocus();
    before.remove();
  });

  it("wraps Tab from the last control to the first and Shift+Tab from the first to the last, and lets every other Tab through", () => {
    const outside = opener();
    renderModal();
    const first = screen.getByRole("button", { name: "Close" });
    const last = screen.getByRole("button", { name: "Save" });
    const middle = screen.getByLabelText("Notes");

    // Forward: last -> first, and the browser's own move is cancelled.
    last.focus();
    expect(tab(last)).toBe(false);
    expect(first).toHaveFocus();
    expect(last).not.toHaveFocus();

    // Backward: first -> last.
    expect(tab(first, true)).toBe(false);
    expect(last).toHaveFocus();
    expect(first).not.toHaveFocus();

    // Rejected positions: a middle control, the first going forward and the last going backward are untouched.
    middle.focus();
    expect(tab(middle)).toBe(true);
    expect(middle).toHaveFocus();
    first.focus();
    expect(tab(first)).toBe(true);
    expect(first).toHaveFocus();
    last.focus();
    expect(tab(last, true)).toBe(true);
    expect(last).toHaveFocus();
    // Any other key at the edge is not a Tab and does nothing.
    expect(fireEvent.keyDown(last, { key: "Enter" })).toBe(true);
    expect(last).toHaveFocus();

    // Focus that already escaped the dialog is pulled back to its first control.
    outside.focus();
    expect(outside).toHaveFocus();
    tab(screen.getByRole("dialog"));
    expect(first).toHaveFocus();
    expect(outside).not.toHaveFocus();
    outside.remove();
  });

  it("focuses Keep editing when 'Discard changes?' opens, and the name input when it closes, by button or Escape", () => {
    renderModal();
    change("Name", "typed");
    const cancel = screen.getByRole("button", { name: "Cancel" });
    cancel.focus();
    expect(cancel).toHaveFocus();
    expect(screen.queryByText("Discard changes?")).toBeNull();

    fireEvent.click(cancel);
    expect(screen.getByText("Discard changes?")).toBeInTheDocument();
    const keep = screen.getByRole("button", { name: "Keep editing" });
    expect(keep).toHaveFocus();
    expect(cancel).not.toHaveFocus();

    // Tab stays in the topmost dialog: from its last button to its own first, not the form behind.
    const discard = screen.getByRole("button", { name: "Discard" });
    const confirmClose = screen.getAllByRole("button", { name: "Close" })[1]!;
    discard.focus();
    expect(tab(discard)).toBe(false);
    expect(confirmClose).toHaveFocus();

    fireEvent.click(keep);
    expect(screen.queryByText("Discard changes?")).toBeNull();
    expect(screen.getByLabelText("Name")).toHaveFocus();

    // Second round, closed with Escape instead of the button.
    screen.getByLabelText("Notes").focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Keep editing" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Discard changes?")).toBeNull();
    expect(screen.getByLabelText("Name")).toHaveFocus();
  });
});

describe("EvalCaseModal focus return", () => {
  it("focuses returnFocusTo when the modal unmounts", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    const focus = vi.spyOn(opener, "focus");
    const { unmount } = renderModal({ kind: "new" }, { returnFocusTo: opener });
    expect(focus).not.toHaveBeenCalled();
    unmount();
    expect(focus).toHaveBeenCalledTimes(1);
    opener.remove();
  });
});
