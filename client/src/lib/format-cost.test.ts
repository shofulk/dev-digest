import { describe, it, expect } from "vitest";
import { formatCost, formatTokenCount, NO_COST } from "./format-cost";

describe("formatCost", () => {
  it("renders the em dash for an unknown cost, never a zero", () => {
    expect(formatCost(null)).toBe(NO_COST);
    expect(formatCost(undefined)).toBe(NO_COST);
  });

  it("keeps sub-cent runs legible instead of collapsing them to $0.00", () => {
    expect(formatCost(0.0013)).toBe("$0.0013");
    expect(formatCost(0.001)).toBe("$0.001");
  });

  it("scales precision down as the amount grows", () => {
    expect(formatCost(0.014)).toBe("$0.014");
    expect(formatCost(1.25)).toBe("$1.25");
  });

  it("drops the trailing zeros the widened precision introduces", () => {
    expect(formatCost(0.06)).toBe("$0.06");
    expect(formatCost(0.01)).toBe("$0.01");
    expect(formatCost(1.2)).toBe("$1.20"); // a dollar or more stays money-shaped
  });

  it("distinguishes a real zero from an unknown", () => {
    expect(formatCost(0)).toBe("$0");
  });
});

describe("formatTokenCount", () => {
  it("groups thousands and returns null when absent", () => {
    expect(formatTokenCount(9119)).toBe("9 119 tok");
    expect(formatTokenCount(null)).toBeNull();
  });
});
