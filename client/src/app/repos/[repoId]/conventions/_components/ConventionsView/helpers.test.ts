import { describe, it, expect } from "vitest";
import type { ConventionCandidate } from "@devdigest/shared";
import {
  buildCandidateUrl,
  countByStatus,
  filterCandidates,
  githubEvidenceUrl,
  selectedSkillIds,
} from "./helpers";

function candidate(over: Partial<ConventionCandidate> = {}): ConventionCandidate {
  return {
    id: "c1",
    repo_id: "r1",
    category: "naming",
    rule: "Name hooks use*",
    rationale: null,
    evidence_path: "src/lib/hooks/skills.ts",
    evidence_line: 12,
    evidence_snippet: "export function useSkills()",
    confidence: 0.8,
    status: "pending",
    created_at: "2026-09-01T00:00:00Z",
    ...over,
  };
}

const BOARD: ConventionCandidate[] = [
  candidate({ id: "p-low", status: "pending", confidence: 0.4 }),
  candidate({ id: "acc", status: "accepted", confidence: 0.9 }),
  candidate({ id: "p-high", status: "pending", confidence: 0.95 }),
  candidate({ id: "rej", status: "rejected", confidence: 0.6 }),
];

describe("filterCandidates", () => {
  it("keeps only the filtered status and sorts by confidence, highest first", () => {
    expect(filterCandidates(BOARD, "pending").map((c) => c.id)).toEqual(["p-high", "p-low"]);
    expect(filterCandidates(BOARD, "accepted").map((c) => c.id)).toEqual(["acc"]);
    expect(filterCandidates(BOARD, "rejected").map((c) => c.id)).toEqual(["rej"]);
  });

  it("`all` keeps every status, still sorted by confidence", () => {
    expect(filterCandidates(BOARD, "all").map((c) => c.id)).toEqual(["p-high", "acc", "rej", "p-low"]);
  });

  it("never sorts the caller's array in place", () => {
    const input = [...BOARD];
    filterCandidates(input, "all");
    expect(input.map((c) => c.id)).toEqual(["p-low", "acc", "p-high", "rej"]);
  });

  it("returns an empty list rather than throwing on an empty board", () => {
    expect(filterCandidates([], "all")).toEqual([]);
  });
});

describe("countByStatus", () => {
  it("counts every triage state plus the total", () => {
    expect(countByStatus(BOARD)).toEqual({ pending: 2, accepted: 1, rejected: 1, all: 4 });
  });

  it("is all zeroes for an empty board", () => {
    expect(countByStatus([])).toEqual({ pending: 0, accepted: 0, rejected: 0, all: 0 });
  });
});

describe("githubEvidenceUrl", () => {
  it("builds a blob link to the exact line", () => {
    expect(githubEvidenceUrl("acme/api", "main", "src/index.ts", 42)).toBe(
      "https://github.com/acme/api/blob/main/src/index.ts#L42",
    );
  });

  it("drops the anchor when there is no line, and falls back to HEAD with no branch", () => {
    expect(githubEvidenceUrl("acme/api", undefined, "src/index.ts")).toBe(
      "https://github.com/acme/api/blob/HEAD/src/index.ts",
    );
    expect(githubEvidenceUrl("acme/api", "main", "src/index.ts", null)).toBe(
      "https://github.com/acme/api/blob/main/src/index.ts",
    );
  });

  it("encodes each path segment but keeps the separators", () => {
    expect(githubEvidenceUrl("acme/api", "feat/a b", "src/my dir/a#b.ts", 3)).toBe(
      "https://github.com/acme/api/blob/feat%2Fa%20b/src/my%20dir/a%23b.ts#L3",
    );
  });

  it("returns null — not a dead link — without a repo or a path", () => {
    expect(githubEvidenceUrl(undefined, "main", "src/index.ts", 1)).toBeNull();
    expect(githubEvidenceUrl("acme/api", "main", "", 1)).toBeNull();
  });
});

describe("buildCandidateUrl", () => {
  const path = "/repos/r1/conventions";

  it("sets ?candidate= and keeps every other param", () => {
    expect(buildCandidateUrl(path, "filter=accepted", "c9")).toBe(
      `${path}?filter=accepted&candidate=c9`,
    );
  });

  it("replaces an existing candidate rather than appending a second one", () => {
    expect(buildCandidateUrl(path, "candidate=c1", "c2")).toBe(`${path}?candidate=c2`);
  });

  it("null removes the param, and an otherwise empty query leaves a bare path", () => {
    expect(buildCandidateUrl(path, "candidate=c1", null)).toBe(path);
    expect(buildCandidateUrl(path, "candidate=c1&filter=all", null)).toBe(`${path}?filter=all`);
  });

  it("encodes an id that needs it", () => {
    expect(buildCandidateUrl(path, "", "a b&c")).toBe(`${path}?candidate=a+b%26c`);
  });
});

describe("selectedSkillIds", () => {
  it("is every accepted id when nothing is excluded", () => {
    const board = [...BOARD, candidate({ id: "acc2", status: "accepted" })];
    expect(selectedSkillIds(board, new Set())).toEqual(["acc", "acc2"]);
  });

  it("drops the excluded ones and never includes a pending or rejected id", () => {
    const board = [...BOARD, candidate({ id: "acc2", status: "accepted" })];
    expect(selectedSkillIds(board, new Set(["acc"]))).toEqual(["acc2"]);
    expect(selectedSkillIds(board, new Set(["p-high", "rej"]))).toEqual(["acc", "acc2"]);
  });

  it("is empty when every accepted id is excluded", () => {
    expect(selectedSkillIds(BOARD, new Set(["acc"]))).toEqual([]);
  });
});
