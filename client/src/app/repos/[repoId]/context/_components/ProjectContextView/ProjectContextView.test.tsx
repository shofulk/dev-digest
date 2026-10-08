/* ProjectContextView.test.tsx — T9 (after, L10). The page is read-only (AC-7): it shows
   the repo's documents grouped by folder, opens the first one by default (AC-4), renders
   the current document as styled, read-only Markdown (AC-7, AC-40), and surfaces the
   discovery summary (AC-6), the empty/409/loading states (AC-9, AC-39, AC-44) and Refresh
   (AC-8). `@/lib/hooks/context` is mocked directly (the boundary this component reads
   through) rather than `fetch`, following the RunTraceDrawer test's convention for a
   component that talks to hooks, not the network, directly. */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ContextDocList, ContextDocContent } from "@devdigest/shared";
import context from "../../../../../../../messages/en/context.json"; // client/messages/en/context.json

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1" }),
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    activeRepo: { id: "r1", full_name: "acme/payments-api", default_branch: "main" },
    repos: [],
    repoId: "r1",
    setRepoId: () => {},
    reposLoaded: true,
  }),
  useRepoNotFound: () => false,
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ crumb, children }: { crumb?: { label: string }[]; children: React.ReactNode }) => (
    <div>
      <nav aria-label="breadcrumb">{crumb?.map((c) => c.label).join(" › ")}</nav>
      {children}
    </div>
  ),
}));

const state = vi.hoisted(() => ({
  docsData: undefined as ContextDocList | undefined,
  docsLoading: false,
  docsError: null as Error | null,
  docContent: undefined as ContextDocContent | undefined,
  docLoading: false,
  docError: null as Error | null,
  refetch: vi.fn(),
  docRefetch: vi.fn(),
  reindexMutate: vi.fn(),
  reindexPending: false,
}));

vi.mock("@/lib/hooks/context", () => ({
  useContextDocs: () => ({
    data: state.docsData,
    isLoading: state.docsLoading,
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
  useReindexContext: () => ({ isPending: state.reindexPending, mutate: state.reindexMutate }),
}));

import { ApiError } from "@/lib/api";
import { ProjectContextView } from "./ProjectContextView";

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context }}>
      <ProjectContextView />
    </NextIntlClientProvider>,
  );
}

function docList(over: Partial<ContextDocList> = {}): ContextDocList {
  return {
    files: [
      { path: "docs/architecture.md", type: "docs", tokens: 42, used_by: 2 },
      { path: "specs/rate-limiting.spec.md", type: "specs", tokens: 10, used_by: 0 },
    ],
    roots: ["**/{specs,docs,insights}/**/*.md"],
    count: 2,
    total_tokens: 52,
    scanned_at: "2026-10-03T12:00:00Z",
    truncated: false,
    ...over,
  };
}

beforeEach(() => {
  state.docsData = docList();
  state.docsLoading = false;
  state.docsError = null;
  state.docContent = { path: "docs/architecture.md", content: "# Payments API architecture\n\n- a list item\n\n`code`", tokens: 42 };
  state.docLoading = false;
  state.docError = null;
  state.refetch = vi.fn();
  state.docRefetch = vi.fn();
  state.reindexMutate = vi.fn();
  state.reindexPending = false;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProjectContextView — list and preview", () => {
  it("AC-4: groups the documents by folder and opens the first one by default", () => {
    renderView();
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText("specs")).toBeInTheDocument();
    // The first file (docs/architecture.md) is open — its heading renders in the preview.
    expect(screen.getByRole("heading", { name: "Payments API architecture" })).toBeInTheDocument();
  });

  it("AC-5: shows the open document's path, token count and 'Used by N agents'", () => {
    renderView();
    expect(screen.getByText("docs/architecture.md")).toBeInTheDocument();
    expect(screen.getByText("≈ 42 tokens")).toBeInTheDocument();
    expect(screen.getByText("Used by 2 agents")).toBeInTheDocument();
  });

  it("AC-6: shows the discovery summary — count, total tokens and scan time", () => {
    renderView();
    expect(
      screen.getByText(`2 documents · ≈ 52 tokens · scanned ${new Date("2026-10-03T12:00:00Z").toLocaleString()}`),
    ).toBeInTheDocument();
  });

  it("AC-6: a truncated scan shows the truncation note", () => {
    state.docsData = docList({ truncated: true, count: 1000 });
    renderView();
    expect(screen.getByText("Showing the first 1000 documents; more were found.")).toBeInTheDocument();
  });

  it("AC-7, AC-40: renders real headings/lists/code and offers no editing control", () => {
    state.docContent = {
      path: "docs/architecture.md",
      content: "# Payments API architecture\n\n- a list item\n\n`code`",
      tokens: 42,
    };
    renderView();
    expect(screen.getByRole("heading", { name: "Payments API architecture" })).toBeInTheDocument();
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getByText("code")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /upload/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    expect(document.querySelector("input[type='file']")).not.toBeInTheDocument();
  });

  it("AC-40: raw HTML / a <script> tag renders as visible text, never as a live element", () => {
    state.docContent = {
      path: "docs/architecture.md",
      content: "# Title\n\n<script>alert(1)</script>",
      tokens: 5,
    };
    const { container } = renderView();
    expect(container.querySelector("script")).not.toBeInTheDocument();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });
});

describe("ProjectContextView — states", () => {
  it("AC-9: an empty scan shows an empty state naming the active search roots", () => {
    state.docsData = docList({ files: [], count: 0, total_tokens: 0 });
    renderView();
    expect(screen.getByText("No documents found")).toBeInTheDocument();
    expect(
      screen.getByText("No Markdown documents were found under **/{specs,docs,insights}/**/*.md."),
    ).toBeInTheDocument();
  });

  it("AC-39: a 409 shows the API reason and a Refresh action instead of the list", () => {
    state.docsData = undefined;
    state.docsError = new ApiError("repository not synced", 409, "repository_not_synced");
    renderView();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("repository not synced");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(state.refetch).toHaveBeenCalledTimes(1);
  });

  it("AC-44: shows a loading placeholder while the documents request is in flight", () => {
    state.docsData = undefined;
    state.docsLoading = true;
    renderView();
    expect(screen.queryByText("docs/architecture.md")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Payments API architecture" })).not.toBeInTheDocument();
  });

  it("F13: a failed document fetch shows an error with Retry in the preview pane, instead of an empty Markdown body", () => {
    state.docError = new Error("boom");
    renderView();

    expect(screen.getByText("Couldn't load this document")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Payments API architecture" })).not.toBeInTheDocument();

    const alerts = screen.getAllByRole("alert");
    const previewAlert = alerts[alerts.length - 1]!;
    fireEvent.click(within(previewAlert).getByRole("button", { name: "Retry" }));
    expect(state.docRefetch).toHaveBeenCalledTimes(1);
  });
});

describe("ProjectContextView — Refresh", () => {
  it("AC-8: pressing Refresh asks the API to scan the checkout again", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(state.reindexMutate).toHaveBeenCalledWith("r1");
  });
});
