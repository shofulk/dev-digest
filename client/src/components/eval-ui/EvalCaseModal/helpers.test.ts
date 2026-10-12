import { describe, it, expect } from "vitest";
import type { EvalCaseDraft } from "@devdigest/shared/contracts/eval-ci";
import type { EvalCase } from "@devdigest/shared/contracts/knowledge";
import {
  diffFilePaths,
  emptyForm,
  errorSlot,
  formFromCase,
  formFromDraft,
  isDirty,
  isFromFinding,
  toCaseFields,
  toFromFindingInput,
  type CaseForm,
} from "./helpers";

const fileDiff = (path: string) =>
  [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, "@@ -1,2 +1,3 @@", " one", "+two", " three"].join("\n");

const evalCase = (over: Partial<EvalCase> = {}): EvalCase => ({
  id: "c1",
  owner_kind: "agent",
  owner_id: "a1",
  name: "a case",
  input_diff: fileDiff("src/a.ts"),
  input_files: ["src/a.ts"],
  input_meta: null,
  expected_output: null,
  notes: null,
  ...over,
});

describe("diffFilePaths", () => {
  it("AC70: lists the paths of a two-file diff in order", () => {
    expect(diffFilePaths(`${fileDiff("src/a.ts")}\n${fileDiff("src/b.ts")}`)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("AC70: names a file once even when its header and +++ line repeat it, or the diff repeats", () => {
    expect(diffFilePaths(fileDiff("src/a.ts"))).toEqual(["src/a.ts"]);
    expect(diffFilePaths(`${fileDiff("src/a.ts")}\n${fileDiff("src/b.ts")}\n${fileDiff("src/a.ts")}`)).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  it("AC70: skips a +++ /dev/null line", () => {
    expect(diffFilePaths(["--- a/old.ts", "+++ /dev/null", "@@ -1 +0,0 @@", "-gone"].join("\n"))).toEqual([]);
  });

  it("AC70: finds no file in a bare hunk (guard)", () => {
    expect(diffFilePaths("@@ -1 +1 @@\n+x")).toEqual([]);
  });
});

describe("isDirty", () => {
  it("AC75: is clean for an unchanged copy (guard)", () => {
    expect(isDirty(emptyForm(), { ...emptyForm() })).toBe(false);
  });

  it.each<[string, Partial<CaseForm>]>([
    ["the name", { name: "changed" }],
    ["a line", { start_line: "7" }],
    ["the diff", { input_diff: "diff --git a/x b/x" }],
    ["the PR body", { pr_body: "edited" }],
  ])("AC75: is dirty once %s changes", (_what, change) => {
    expect(isDirty(emptyForm(), { ...emptyForm(), ...change })).toBe(true);
  });
});

describe("errorSlot", () => {
  it("AC71: puts a name error beside the name", () => {
    expect(errorSlot("invalid_name")).toBe("name");
  });

  it.each(["invalid_diff", "frozen_diff_too_large"])("AC71: puts %s beside the diff", (code) => {
    expect(errorSlot(code)).toBe("diff");
  });

  it("AC71: puts an ungrounded expectation beside the expectation", () => {
    expect(errorSlot("expectation_not_grounded")).toBe("expectation");
  });

  it.each([
    "locked_field",
    "run_in_flight",
    "provider_not_configured",
    "dry_run_timeout",
    "dry_run_failed",
    "bogus",
    undefined,
  ])("AC71: puts %s above the footer", (code) => {
    expect(errorSlot(code)).toBe("form");
  });
});

describe("isFromFinding", () => {
  it("AC76: is true when input_meta holds a string source_finding_id", () => {
    expect(isFromFinding(evalCase({ input_meta: { source_finding_id: "f1", pr_title: "T" } }))).toBe(true);
  });

  it.each<[string, unknown]>([
    ["no source_finding_id", { pr_title: "T" }],
    ["a null source_finding_id", { source_finding_id: null }],
    ["a numeric source_finding_id", { source_finding_id: 7 }],
    ["a null meta", null],
    ["a non-object meta", "junk"],
  ])("AC76: is false for %s", (_what, input_meta) => {
    expect(isFromFinding(evalCase({ input_meta }))).toBe(false);
  });
});

describe("formFromCase", () => {
  it("AC68: reads the name, notes, PR text and expectation, with lines as strings", () => {
    const form = formFromCase(
      evalCase({
        name: "stripe-key-leak",
        notes: "why it matters",
        input_meta: { source_finding_id: "f1", pr_title: "Add b", pr_body: "Adds b." },
        expected_output: {
          type: "must_not_flag",
          file: "src/a.ts",
          start_line: 2,
          end_line: 4,
          severity: "CRITICAL",
          category: "security",
          title: "Key in source",
        },
      }),
    );
    expect(form).toEqual({
      name: "stripe-key-leak",
      notes: "why it matters",
      pr_title: "Add b",
      pr_body: "Adds b.",
      input_diff: fileDiff("src/a.ts"),
      type: "must_not_flag",
      file: "src/a.ts",
      start_line: "2",
      end_line: "4",
      severity: "CRITICAL",
      category: "security",
      title: "Key in source",
    });
  });

  it("AC68: falls back to empty strings, must_find, SUGGESTION and bug when the stored JSON is missing or malformed", () => {
    for (const bad of [{ input_meta: null, expected_output: null }, { input_meta: "junk", expected_output: 42 }]) {
      expect(formFromCase(evalCase({ ...bad, notes: null }))).toMatchObject({
        notes: "",
        pr_title: "",
        pr_body: "",
        type: "must_find",
        file: "",
        start_line: "",
        end_line: "",
        severity: "SUGGESTION",
        category: "bug",
        title: "",
      });
    }
  });
});

describe("formFromDraft", () => {
  const draft: EvalCaseDraft = {
    name: "original-finding-at-line-3",
    input_diff: fileDiff("src/a.ts"),
    input_files: ["src/a.ts"],
    pr_title: "Add the thing",
    pr_body: "This PR adds the thing.",
    notes: "The branch is never asserted.",
    expectation: {
      type: "must_find",
      file: "src/a.ts",
      start_line: 3,
      end_line: 5,
      severity: "WARNING",
      category: "test",
      title: "Original finding",
    },
  };

  it("AC68: copies the draft into the form, with lines as strings", () => {
    expect(formFromDraft(draft)).toEqual({
      name: "original-finding-at-line-3",
      notes: "The branch is never asserted.",
      pr_title: "Add the thing",
      pr_body: "This PR adds the thing.",
      input_diff: fileDiff("src/a.ts"),
      type: "must_find",
      file: "src/a.ts",
      start_line: "3",
      end_line: "5",
      severity: "WARNING",
      category: "test",
      title: "Original finding",
    });
  });

  it("AC68: shows a null notes or PR text as an empty field", () => {
    expect(formFromDraft({ ...draft, notes: null, pr_title: null, pr_body: null })).toMatchObject({
      name: "original-finding-at-line-3",
      notes: "",
      pr_title: "",
      pr_body: "",
    });
  });
});

describe("toCaseFields", () => {
  const filled: CaseForm = {
    name: "a case",
    notes: "why",
    pr_title: "T",
    pr_body: "B",
    input_diff: fileDiff("src/a.ts"),
    type: "must_find",
    file: "src/a.ts",
    start_line: "2",
    end_line: "4",
    severity: "WARNING",
    category: "bug",
    title: "ex",
  };

  it("AC77: turns the line strings into integers", () => {
    const { expectation } = toCaseFields(filled);
    expect(expectation.start_line).toBe(2);
    expect(expectation.end_line).toBe(4);
    expect(Number.isInteger(expectation.start_line)).toBe(true);
  });

  it("AC77: turns empty optional strings into null and keeps filled ones", () => {
    expect(toCaseFields({ ...filled, notes: "", pr_title: "", pr_body: "" })).toMatchObject({
      notes: null,
      pr_title: null,
      pr_body: null,
    });
    expect(toCaseFields(filled)).toMatchObject({ notes: "why", pr_title: "T", pr_body: "B" });
  });
});

describe("toFromFindingInput", () => {
  const form: CaseForm = {
    ...emptyForm(),
    name: "renamed",
    input_diff: fileDiff("src/a.ts"),
    file: "src/a.ts",
    start_line: "2",
    end_line: "4",
    title: "ex",
  };

  it("AC77: carries no input_diff and no expectation type (the server takes both from the finding) (guard)", () => {
    const input = toFromFindingInput(form);
    expect(input).not.toHaveProperty("input_diff");
    expect(input.expectation).not.toHaveProperty("type");
    expect(input.expectation).toMatchObject({ file: "src/a.ts", start_line: 2, end_line: 4 });
    expect(input.name).toBe("renamed");
  });
});
