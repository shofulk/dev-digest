import { describe, it, expect } from "vitest";
import type { FindingRecord } from "@devdigest/shared";
import { isOpenFinding, partitionFindings, maxSeverity } from "./findings";

function finding(over: Partial<FindingRecord>): FindingRecord {
  return {
    id: "f1",
    review_id: "r1",
    severity: "WARNING",
    category: "bug",
    title: "t",
    file: "src/config.ts",
    start_line: 10,
    end_line: 10,
    rationale: "because",
    confidence: 0.9,
    accepted_at: null,
    dismissed_at: null,
    ...over,
  };
}

describe("isOpenFinding", () => {
  it("excludes dismissed findings", () => {
    expect(isOpenFinding(finding({}))).toBe(true);
    expect(isOpenFinding(finding({ dismissed_at: "2026-01-01T00:00:00Z" }))).toBe(false);
    // accepted findings still count as open (D4)
    expect(isOpenFinding(finding({ accepted_at: "2026-01-01T00:00:00Z" }))).toBe(true);
  });
});

describe("partitionFindings", () => {
  it("matches a finding on RIGHT:newNo of a rendered line", () => {
    const f = finding({ start_line: 12 });
    const { matched, unanchored } = partitionFindings([f], new Set(["RIGHT:12"]));
    expect(matched.get("RIGHT:12")).toEqual([f]);
    expect(unanchored).toEqual([]);
  });

  it("a line not in the patch (or an empty patch) is unanchored", () => {
    const f = finding({ start_line: 999 });
    const { matched, unanchored } = partitionFindings([f], new Set());
    expect(matched.size).toBe(0);
    expect(unanchored).toEqual([f]);
  });
});

describe("maxSeverity", () => {
  it("ranks CRITICAL above SUGGESTION", () => {
    expect(maxSeverity(["SUGGESTION", "CRITICAL"])).toBe("CRITICAL");
  });
});
