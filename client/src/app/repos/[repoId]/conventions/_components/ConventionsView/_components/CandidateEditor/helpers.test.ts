import { describe, it, expect } from "vitest";
import { canSaveRule, toRationale } from "./helpers";

describe("canSaveRule", () => {
  it("accepts a rule with any non-whitespace content", () => {
    expect(canSaveRule("Use named exports")).toBe(true);
    expect(canSaveRule("  x  ")).toBe(true);
  });

  it("rejects an empty or whitespace-only rule", () => {
    expect(canSaveRule("")).toBe(false);
    expect(canSaveRule("   \n\t ")).toBe(false);
  });
});

describe("toRationale", () => {
  it("trims a real rationale", () => {
    expect(toRationale("  because it reads better  ")).toBe("because it reads better");
  });

  it("stores an empty rationale as null, never as an empty string", () => {
    expect(toRationale("")).toBeNull();
    expect(toRationale("   ")).toBeNull();
  });
});
