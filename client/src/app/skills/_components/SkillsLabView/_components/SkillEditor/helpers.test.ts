import { describe, it, expect } from "vitest";
import { resolveSkillTab } from "./helpers";

describe("resolveSkillTab", () => {
  it("keeps a known tab and falls back to config for anything else", () => {
    expect(resolveSkillTab("versions")).toBe("versions");
    expect(resolveSkillTab("evals")).toBe("config");
    expect(resolveSkillTab("")).toBe("config");
    expect(resolveSkillTab(null)).toBe("config");
  });
});
