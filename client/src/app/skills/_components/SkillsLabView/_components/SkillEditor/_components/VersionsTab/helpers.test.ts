import { describe, it, expect } from "vitest";
import { MAX_LCS_CELLS, diffLines, diffStats, splitLines } from "./helpers";

const kinds = (a: string, b: string) => diffLines(a, b).map((l) => `${l.kind}:${l.text}`);

describe("splitLines", () => {
  it("has no lines for empty text and ignores one trailing newline", () => {
    expect(splitLines("")).toEqual([]);
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("a\r\nb")).toEqual(["a", "b"]);
    expect(splitLines("a\n\nb")).toEqual(["a", "", "b"]);
  });
});

describe("diffLines", () => {
  it("marks identical text as all-same with both line numbers", () => {
    const d = diffLines("a\nb", "a\nb");
    expect(d.map((l) => l.kind)).toEqual(["same", "same"]);
    expect(d[1]).toEqual({ kind: "same", text: "b", oldNo: 2, newNo: 2 });
    expect(diffStats(d)).toEqual({ added: 0, removed: 0 });
  });

  it("reports a pure addition", () => {
    expect(kinds("a\nc", "a\nb\nc")).toEqual(["same:a", "add:b", "same:c"]);
    expect(diffStats(diffLines("a", "a\nb\nc"))).toEqual({ added: 2, removed: 0 });
  });

  it("reports a pure deletion", () => {
    expect(kinds("a\nb\nc", "a\nc")).toEqual(["same:a", "del:b", "same:c"]);
    expect(diffStats(diffLines("a\nb\nc", "c"))).toEqual({ added: 0, removed: 2 });
  });

  it("reports a replacement as deletions then additions, with per-side line numbers", () => {
    const d = diffLines("a\nold\nz", "a\nnew\nz");
    expect(d.map((l) => `${l.kind}:${l.text}`)).toEqual(["same:a", "del:old", "add:new", "same:z"]);
    expect(d[1]).toEqual({ kind: "del", text: "old", oldNo: 2 });
    expect(d[2]).toEqual({ kind: "add", text: "new", newNo: 2 });
    expect(d[3]).toEqual({ kind: "same", text: "z", oldNo: 3, newNo: 3 });
  });

  it("handles empty inputs on either side", () => {
    expect(diffLines("", "")).toEqual([]);
    expect(kinds("", "a\nb")).toEqual(["add:a", "add:b"]);
    expect(kinds("a\nb", "")).toEqual(["del:a", "del:b"]);
  });

  it("keeps the longest common subsequence in interleaved edits", () => {
    expect(kinds("a\nb\nc\nd", "b\nx\nd\ny")).toEqual(["del:a", "same:b", "del:c", "add:x", "same:d", "add:y"]);
  });

  it("stays fast on a large body with scattered edits", () => {
    const old = Array.from({ length: 1500 }, (_, i) => `line ${i}`);
    const next = old.filter((_, i) => i % 50 !== 0).concat("tail");
    const started = Date.now();
    const d = diffLines(old.join("\n"), next.join("\n"));
    expect(Date.now() - started).toBeLessThan(2000);
    expect(diffStats(d)).toEqual({ added: 1, removed: 30 });
  });

  it("degrades to delete-all/add-all instead of building an oversized table", () => {
    const n = Math.ceil(Math.sqrt(MAX_LCS_CELLS)) + 10;
    const a = Array.from({ length: n }, (_, i) => `a${i}`).join("\n");
    const b = Array.from({ length: n }, (_, i) => `b${i}`).join("\n");
    expect(diffStats(diffLines(a, b))).toEqual({ added: n, removed: n });
  });
});
