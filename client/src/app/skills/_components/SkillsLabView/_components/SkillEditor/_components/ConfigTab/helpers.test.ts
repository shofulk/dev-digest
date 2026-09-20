import { describe, it, expect } from "vitest";
import type { Skill } from "@devdigest/shared";
import { buildPatch, formFromSkill, isBodyDirty, isDirty, isValid } from "./helpers";

const SKILL: Skill = {
  id: "s1",
  name: "flaky-test-patterns",
  description: "Apply when tests are flaky.",
  type: "rubric",
  source: "manual",
  body: "# Rule\n",
  enabled: true,
  version: 2,
  created_at: "2026-09-01T00:00:00Z",
};

describe("isDirty / isBodyDirty", () => {
  it("is clean for a form built from the skill", () => {
    const form = formFromSkill(SKILL);
    expect(isDirty(form, SKILL)).toBe(false);
    expect(isBodyDirty(form, SKILL)).toBe(false);
  });
  it("detects each field", () => {
    expect(isDirty({ ...formFromSkill(SKILL), name: "other" }, SKILL)).toBe(true);
    expect(isDirty({ ...formFromSkill(SKILL), description: "x" }, SKILL)).toBe(true);
    expect(isDirty({ ...formFromSkill(SKILL), type: "security" }, SKILL)).toBe(true);
    expect(isDirty({ ...formFromSkill(SKILL), body: "# Rule" }, SKILL)).toBe(true);
  });
  it("ignores surrounding whitespace on name and description only", () => {
    expect(isDirty({ ...formFromSkill(SKILL), name: "  flaky-test-patterns " }, SKILL)).toBe(false);
    expect(isBodyDirty({ ...formFromSkill(SKILL), body: "# Rule\n\n" }, SKILL)).toBe(true);
  });
});

describe("isValid", () => {
  it("needs a name and a body", () => {
    expect(isValid(formFromSkill(SKILL))).toBe(true);
    expect(isValid({ ...formFromSkill(SKILL), name: "  " })).toBe(false);
    expect(isValid({ ...formFromSkill(SKILL), body: "\n " })).toBe(false);
  });
});

describe("buildPatch", () => {
  it("carries only the changed fields", () => {
    expect(buildPatch({ ...formFromSkill(SKILL), type: "custom" }, SKILL)).toEqual({ type: "custom" });
  });
  it("omits body for a metadata-only edit and includes it for a body edit", () => {
    expect("body" in buildPatch({ ...formFromSkill(SKILL), name: "renamed" }, SKILL)).toBe(false);
    expect(buildPatch({ ...formFromSkill(SKILL), body: "new" }, SKILL)).toEqual({ body: "new" });
  });
  it("trims name and description", () => {
    expect(buildPatch({ ...formFromSkill(SKILL), name: " a ", description: " b " }, SKILL)).toEqual({
      name: "a",
      description: "b",
    });
  });
});
