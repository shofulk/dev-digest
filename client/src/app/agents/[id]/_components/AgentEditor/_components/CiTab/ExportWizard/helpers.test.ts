/* helpers.test.ts — T14 (AC-41, AC-43). */
import { describe, it, expect } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import type { CiFile } from "@devdigest/shared";
import { buildZip, replaceTriggerTypes, zipFileName } from "./helpers";

const WORKFLOW = `name: Renamed review # keep me
on:
  pull_request:
    types: [opened, synchronize]
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: echo extra-step
`;

describe("replaceTriggerTypes", () => {
  it("AC-41: replaces only the types list and keeps comment, extra step and renamed job", () => {
    const out = replaceTriggerTypes(WORKFLOW, ["opened", "synchronize", "reopened"]);
    expect(out).toContain("types: [opened, synchronize, reopened]");
    expect(out.replace("types: [opened, synchronize, reopened]", "types: [opened, synchronize]")).toBe(WORKFLOW);
  });

  it("AC-41: writes the triggers in canonical order", () => {
    expect(replaceTriggerTypes(WORKFLOW, ["reopened", "opened"])).toContain("types: [opened, reopened]");
  });

  it("AC-41: leaves text that does not parse unchanged", () => {
    const broken = "on: [unclosed\n  - : :";
    expect(replaceTriggerTypes(broken, ["opened"])).toBe(broken);
  });

  it("AC-41: leaves a workflow whose `on` is a scalar or a sequence unchanged instead of throwing", () => {
    for (const text of ["on: push\njobs: {}\n", "on: [push]\njobs: {}\n"]) {
      expect(replaceTriggerTypes(text, ["opened"])).toBe(text);
    }
  });
});

describe("zip helpers", () => {
  it("AC-43: zipFileName follows devdigest-ci-<owner>-<name>.zip", () => {
    expect(zipFileName("acme/payments-api")).toBe("devdigest-ci-acme-payments-api.zip");
  });

  it("AC-43: buildZip round-trips every path with its (edited) contents", () => {
    const files: CiFile[] = [
      { path: ".devdigest/memory.jsonl", contents: "", editable: false, size_bytes: 0 },
      { path: ".devdigest/runner/index.js", contents: "console.log(1)", editable: false, size_bytes: 14 },
      { path: ".github/workflows/devdigest-review.yml", contents: WORKFLOW, editable: true, size_bytes: WORKFLOW.length },
    ];
    const out = unzipSync(buildZip(files));
    expect(Object.keys(out).sort()).toEqual(files.map((f) => f.path).sort());
    expect(strFromU8(out[".github/workflows/devdigest-review.yml"]!)).toBe(WORKFLOW);
    expect(strFromU8(out[".devdigest/runner/index.js"]!)).toBe("console.log(1)");
  });
});
