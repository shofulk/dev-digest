/* focus.test.ts — T14 (impl, S18). Covers AC-58, AC-60, AC-61. */
import { describe, it, expect } from "vitest";
import type { PrFile } from "@devdigest/shared";
import { resolveDiffFocus } from "./focus";

const FILES: PrFile[] = [
  { path: "src/index.ts", additions: 1, deletions: 0, patch: "@@ -1,1 +1,2 @@\n line one\n+line two" },
  {
    path: "docs/big.md",
    additions: 2,
    deletions: 0,
    patch: "@@ -1,2 +1,3 @@\n line one\n+docs change line\n line three",
  },
];

describe("resolveDiffFocus", () => {
  it("returns none when there is no file param", () => {
    expect(resolveDiffFocus(FILES, null, "2")).toEqual({ kind: "none" });
    expect(resolveDiffFocus(FILES, undefined, "2")).toEqual({ kind: "none" });
  });

  it("returns missing when the file is not one of the PR's files (AC-61)", () => {
    expect(resolveDiffFocus(FILES, "src/not-in-pr.ts", "1")).toEqual({
      kind: "missing",
      path: "src/not-in-pr.ts",
    });
  });

  it("returns target with the line when it is a shown new-side line (AC-58)", () => {
    expect(resolveDiffFocus(FILES, "docs/big.md", "2")).toEqual({
      kind: "target",
      path: "docs/big.md",
      line: 2,
    });
  });

  it("returns target with line null when the line is not shown in the diff (AC-60)", () => {
    expect(resolveDiffFocus(FILES, "docs/big.md", "999")).toEqual({
      kind: "target",
      path: "docs/big.md",
      line: null,
    });
  });

  it("returns target with line null when line is missing or not numeric", () => {
    expect(resolveDiffFocus(FILES, "docs/big.md", null)).toEqual({
      kind: "target",
      path: "docs/big.md",
      line: null,
    });
    expect(resolveDiffFocus(FILES, "docs/big.md", "abc")).toEqual({
      kind: "target",
      path: "docs/big.md",
      line: null,
    });
  });
});
