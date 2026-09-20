import { describe, it, expect } from "vitest";
import { previewBody } from "./helpers";

describe("previewBody", () => {
  it("prefers the draft over the saved body", () => {
    expect(previewBody("saved", "draft")).toBe("draft");
  });
  it("falls back to the saved body when there is no draft", () => {
    expect(previewBody("saved", null)).toBe("saved");
  });
  it("treats an emptied draft as a real edit, not as no draft", () => {
    expect(previewBody("saved", "")).toBe("");
  });
});
