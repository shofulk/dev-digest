import { describe, it, expect } from "vitest";
import { toDonutSegments, totalOf } from "./helpers";

describe("toDonutSegments", () => {
  it("maps counts to segments ordered by count, on fixed categorical slots", () => {
    const segs = toDonutSegments(
      [
        { category: "style", count: 2 },
        { category: "bug", count: 7 },
        { category: "security", count: 4 },
      ],
      "Other",
    );
    expect(segs).toEqual([
      { label: "bug", value: 7, color: "var(--series-1)" },
      { label: "security", value: 4, color: "var(--series-2)" },
      { label: "style", value: 2, color: "var(--series-3)" },
    ]);
    expect(totalOf(segs)).toBe(13);
  });

  it("returns nothing for no data and drops zero or non-finite counts", () => {
    expect(toDonutSegments([], "Other")).toEqual([]);
    expect(
      toDonutSegments(
        [
          { category: "bug", count: 0 },
          { category: "perf", count: Number.NaN },
        ],
        "Other",
      ),
    ).toEqual([]);
    expect(totalOf([])).toBe(0);
  });

  it("breaks count ties by name so the colours are stable", () => {
    const segs = toDonutSegments(
      [
        { category: "b", count: 1 },
        { category: "a", count: 1 },
      ],
      "Other",
    );
    expect(segs.map((s) => s.label)).toEqual(["a", "b"]);
  });

  it("folds everything past the ninth slot into one neutral Other segment", () => {
    const slices = Array.from({ length: 11 }, (_, i) => ({ category: `c${String(i).padStart(2, "0")}`, count: 20 - i }));
    const segs = toDonutSegments(slices, "Other");
    expect(segs).toHaveLength(9);
    expect(segs[7]!.color).toBe("var(--series-8)");
    expect(segs[8]).toEqual({ label: "Other", value: 20 - 8 + (20 - 9) + (20 - 10), color: "var(--text-muted)" });
    expect(totalOf(segs)).toBe(slices.reduce((n, c) => n + c.count, 0));
  });
});
