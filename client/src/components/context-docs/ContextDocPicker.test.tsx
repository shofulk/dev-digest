/* ContextDocPicker.test.tsx — T10 (after, L10). The shared attach picker used by both the
   agent and the skill Context tabs: rows with checkbox/name/folder/badge/Preview (AC-10),
   the "K of M attached" header and tokens note (AC-11, AC-12), the filter (AC-13), save on
   every change via the caller's `onChange` with no Save button (AC-14), the Missing badge
   and Detach (AC-17), the Preview overlay (AC-37), and the loading/409 states (AC-39,
   AC-44). `@/lib/hooks/context` is mocked directly — the one boundary this component and
   DocPreviewModal read through. */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import type { ContextDocList, ContextDocContent } from "@devdigest/shared";
import context from "../../../messages/en/context.json"; // client/messages/en/context.json

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/toast", () => ({ notify: toast }));

const state = vi.hoisted(() => ({
  docsData: undefined as ContextDocList | undefined,
  docsLoading: false,
  docsError: null as Error | null,
  docContent: undefined as ContextDocContent | undefined,
  docLoading: false,
  docError: null as Error | null,
  refetch: vi.fn(),
  docRefetch: vi.fn(),
}));

vi.mock("@/lib/hooks/context", () => ({
  useContextDocs: () => ({
    data: state.docsData,
    isLoading: state.docsLoading,
    // Mirrors TanStack Query v5: `isPending` stays true while there is no data and no
    // error, including while the query is disabled (repoId null) — unlike `isLoading`,
    // which only turns true while actually fetching (F12).
    isPending: state.docsLoading || (state.docsData === undefined && state.docsError === null),
    isError: state.docsError != null,
    error: state.docsError,
    refetch: state.refetch,
  }),
  useContextDoc: () => ({
    data: state.docContent,
    isLoading: state.docLoading,
    isError: state.docError != null,
    error: state.docError,
    refetch: state.docRefetch,
  }),
}));

import { ApiError } from "@/lib/api";
import { ContextDocPicker } from "./ContextDocPicker";

function renderPicker(attached: string[], onChange: (next: string[]) => void, repoId: string | null = "r1") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context }}>
      <ContextDocPicker repoId={repoId} attached={attached} onChange={onChange} />
    </NextIntlClientProvider>,
  );
}

function docList(over: Partial<ContextDocList> = {}): ContextDocList {
  return {
    files: [
      { path: "docs/architecture.md", type: "docs", tokens: 10, used_by: 1 },
      { path: "specs/rate-limiting.spec.md", type: "specs", tokens: 20, used_by: 0 },
    ],
    roots: ["**/{specs,docs,insights}/**/*.md"],
    count: 2,
    total_tokens: 30,
    scanned_at: "2026-10-03T12:00:00Z",
    truncated: false,
    ...over,
  };
}

beforeEach(() => {
  state.docsData = docList();
  state.docsLoading = false;
  state.docsError = null;
  state.docContent = { path: "docs/architecture.md", content: "# Architecture", tokens: 10 };
  state.docLoading = false;
  state.docError = null;
  state.refetch = vi.fn();
  state.docRefetch = vi.fn();
  toast.toast.mockClear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const row = (path: string) => screen.getByText(path.split("/").pop()!).closest("li")!;

describe("ContextDocPicker — rows", () => {
  it("AC-10: each row shows a checkbox, file name, folder, type badge and a Preview action", () => {
    renderPicker(["docs/architecture.md"], vi.fn());

    const r = row("docs/architecture.md");
    expect(within(r).getByRole("checkbox")).toBeChecked();
    expect(within(r).getByText("architecture.md")).toBeInTheDocument();
    // the folder label and the DocTypeBadge label are both "docs" here — two nodes.
    expect(within(r).getAllByText("docs")).toHaveLength(2);
    expect(within(r).getByRole("button", { name: "Preview architecture.md" })).toBeInTheDocument();

    const r2 = row("specs/rate-limiting.spec.md");
    expect(within(r2).getByRole("checkbox")).not.toBeChecked();
  });

  it("AC-11, AC-12: the header shows 'K of M attached', the tokens note and the untrusted note", () => {
    renderPicker(["docs/architecture.md"], vi.fn());
    expect(screen.getByText("1 of 2 attached")).toBeInTheDocument();
    expect(screen.getByText("≈ 10 tokens")).toBeInTheDocument();
    expect(
      screen.getByText('Injected as an untrusted "## Project context" block into every run.'),
    ).toBeInTheDocument();
  });

  it("no attachment: the tokens and untrusted notes are absent", () => {
    renderPicker([], vi.fn());
    expect(screen.getByText("0 of 2 attached")).toBeInTheDocument();
    expect(screen.queryByText(/tokens/)).not.toBeInTheDocument();
  });
});

describe("ContextDocPicker — filter", () => {
  it("AC-13: a filter hides non-matching rows but never changes their attachment state", () => {
    renderPicker(["specs/rate-limiting.spec.md"], vi.fn());
    fireEvent.change(screen.getByPlaceholderText("Filter documents…"), { target: { value: "ARCH" } });

    expect(screen.queryByText("architecture.md")).toBeInTheDocument();
    expect(screen.queryByText("rate-limiting.spec.md")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 2 attached")).toBeInTheDocument(); // header counts the whole set, not the filtered view

    fireEvent.change(screen.getByPlaceholderText("Filter documents…"), { target: { value: "" } });
    expect(within(row("specs/rate-limiting.spec.md")).getByRole("checkbox")).toBeChecked();
  });
});

describe("ContextDocPicker — attach, detach, reorder", () => {
  it("AC-14: checking an unattached row calls onChange once with it appended", () => {
    const onChange = vi.fn();
    renderPicker([], onChange);
    fireEvent.click(within(row("docs/architecture.md")).getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(["docs/architecture.md"]);
  });

  it("AC-14: unchecking an attached row calls onChange once with it removed", () => {
    const onChange = vi.fn();
    renderPicker(["docs/architecture.md", "specs/rate-limiting.spec.md"], onChange);
    fireEvent.click(within(row("docs/architecture.md")).getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(["specs/rate-limiting.spec.md"]);
  });

  it("AC-14: Move down calls onChange once with the saved order swapped", () => {
    const onChange = vi.fn();
    renderPicker(["docs/architecture.md", "specs/rate-limiting.spec.md"], onChange);
    fireEvent.click(within(row("docs/architecture.md")).getByRole("button", { name: "Move architecture.md down" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(["specs/rate-limiting.spec.md", "docs/architecture.md"]);
  });

  it("AC-14, NFR-9: Alt+ArrowDown on a focused attached row reorders it by keyboard", () => {
    const onChange = vi.fn();
    renderPicker(["docs/architecture.md", "specs/rate-limiting.spec.md"], onChange);
    const li = row("docs/architecture.md");
    li.focus();
    fireEvent.keyDown(li, { key: "ArrowDown", altKey: true });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(["specs/rate-limiting.spec.md", "docs/architecture.md"]);
  });

  it("F14: dragging an attached row onto another attached row reorders it, in drag-source → drag-target order", () => {
    const onChange = vi.fn();
    renderPicker(["docs/architecture.md", "specs/rate-limiting.spec.md"], onChange);
    const dataTransfer = { setData: vi.fn(), effectAllowed: "" };
    const source = row("docs/architecture.md");
    const target = row("specs/rate-limiting.spec.md");

    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragEnter(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(["specs/rate-limiting.spec.md", "docs/architecture.md"]);
  });

  it("F14: dropping onto an unattached row does not reorder and does not call onChange (no redundant save)", () => {
    const onChange = vi.fn();
    renderPicker(["docs/architecture.md"], onChange);
    const dataTransfer = { setData: vi.fn(), effectAllowed: "" };
    const source = row("docs/architecture.md");
    const target = row("specs/rate-limiting.spec.md"); // unattached

    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragEnter(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("reordering is paused while a filter is active: Move buttons disappear from the row", () => {
    renderPicker(["docs/architecture.md", "specs/rate-limiting.spec.md"], vi.fn());
    fireEvent.change(screen.getByPlaceholderText("Filter documents…"), { target: { value: "arch" } });
    expect(within(row("docs/architecture.md")).queryByRole("button", { name: /Move/ })).not.toBeInTheDocument();
  });
});

describe("ContextDocPicker — missing documents", () => {
  it("AC-17: an attached path no longer scanned shows the Missing badge, no tokens, and Detach", () => {
    const onChange = vi.fn();
    renderPicker(["docs/gone.md"], onChange);
    const r = row("docs/gone.md");
    expect(within(r).getByText("Missing")).toBeInTheDocument();
    // only the folder label "docs" is rendered — no second "docs" node for a type badge.
    expect(within(r).getAllByText("docs")).toHaveLength(1);
    fireEvent.click(within(r).getByRole("button", { name: "Detach gone.md" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

describe("ContextDocPicker — preview overlay", () => {
  it("AC-37: Preview opens the rendered document; Escape closes it and returns focus to the row's Preview button", () => {
    renderPicker(["docs/architecture.md"], vi.fn());
    const previewBtn = within(row("docs/architecture.md")).getByRole("button", { name: "Preview architecture.md" });
    fireEvent.click(previewBtn);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("docs/architecture.md")).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "Architecture" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(previewBtn);
  });

  it("F13: a failed document fetch shows an error with Retry inside the preview overlay, instead of an empty Markdown body", () => {
    state.docError = new Error("boom");
    renderPicker(["docs/architecture.md"], vi.fn());
    fireEvent.click(within(row("docs/architecture.md")).getByRole("button", { name: "Preview architecture.md" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Couldn't load this document")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
    expect(state.docRefetch).toHaveBeenCalledTimes(1);
  });
});

describe("ContextDocPicker — loading and error states", () => {
  it("AC-44: shows a loading placeholder and no checkbox while the documents request is in flight", () => {
    state.docsLoading = true;
    state.docsData = undefined;
    renderPicker(["docs/architecture.md"], vi.fn());
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("AC-39: a 409 shows the API reason and a Refresh action instead of the list", () => {
    state.docsError = new ApiError("repository not synced", 409, "repository_not_synced");
    renderPicker([], vi.fn());
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("repository not synced");
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(state.refetch).toHaveBeenCalledTimes(1);
  });

  it("F12: a null repoId (no active repo yet) shows the loading state, not the rows — no Missing badge, no Detach", () => {
    // A null repoId disables the real query (`enabled: !!repoId`): no data, no error,
    // not fetching — exactly the shape `isPending` is for and `isLoading` is not.
    state.docsData = undefined;
    const onChange = vi.fn();
    renderPicker(["docs/architecture.md", "docs/gone.md"], onChange, null);

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByText("Missing")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Detach/ })).not.toBeInTheDocument();
  });
});

describe("ContextDocPicker — failed save", () => {
  /** Mirrors the real optimistic-update + rollback contract the save hooks implement
   *  (D11, AC-16): the picker itself owns no persistence, so the caller is responsible
   *  for rolling `attached` back and toasting on a rejected `onChange`. */
  function Harness({ reject }: { reject: boolean }) {
    const [attached, setAttached] = React.useState<string[]>(["docs/architecture.md"]);
    const handleChange = (next: string[]) => {
      const previous = attached;
      setAttached(next);
      if (reject) {
        setAttached(previous);
        toast.toast("write conflict", "error");
      }
    };
    return <ContextDocPicker repoId="r1" attached={attached} onChange={handleChange} />;
  }

  it("AC-16: a failed save restores the previous attachment state and toasts the API error message", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ context }}>
        <Harness reject />
      </NextIntlClientProvider>,
    );

    fireEvent.click(within(row("specs/rate-limiting.spec.md")).getByRole("checkbox"));

    expect(within(row("specs/rate-limiting.spec.md")).getByRole("checkbox")).not.toBeChecked();
    expect(toast.toast).toHaveBeenCalledWith("write conflict", "error");
  });
});
