import { describe, it, expect } from "vitest";
import type { SkillListItem } from "@devdigest/shared";
import { filterSkills } from "./helpers";

const mk = (name: string, description: string): SkillListItem => ({
  id: name,
  name,
  description,
  type: "custom",
  source: "manual",
  body: "",
  enabled: true,
  version: 1,
  created_at: "2026-09-01T00:00:00Z",
  agent_count: 0,
  pull_rate: 0,
  accept_rate: 0,
});

describe("filterSkills", () => {
  const skills = [mk("no-over-mocking", "Prefer real collaborators"), mk("api-contract-gate", "Flag breaking Changes")];

  it("returns everything for a blank query", () => {
    expect(filterSkills(skills, "   ")).toHaveLength(2);
  });

  it("matches name and description, case-insensitively", () => {
    expect(filterSkills(skills, "MOCK").map((x) => x.name)).toEqual(["no-over-mocking"]);
    expect(filterSkills(skills, "breaking changes").map((x) => x.name)).toEqual(["api-contract-gate"]);
    expect(filterSkills(skills, "zzz")).toEqual([]);
  });
});
