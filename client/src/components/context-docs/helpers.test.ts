/* helpers.test.ts — T8 (red, docs/plans/project-context.plan.md). Written against the D11
   interface (client/src/components/context-docs/helpers.ts): every helper is a stub that
   returns a neutral value, so every assertion below is expected to fail now and pass once
   a later step fills in the real logic. */
import { describe, it, expect } from "vitest";
import type { SpecFile } from "@devdigest/shared";
import {
  docName,
  docFolder,
  groupByFolder,
  buildAttachRows,
  filterRows,
  attachedTokens,
  toggleDoc,
  moveDoc,
  serializeAs,
  type AttachRow,
} from "./helpers";

const file = (path: string, over: Partial<SpecFile> = {}): SpecFile => ({
  path,
  type: path.startsWith("specs/") ? "specs" : path.startsWith("insights/") ? "insights" : "docs",
  tokens: 10,
  used_by: 0,
  ...over,
});

describe("docName / docFolder", () => {
  it("docName returns the last path segment and docFolder returns everything before it", () => {
    expect(docName("docs/architecture.md")).toBe("architecture.md");
    expect(docFolder("docs/architecture.md")).toBe("docs");
    // root-level file: no folder
    expect(docName("README.md")).toBe("README.md");
    expect(docFolder("README.md")).toBe("");
  });
});

describe("groupByFolder", () => {
  it("AC-4: groups rows by docFolder, folders in first-seen order", () => {
    const rows: AttachRow[] = [
      { path: "docs/architecture.md", name: "architecture.md", folder: "docs", type: "docs", tokens: 10, attached: false, missing: false },
      { path: "specs/rate-limiting.spec.md", name: "rate-limiting.spec.md", folder: "specs", type: "specs", tokens: 5, attached: false, missing: false },
      { path: "docs/payments.md", name: "payments.md", folder: "docs", type: "docs", tokens: 7, attached: false, missing: false },
    ];

    const groups = groupByFolder(rows);

    expect(groups.map((g) => g.folder)).toEqual(["docs", "specs"]);
    expect(groups[0]?.rows.map((r) => r.path)).toEqual(["docs/architecture.md", "docs/payments.md"]);
    expect(groups[1]?.rows.map((r) => r.path)).toEqual(["specs/rate-limiting.spec.md"]);
  });
});

describe("buildAttachRows", () => {
  it("AC-10: puts attached rows first in the SAVED order, which disagrees with path order", () => {
    const files: SpecFile[] = [file("docs/a.md"), file("docs/b.md"), file("docs/c.md")];
    // saved order is the reverse of path order — a wrong implementation that just
    // sorts everything by path would still "pass" if the two orders agreed.
    const attached = ["docs/c.md", "docs/a.md"];

    const rows = buildAttachRows(files, attached);

    expect(rows.map((r) => r.path)).toEqual(["docs/c.md", "docs/a.md", "docs/b.md"]);
    expect(rows.map((r) => r.attached)).toEqual([true, true, false]);
  });

  it("AC-17: a saved path missing from the scan is still listed, flagged missing with null tokens", () => {
    const files: SpecFile[] = [file("docs/a.md")];
    const attached = ["docs/gone.md", "docs/a.md"];

    const rows = buildAttachRows(files, attached);

    const missingRow = rows.find((r) => r.path === "docs/gone.md");
    expect(missingRow).toMatchObject({ attached: true, missing: true, tokens: null });
    const foundRow = rows.find((r) => r.path === "docs/a.md");
    expect(foundRow).toMatchObject({ attached: true, missing: false, tokens: 10 });
  });
});

describe("filterRows", () => {
  it("AC-13: keeps only rows whose path contains the query, case-insensitively, and the result is simply the matching subset (hidden rows carry no derivable attachment state)", () => {
    const rows: AttachRow[] = [
      { path: "docs/Architecture.md", name: "Architecture.md", folder: "docs", type: "docs", tokens: 10, attached: true, missing: false },
      { path: "specs/rate-limiting.spec.md", name: "rate-limiting.spec.md", folder: "specs", type: "specs", tokens: 5, attached: false, missing: false },
    ];

    const filtered = filterRows(rows, "ARCH");

    expect(filtered.map((r) => r.path)).toEqual(["docs/Architecture.md"]);
    // the hidden row's own attachment state is preserved on the object that
    // still exists elsewhere (the unfiltered rows array), not fabricated here.
    expect(rows.find((r) => r.path === "specs/rate-limiting.spec.md")?.attached).toBe(false);
  });
});

describe("attachedTokens", () => {
  it("AC-12: sums tokens over attached rows only, with null tokens contributing 0", () => {
    const rows: AttachRow[] = [
      { path: "docs/a.md", name: "a.md", folder: "docs", type: "docs", tokens: 10, attached: true, missing: false },
      { path: "docs/b.md", name: "b.md", folder: "docs", type: "docs", tokens: null, attached: true, missing: true },
      { path: "docs/c.md", name: "c.md", folder: "docs", type: "docs", tokens: 100, attached: false, missing: false },
    ];

    expect(attachedTokens(rows)).toBe(10);
  });
});

describe("toggleDoc", () => {
  it("AC-14: drops a path already in the saved order, and appends one that is not", () => {
    expect(toggleDoc(["docs/a.md", "docs/b.md"], "docs/a.md")).toEqual(["docs/b.md"]);
    expect(toggleDoc(["docs/a.md"], "docs/c.md")).toEqual(["docs/a.md", "docs/c.md"]);
  });
});

describe("moveDoc", () => {
  it("AC-14: moves a path one slot within the saved order, and is a no-op at either end", () => {
    const order = ["docs/a.md", "docs/b.md", "docs/c.md"];

    expect(moveDoc(order, "docs/b.md", -1)).toEqual(["docs/b.md", "docs/a.md", "docs/c.md"]);
    expect(moveDoc(order, "docs/b.md", 1)).toEqual(["docs/a.md", "docs/c.md", "docs/b.md"]);
    // no-op at either end
    expect(moveDoc(order, "docs/a.md", -1)).toEqual(order);
    expect(moveDoc(order, "docs/c.md", 1)).toEqual(order);
  });
});

describe("serializeAs", () => {
  it("AC-19: renders the Project context heading followed by one '- <path>' line per attached path, in order", () => {
    const text = serializeAs(["docs/architecture.md", "specs/rate-limiting.spec.md"]);

    expect(text).toBe(
      ["## Project context", "- docs/architecture.md", "- specs/rate-limiting.spec.md"].join("\n"),
    );
  });
});
