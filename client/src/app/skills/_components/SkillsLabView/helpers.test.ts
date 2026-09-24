import { describe, it, expect } from "vitest";
import { buildSkillsUrl } from "./helpers";

describe("buildSkillsUrl", () => {
  it("selecting a skill keeps the current tab", () => {
    expect(buildSkillsUrl("skill=a&tab=stats", { skill: "b" })).toBe("/skills?skill=b&tab=stats");
  });

  it("sets the tab without touching the skill", () => {
    expect(buildSkillsUrl("skill=a", { tab: "versions" })).toBe("/skills?skill=a&tab=versions");
  });

  it("clears the skill and yields the bare route when nothing is left", () => {
    expect(buildSkillsUrl("skill=a", { skill: null })).toBe("/skills");
    expect(buildSkillsUrl("skill=a&tab=preview", { skill: null })).toBe("/skills?tab=preview");
  });
});
