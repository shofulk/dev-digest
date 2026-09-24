import { describe, it, expect } from "vitest";
import { confidenceColor, evidenceLabel } from "./helpers";
import { CONFIDENCE_OK, CONFIDENCE_WARN } from "./constants";

describe("confidenceColor", () => {
  it("is the ok colour at and above the ok threshold", () => {
    expect(confidenceColor(1)).toBe("var(--ok)");
    expect(confidenceColor(CONFIDENCE_OK)).toBe("var(--ok)");
  });

  it("is the warn colour between the two thresholds", () => {
    expect(confidenceColor(CONFIDENCE_WARN)).toBe("var(--warn)");
    expect(confidenceColor(CONFIDENCE_OK - 0.01)).toBe("var(--warn)");
  });

  it("is muted below the warn threshold", () => {
    expect(confidenceColor(CONFIDENCE_WARN - 0.01)).toBe("var(--text-muted)");
    expect(confidenceColor(0)).toBe("var(--text-muted)");
  });
});

describe("evidenceLabel", () => {
  it("appends the line when there is one", () => {
    expect(evidenceLabel("src/api/users.ts", 23)).toBe("src/api/users.ts:23");
  });

  it("is the bare path when the line is missing, null or zero", () => {
    expect(evidenceLabel("src/api/users.ts")).toBe("src/api/users.ts");
    expect(evidenceLabel("src/api/users.ts", null)).toBe("src/api/users.ts");
    expect(evidenceLabel("src/api/users.ts", 0)).toBe("src/api/users.ts");
  });
});
