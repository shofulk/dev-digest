/* helpers.reorder.test.ts — F14 (fix round 3). `reorderAttached` moved here from
   ContextDocPicker.tsx (it was private and untested). Covers up vs down drags with a
   fixture where the two directions give different results, plus the "drop onto an
   unattached row" no-op the component relies on (reference equality) to skip a
   redundant save. New file: `helpers.test.ts` is frozen (T8, red/after) and not to be
   edited for this fix round. */
import { describe, it, expect } from "vitest";
import { reorderAttached } from "./helpers";

describe("reorderAttached", () => {
  const order = ["docs/a.md", "docs/b.md", "docs/c.md"];

  it("F14: an upward drag (drop target earlier in the order) moves the dragged path up to it", () => {
    // Drag c onto a: c should land at a's slot, pushing a and b down one.
    expect(reorderAttached(order, "docs/c.md", "docs/a.md")).toEqual([
      "docs/c.md",
      "docs/a.md",
      "docs/b.md",
    ]);
  });

  it("F14: a downward drag (drop target later in the order) moves the dragged path down to it — a different result from the upward case", () => {
    // Drag a onto c: a should land at c's slot, pulling b and c up one.
    expect(reorderAttached(order, "docs/a.md", "docs/c.md")).toEqual([
      "docs/b.md",
      "docs/c.md",
      "docs/a.md",
    ]);
  });

  it("F14: a drop onto an unattached row (not present in the saved order) is a no-op — same array reference back", () => {
    const result = reorderAttached(order, "docs/a.md", "docs/not-attached.md");
    expect(result).toBe(order); // reference equality: callers skip onChange on this
  });

  it("dragging a path onto itself is a no-op", () => {
    expect(reorderAttached(order, "docs/b.md", "docs/b.md")).toBe(order);
  });

  it("an unknown dragged path is a no-op", () => {
    expect(reorderAttached(order, "docs/unknown.md", "docs/a.md")).toBe(order);
  });
});
