/* EvalCaseModal/helpers.ts — pure form logic (no React, no directive). Contract imports are
   types only: a value import from `@devdigest/shared` 500s the dev server. */
import type {
  EvalCaseDraft,
  EvalCaseFields,
  EvalCaseFromFindingInput,
  EvalExpectation,
} from "@devdigest/shared/contracts/eval-ci";
import type { EvalCase } from "@devdigest/shared/contracts/knowledge";

export type CaseForm = {
  name: string;
  notes: string;
  pr_title: string;
  pr_body: string;
  input_diff: string;
  type: EvalExpectation["type"];
  file: string;
  start_line: string;
  end_line: string;
  severity: EvalExpectation["severity"];
  category: EvalExpectation["category"];
  title: string;
};

export type ErrorSlot = "name" | "diff" | "expectation" | "form";

export function emptyForm(): CaseForm {
  return {
    name: "",
    notes: "",
    pr_title: "",
    pr_body: "",
    input_diff: "",
    type: "must_find",
    file: "",
    start_line: "",
    end_line: "",
    severity: "WARNING",
    category: "bug",
    title: "",
  };
}

export const EXPECTATION_TYPES: readonly EvalExpectation["type"][] = ["must_find", "must_not_flag"];
export const SEVERITIES: readonly EvalExpectation["severity"][] = ["CRITICAL", "WARNING", "SUGGESTION"];
export const CATEGORIES: readonly EvalExpectation["category"][] = ["bug", "security", "perf", "style", "test"];

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const lineText = (v: unknown): string => (typeof v === "number" && Number.isFinite(v) ? String(v) : "");

function oneOf<T extends string>(allowed: readonly T[], v: unknown, fallback: T): T {
  return allowed.find((a) => a === v) ?? fallback;
}

export function formFromDraft(d: EvalCaseDraft): CaseForm {
  return {
    name: d.name,
    notes: d.notes ?? "",
    pr_title: d.pr_title ?? "",
    pr_body: d.pr_body ?? "",
    input_diff: d.input_diff,
    type: d.expectation.type,
    file: d.expectation.file,
    start_line: String(d.expectation.start_line),
    end_line: String(d.expectation.end_line),
    severity: d.expectation.severity,
    category: d.expectation.category,
    title: d.expectation.title,
  };
}

/** Reads a stored case; the jsonb columns are untrusted, so every field falls back on its own. */
export function formFromCase(c: EvalCase): CaseForm {
  const meta = asRecord(c.input_meta);
  const exp = asRecord(c.expected_output);
  return {
    name: c.name,
    notes: c.notes ?? "",
    pr_title: str(meta?.pr_title),
    pr_body: str(meta?.pr_body),
    input_diff: c.input_diff,
    type: oneOf(EXPECTATION_TYPES, exp?.type, "must_find"),
    file: str(exp?.file),
    start_line: lineText(exp?.start_line),
    end_line: lineText(exp?.end_line),
    severity: oneOf(SEVERITIES, exp?.severity, "SUGGESTION"),
    category: oneOf(CATEGORIES, exp?.category, "bug"),
    title: str(exp?.title),
  };
}

/** Paths of the files a unified diff changes (from its `+++` lines), once each, in order. */
export function diffFilePaths(diff: string): string[] {
  const paths: string[] = [];
  for (const line of diff.split("\n")) {
    if (!line.startsWith("+++ ")) continue;
    const raw = (line.slice(4).split("\t")[0] ?? "").trim();
    if (!raw || raw === "/dev/null") continue;
    const path = raw.replace(/^b\//, "");
    if (!paths.includes(path)) paths.push(path);
  }
  return paths;
}

export function isDirty(initial: CaseForm, current: CaseForm): boolean {
  return (Object.keys(initial) as (keyof CaseForm)[]).some((k) => initial[k] !== current[k]);
}

/** Where an API error code is shown: beside the field it names, else above the footer. */
export function errorSlot(code: string | undefined): ErrorSlot {
  switch (code) {
    case "invalid_name":
      return "name";
    case "invalid_diff":
    case "frozen_diff_too_large":
      return "diff";
    case "expectation_not_grounded":
      return "expectation";
    default:
      return "form";
  }
}

/** A case frozen from a finding keeps its type and diff; only a string source id says so. */
export function isFromFinding(c: EvalCase): boolean {
  return typeof asRecord(c.input_meta)?.source_finding_id === "string";
}

const orNull = (v: string): string | null => (v === "" ? null : v);

export function toCaseFields(f: CaseForm): EvalCaseFields {
  return {
    name: f.name,
    notes: orNull(f.notes),
    pr_title: orNull(f.pr_title),
    pr_body: orNull(f.pr_body),
    input_diff: f.input_diff,
    expectation: {
      type: f.type,
      file: f.file,
      start_line: Number(f.start_line),
      end_line: Number(f.end_line),
      severity: f.severity,
      category: f.category,
      title: f.title,
    },
  };
}

export function toFromFindingInput(f: CaseForm): EvalCaseFromFindingInput {
  const { type: _type, ...expectation } = toCaseFields(f).expectation;
  return {
    name: f.name,
    notes: orNull(f.notes),
    pr_title: orNull(f.pr_title),
    pr_body: orNull(f.pr_body),
    expectation,
  };
}
