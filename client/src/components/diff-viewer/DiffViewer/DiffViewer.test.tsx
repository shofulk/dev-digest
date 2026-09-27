import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFile, SmartDiff } from "@devdigest/shared";
import prReviewMessages from "../../../../messages/en/prReview.json";
import shellMessages from "../../../../messages/en/shell.json";

import { DiffViewer } from "./DiffViewer";
import { orderBySmartDiff } from "../helpers";
import type { DiffFindingApi } from "../findings";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: prReviewMessages, shell: shellMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function file(over: Partial<PrFile>): PrFile {
  return { path: "x.ts", additions: 1, deletions: 0, patch: null, ...over };
}

function finding(over: Partial<FindingRecord>): FindingRecord {
  return {
    id: "f1",
    review_id: "r1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded key",
    file: "src/config.ts",
    start_line: 2,
    end_line: 2,
    rationale: "Because.",
    confidence: 0.9,
    accepted_at: null,
    dismissed_at: null,
    ...over,
  };
}

// PrDetail.files (GitHub) order. "src/api/users.ts" sits after "src/config.ts"
// here, but the response below lists the same two "core" files in the
// opposite order — the DOM must still follow this (GitHub) order (AC1/F1).
const FILES: PrFile[] = [
  file({ path: "src/config.ts", additions: 3, deletions: 0, patch: "@@ -1,2 +1,3 @@\n line one\n+line two\n line three" }),
  file({ path: "src/api/users.ts", additions: 2, deletions: 0 }),
  file({ path: "src/x.spec.ts", additions: 1, deletions: 0 }),
  file({ path: "tsconfig.json", additions: 1, deletions: 0 }),
  file({ path: "README.md", additions: 1, deletions: 0 }),
  file({ path: "pnpm-lock.yaml", additions: 1, deletions: 0 }),
];

const SMART_DIFF: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [
        // Response order is the reverse of `FILES` above.
        { path: "src/api/users.ts", pseudocode_summary: null, additions: 2, deletions: 0, finding_lines: [] },
        { path: "src/config.ts", pseudocode_summary: null, additions: 3, deletions: 0, finding_lines: [2] },
      ],
    },
    { role: "tests", files: [{ path: "src/x.spec.ts", pseudocode_summary: null, additions: 1, deletions: 0, finding_lines: [] }] },
    { role: "wiring", files: [{ path: "tsconfig.json", pseudocode_summary: null, additions: 1, deletions: 0, finding_lines: [] }] },
    { role: "docs", files: [{ path: "README.md", pseudocode_summary: null, additions: 1, deletions: 0, finding_lines: [] }] },
    { role: "boilerplate", files: [{ path: "pnpm-lock.yaml", pseudocode_summary: null, additions: 1, deletions: 0, finding_lines: [] }] },
  ],
  split_suggestion: { too_big: false, total_lines: 8, proposed_splits: [] },
};

const outOfPatch = finding({ id: "unanchored", start_line: 999 });

function findingApi(findings: FindingRecord[]): DiffFindingApi {
  return {
    findings,
    renderFinding: (f) => <div key={f.id} data-testid={`finding-${f.id}`}>{f.title}</div>,
  };
}

const GROUP_LABELS = ["Core", "Tests", "Wiring", "Docs", "Boilerplate"];

describe("DiffViewer — Smart order", () => {
  it("renders group headers in AC1 order (core→tests→wiring→docs→boilerplate) with labels, subtitles, file counts, and finding counters only where open findings exist, keeping PrDetail.files order inside a multi-file group", () => {
    const groups = orderBySmartDiff(FILES, SMART_DIFF);
    renderWithIntl(<DiffViewer files={FILES} groups={groups} findings={findingApi([finding({})])} />);

    // Rendered DOM order of the group headers, not just presence.
    const headers = screen.getAllByText(/^(Core|Tests|Wiring|Docs|Boilerplate)$/);
    expect(headers.map((el) => el.textContent)).toEqual(GROUP_LABELS);
    expect(screen.getByText("The behaviour this PR changes")).toBeInTheDocument();

    // core has 2 files, the other four groups have 1 each.
    expect(screen.getByText("2 files")).toBeInTheDocument();
    expect(screen.getAllByText("1 files")).toHaveLength(4);

    // Within the "core" group, `src/config.ts` (PrDetail/GitHub order) comes
    // before `src/api/users.ts`, even though the response lists them reversed.
    const configEl = screen.getByText("src/config.ts");
    const usersEl = screen.getByText("src/api/users.ts");
    expect(configEl.compareDocumentPosition(usersEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // only the core group (whose file has an open finding) shows the counter
    expect(screen.getByLabelText("1 files with findings")).toBeInTheDocument();
  });

  it("docs and boilerplate start collapsed; core/tests/wiring start expanded, and clicking a header toggles it", () => {
    const groups = orderBySmartDiff(FILES, SMART_DIFF);
    renderWithIntl(<DiffViewer files={FILES} groups={groups} findings={findingApi([])} />);

    expect(screen.getByText("src/config.ts")).toBeInTheDocument();
    expect(screen.getByText("src/x.spec.ts")).toBeInTheDocument();
    expect(screen.getByText("tsconfig.json")).toBeInTheDocument();
    expect(screen.queryByText("README.md")).not.toBeInTheDocument();
    expect(screen.queryByText("pnpm-lock.yaml")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Boilerplate"));
    expect(screen.getByText("pnpm-lock.yaml")).toBeInTheDocument();
    expect(screen.queryByText("README.md")).not.toBeInTheDocument();
  });

  it("renders the flat GitHub-order list when groups is null", () => {
    renderWithIntl(<DiffViewer files={FILES} groups={null} />);
    expect(screen.getByText("src/config.ts")).toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(screen.queryByText("Core")).not.toBeInTheDocument();
  });

  it("shows the open-finding dot on a file with an open finding", () => {
    const groups = orderBySmartDiff(FILES, SMART_DIFF);
    renderWithIntl(<DiffViewer files={FILES} groups={groups} findings={findingApi([finding({})])} />);
    expect(screen.getByLabelText("This file has open findings")).toBeInTheDocument();
  });

  it("renders the inline finding under the matching line with a severity label", () => {
    const groups = orderBySmartDiff(FILES, SMART_DIFF);
    renderWithIntl(<DiffViewer files={FILES} groups={groups} findings={findingApi([finding({})])} />);
    expect(screen.getByTestId("finding-f1")).toBeInTheDocument();
    expect(screen.getByText("Critical")).toBeInTheDocument();
  });

  it("renders an out-of-patch finding in the unanchored block", () => {
    const groups = orderBySmartDiff(FILES, SMART_DIFF);
    renderWithIntl(<DiffViewer files={FILES} groups={groups} findings={findingApi([outOfPatch])} />);
    expect(screen.getByText("1 finding(s) not on a shown line")).toBeInTheDocument();
    expect(screen.getByTestId("finding-unanchored")).toBeInTheDocument();
  });
});
