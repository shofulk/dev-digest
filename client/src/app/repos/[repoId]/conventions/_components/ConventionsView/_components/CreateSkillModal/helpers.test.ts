import { describe, it, expect } from "vitest";
import { canCreate, skillLabHref } from "./helpers";
import { SKILLS_LAB_PATH, SKILL_CONFIG_TAB } from "./constants";

describe("canCreate", () => {
  it("needs both a name and a body", () => {
    expect(canCreate("repo-conventions", "# Rules")).toBe(true);
  });

  it("is false when either side is blank or whitespace only", () => {
    expect(canCreate("", "# Rules")).toBe(false);
    expect(canCreate("   ", "# Rules")).toBe(false);
    expect(canCreate("repo-conventions", "")).toBe(false);
    expect(canCreate("repo-conventions", "  \n ")).toBe(false);
  });
});

describe("skillLabHref", () => {
  it("deep links into the Skills Lab's single route via its query string", () => {
    expect(skillLabHref("sk-1")).toBe(`${SKILLS_LAB_PATH}?skill=sk-1&tab=${SKILL_CONFIG_TAB}`);
  });

  it("encodes an id that needs it", () => {
    expect(skillLabHref("a b/c")).toBe(`${SKILLS_LAB_PATH}?skill=a%20b%2Fc&tab=${SKILL_CONFIG_TAB}`);
  });
});
