import { describe, expect, it } from "vitest";
import { s } from "./styles";

describe("FindingCard card style", () => {
  it("uses per-side border longhands only, so toggling focus never mixes shorthand and longhand", () => {
    for (const focused of [false, true]) {
      const style = s.card(focused, "var(--crit)", false);
      expect(style).not.toHaveProperty("border");
      expect(style).not.toHaveProperty("borderColor");
      expect(style).not.toHaveProperty("borderWidth");
      expect(style.borderLeftColor).toBe("var(--crit)");
    }
  });

  it("colours the three non-severity sides with the severity only while focused", () => {
    expect(s.card(false, "var(--crit)", false).borderTopColor).toBe("var(--border)");
    expect(s.card(true, "var(--crit)", false).borderTopColor).toBe("var(--crit)");
  });
});
