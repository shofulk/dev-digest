import { describe, it, expect } from "vitest";
import type { PrFile, SmartDiff } from "@devdigest/shared";
import { orderBySmartDiff } from "./helpers";

function file(over: Partial<PrFile>): PrFile {
  return { path: "x.ts", additions: 1, deletions: 0, patch: null, ...over };
}

describe("orderBySmartDiff", () => {
  // The "core" group lists its two files in *response* order
  // (src/api/users.ts, src/config.ts) — the reverse of `PrDetail.files`
  // (GitHub) order below. AC1/D3 require the group to keep the
  // `PrDetail.files` order, not the response's.
  const smartDiff: SmartDiff = {
    groups: [
      {
        role: "core",
        files: [
          { path: "src/api/users.ts", pseudocode_summary: null, additions: 8, deletions: 2, finding_lines: [45] },
          { path: "src/config.ts", pseudocode_summary: null, additions: 5, deletions: 1, finding_lines: [12] },
        ],
      },
      { role: "docs", files: [{ path: "README.md", pseudocode_summary: null, additions: 1, deletions: 0, finding_lines: [] }] },
    ],
    split_suggestion: { too_big: false, total_lines: 16, proposed_splits: [] },
  };

  it("keeps PrDetail.files (GitHub) order inside a group, even when it differs from the response's per-group order", () => {
    const files = [
      file({ path: "src/config.ts" }),
      file({ path: "README.md" }),
      file({ path: "src/api/users.ts" }),
    ];
    const result = orderBySmartDiff(files, smartDiff);
    // Role order still follows the response's group order.
    expect(result.map((g) => g.role)).toEqual(["core", "docs"]);
    // Within "core", the two files come out in `files` (GitHub) order —
    // config.ts before users.ts — not the response's users.ts-then-config.ts.
    expect(result[0]!.files.map((f) => f.path)).toEqual(["src/config.ts", "src/api/users.ts"]);
    expect(result[1]!.files.map((f) => f.path)).toEqual(["README.md"]);
  });

  it("a PR file missing from the response goes to core", () => {
    const files = [file({ path: "src/config.ts" }), file({ path: "src/unknown.ts" }), file({ path: "src/api/users.ts" })];
    const result = orderBySmartDiff(files, smartDiff);
    const core = result.find((g) => g.role === "core")!;
    expect(core.files.map((f) => f.path)).toEqual(["src/config.ts", "src/unknown.ts", "src/api/users.ts"]);
  });

  it("drops empty groups and returns [] with no response", () => {
    expect(orderBySmartDiff([file({ path: "a" })], null)).toEqual([]);
    const result = orderBySmartDiff([file({ path: "README.md" })], smartDiff);
    expect(result.map((g) => g.role)).toEqual(["docs"]);
  });
});
