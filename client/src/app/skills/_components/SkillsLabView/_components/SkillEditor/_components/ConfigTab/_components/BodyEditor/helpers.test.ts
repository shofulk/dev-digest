import { describe, it, expect } from "vitest";
import { countLines, gutterText } from "./helpers";

describe("countLines", () => {
  it("counts an empty body as one line", () => {
    expect(countLines("")).toBe(1);
  });
  it("counts newline-separated lines, including a trailing empty one", () => {
    expect(countLines("a")).toBe(1);
    expect(countLines("a\nb\nc")).toBe(3);
    expect(countLines("a\n")).toBe(2);
  });
});

describe("gutterText", () => {
  it("numbers lines from 1", () => {
    expect(gutterText(3)).toBe("1\n2\n3");
  });
  it("never renders fewer than one line", () => {
    expect(gutterText(0)).toBe("1");
    expect(gutterText(-4)).toBe("1");
  });
});
