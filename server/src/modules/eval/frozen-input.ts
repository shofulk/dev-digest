import type {
  EvalCaseMeta,
  EvalExpectation,
  EvalExpectationType,
  Finding,
  FindingCategory,
  Severity,
  UnifiedDiff,
} from '@devdigest/shared';
import { groundFindings } from '@devdigest/reviewer-core';
import { CASE_NAME_MAX, CASE_NAME_SLUG_MAX, MAX_FROZEN_DIFF_BYTES } from './constants.js';

/**
 * Freezing a triaged finding into an eval case — ring 1, PURE. Everything a case
 * needs is copied into it at creation time (the diff, the PR text, the
 * expectation), so later edits to the finding or the PR never change it.
 */

export type FreezeFailure = 'no_diff_available' | 'frozen_diff_too_large' | 'expectation_not_grounded';

/** The slice of a stored finding that freezing reads. */
export interface FreezableFinding {
  id: string;
  file: string;
  startLine: number;
  endLine: number;
  severity: string;
  category: string;
  title: string;
  rationale: string;
}

export interface FrozenCase {
  name: string;
  input_diff: string;
  input_files: string[];
  input_meta: EvalCaseMeta;
  expected_output: EvalExpectation;
  notes: string;
}

export type FreezeResult =
  | { ok: true; value: FrozenCase }
  | { ok: false; code: FreezeFailure };

// Persisted as free text; narrowed with a local set rather than a cast, so an
// unrecognised stored value falls back instead of passing straight through.
const SEVERITIES = new Set<Severity>(['CRITICAL', 'WARNING', 'SUGGESTION']);
const CATEGORIES = new Set<FindingCategory>(['bug', 'security', 'perf', 'style', 'test']);

function severityOf(raw: string): Severity {
  const s = raw.toUpperCase() as Severity;
  return SEVERITIES.has(s) ? s : 'SUGGESTION';
}

function categoryOf(raw: string): FindingCategory {
  const c = raw.toLowerCase() as FindingCategory;
  return CATEGORIES.has(c) ? c : 'bug';
}

/** Accepted → `must_find`, dismissed → `must_not_flag`, untriaged → `null`. */
export function expectationTypeOf(triage: {
  acceptedAt: Date | null;
  dismissedAt: Date | null;
}): EvalExpectationType | null {
  if (triage.acceptedAt) return 'must_find';
  if (triage.dismissedAt) return 'must_not_flag';
  return null;
}

/** A stored file patch wrapped in the header `parseUnifiedDiff` expects. */
export function buildFrozenDiff(path: string, patch: string): string {
  return [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, patch].join('\n');
}

/** The title slug: lowercase, `-`-separated and length-capped; `finding` when nothing survives. */
export function caseName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, CASE_NAME_SLUG_MAX)
    .replace(/-+$/, '');
  return slug || 'finding';
}

/** The expectation as a finding, so the review gate's grounding rule can test it. */
function probeOf(expectation: EvalExpectation, id: string, rationale: string): Finding {
  return {
    id,
    severity: expectation.severity,
    category: expectation.category,
    title: expectation.title,
    file: expectation.file,
    start_line: expectation.start_line,
    end_line: expectation.end_line,
    rationale,
    confidence: 1,
  };
}

export function freezeCase(input: {
  finding: FreezableFinding;
  type: EvalExpectationType;
  reviewId: string;
  pull: { number: number; title: string; body: string | null };
  patch: string | null;
  now: Date;
  /** The unified-diff parser, injected by the composition edge. */
  parseDiff: (text: string) => UnifiedDiff;
}): FreezeResult {
  const { finding, type, pull, patch } = input;
  if (!patch) return { ok: false, code: 'no_diff_available' };

  const inputDiff = buildFrozenDiff(finding.file, patch);
  if (new TextEncoder().encode(inputDiff).length > MAX_FROZEN_DIFF_BYTES) {
    return { ok: false, code: 'frozen_diff_too_large' };
  }

  const expectation: EvalExpectation = {
    type,
    file: finding.file,
    start_line: finding.startLine,
    end_line: finding.endLine,
    severity: severityOf(finding.severity),
    category: categoryOf(finding.category),
    title: finding.title,
  };

  // Same rule as the review gate: the expectation must cite a line of its own diff.
  const probe = probeOf(expectation, finding.id, finding.rationale);
  if (groundFindings([probe], input.parseDiff(inputDiff)).kept.length !== 1) {
    return { ok: false, code: 'expectation_not_grounded' };
  }

  return {
    ok: true,
    value: {
      name: caseName(finding.title),
      input_diff: inputDiff,
      input_files: [finding.file],
      input_meta: {
        source_finding_id: finding.id,
        source_review_id: input.reviewId,
        pr_number: pull.number,
        pr_title: pull.title,
        pr_body: pull.body,
        created_at: input.now.toISOString(),
      },
      expected_output: expectation,
      notes: finding.rationale,
    },
  };
}

export type CaseFieldFailure =
  | 'invalid_name'
  | 'frozen_diff_too_large'
  | 'invalid_diff'
  | 'expectation_not_grounded';

/**
 * Validates the form fields of a hand-written or edited case. Precedence:
 * name (only with `checkName`) → byte size (before parsing) → diff shape →
 * expectation grounding. On success returns the trimmed name and the paths of the
 * files that have at least one hunk, in diff order.
 */
export function validateCaseFields(
  input: { name?: string; input_diff: string; expectation: EvalExpectation },
  parseDiff: (text: string) => UnifiedDiff,
  opts: { checkName: boolean },
): { ok: true; value: { name: string; input_files: string[] } } | { ok: false; code: CaseFieldFailure } {
  const name = (input.name ?? '').trim();
  if (opts.checkName && (name === '' || name.length > CASE_NAME_MAX)) {
    return { ok: false, code: 'invalid_name' };
  }
  if (new TextEncoder().encode(input.input_diff).length > MAX_FROZEN_DIFF_BYTES) {
    return { ok: false, code: 'frozen_diff_too_large' };
  }

  const diff = parseDiff(input.input_diff);
  const paths: string[] = [];
  for (const file of diff.files) {
    if (file.path && file.hunks.length > 0 && !paths.includes(file.path)) paths.push(file.path);
  }
  if (paths.length === 0) return { ok: false, code: 'invalid_diff' };

  const { expectation } = input;
  if (!paths.includes(expectation.file)) return { ok: false, code: 'expectation_not_grounded' };
  if (groundFindings([probeOf(expectation, 'case-fields', '')], diff).kept.length !== 1) {
    return { ok: false, code: 'expectation_not_grounded' };
  }
  return { ok: true, value: { name, input_files: paths } };
}
