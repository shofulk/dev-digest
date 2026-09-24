import { describe, it, expect } from "vitest";
import type { AgentLinkedSkill } from "@devdigest/shared";
import {
  countEnabled,
  filterLinks,
  moveItem,
  reorderBy,
  reorderTo,
  sortByOrder,
  toSetItems,
  unlinkedSkills,
} from "./helpers";

const link = (id: string, order: number, over: Partial<AgentLinkedSkill> = {}): AgentLinkedSkill => ({
  agent_id: "ag1",
  skill_id: id,
  order,
  enabled: true,
  name: id,
  description: `${id} description`,
  type: "rubric",
  version: 1,
  skill_enabled: true,
  ...over,
});

const LINKS = [link("a", 0), link("b", 1, { enabled: false }), link("c", 2)];
const ids = (l: readonly AgentLinkedSkill[] | null) => l?.map((x) => x.skill_id);

describe("sortByOrder / countEnabled / filterLinks", () => {
  it("sorts by order without mutating, and counts LINKS", () => {
    const shuffled = [LINKS[2]!, LINKS[0]!, LINKS[1]!];
    expect(ids(sortByOrder(shuffled))).toEqual(["a", "b", "c"]);
    expect(ids(shuffled)).toEqual(["c", "a", "b"]);
    expect(countEnabled(LINKS)).toEqual({ enabled: 2, total: 3 });
    expect(countEnabled([])).toEqual({ enabled: 0, total: 0 });
  });

  it("filters name and description case-insensitively; blank returns everything", () => {
    const list = [link("Auth-Rubric", 0), link("naming", 1, { description: "Use camelCase" })];
    expect(ids(filterLinks(list, "  AUTH "))).toEqual(["Auth-Rubric"]);
    expect(ids(filterLinks(list, "camelcase"))).toEqual(["naming"]);
    expect(ids(filterLinks(list, "   "))).toEqual(["Auth-Rubric", "naming"]);
    expect(filterLinks(list, "zzz")).toEqual([]);
  });
});

describe("reordering", () => {
  it("moveItem puts the item at the target index and ignores bad indexes", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b", "c"], 1, 5)).toEqual(["a", "b", "c"]);
  });

  it("reorderBy moves one step and is null at the edges or for an unknown id", () => {
    expect(ids(reorderBy(LINKS, "a", 1))).toEqual(["b", "a", "c"]);
    expect(ids(reorderBy(LINKS, "c", -1))).toEqual(["a", "c", "b"]);
    expect(reorderBy(LINKS, "a", -1)).toBeNull();
    expect(reorderBy(LINKS, "c", 1)).toBeNull();
    expect(reorderBy(LINKS, "nope", 1)).toBeNull();
  });

  it("reorderTo drops the dragged skill onto the target's position", () => {
    expect(ids(reorderTo(LINKS, "a", "c"))).toEqual(["b", "c", "a"]);
    expect(ids(reorderTo(LINKS, "c", "a"))).toEqual(["c", "a", "b"]);
    expect(reorderTo(LINKS, "a", "a")).toBeNull();
    expect(reorderTo(LINKS, "a", "nope")).toBeNull();
  });

  it("a reorder never re-enables a skill: toSetItems carries each row's CURRENT enabled", () => {
    const moved = reorderBy(LINKS, "b", -1)!;
    expect(toSetItems(moved)).toEqual([
      { skill_id: "b", enabled: false },
      { skill_id: "a", enabled: true },
      { skill_id: "c", enabled: true },
    ]);
  });
});

describe("unlinkedSkills", () => {
  it("returns the workspace skills that have no link yet", () => {
    const all = [{ id: "a" }, { id: "b" }, { id: "x" }, { id: "y" }];
    expect(unlinkedSkills(all, LINKS).map((s) => s.id)).toEqual(["x", "y"]);
  });
});
