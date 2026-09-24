import { describe, it, expect } from "vitest";
import { isUntrusted, toPercent } from "./helpers";

describe("skill-ui helpers", () => {
  it("treats every source except manual as untrusted", () => {
    expect(isUntrusted("manual")).toBe(false);
    for (const s of ["extracted", "community", "imported_url", "imported_file"] as const) {
      expect(isUntrusted(s)).toBe(true);
    }
  });

  it("converts a 0..1 rate to a clamped whole percent and never yields NaN", () => {
    expect(toPercent(0.876)).toBe(88);
    expect(toPercent(0)).toBe(0);
    expect(toPercent(1.4)).toBe(100);
    expect(toPercent(-1)).toBe(0);
    expect(toPercent(Number.NaN)).toBe(0);
  });
});
