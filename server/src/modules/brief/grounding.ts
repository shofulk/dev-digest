// RING 1 — pure functions. Grounds the model's `PrBriefDraft` against the
// PR's changed-file hunk ranges and blast-caller lines, drops whatever does
// not survive, and applies the storage limits (D7, AC-15..AC-24). No I/O.
import { RiskKind, type BlastRadius, type Risk, type ReviewFocusItem } from '@devdigest/shared';
import { BRIEF_MAX_FOCUS, BRIEF_MAX_RISKS, BRIEF_SUMMARY_MAX_CHARS } from './constants.js';
import type { PrBriefDraft } from './prompt.js';

export interface GroundingFile {
  path: string;
  headers: string[];
}

export interface LineRange {
  start: number;
  end: number;
}

/** Hunk range (D7): `@@ -a,b +c,d @@` → new-side range `c..c+d-1`. `d`
 *  omitted means 1; `d = 0` means no range (a pure deletion). */
export function parseHunkRange(header: string): LineRange | null {
  const m = /^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(header);
  if (!m) return null;
  const start = Number(m[1]);
  const length = m[2] !== undefined ? Number(m[2]) : 1;
  if (length === 0) return null;
  return { start, end: start + length - 1 };
}

/** Refs are parsed as `path`, `path:n` or `path:s-e` (D7). */
export function parseFileRef(ref: string): { path: string; range: LineRange | null } {
  const m = /^(.*):(\d+)(?:-(\d+))?$/.exec(ref);
  if (!m) return { path: ref, range: null };
  const start = Number(m[2]);
  const end = m[3] !== undefined ? Number(m[3]) : start;
  return { path: m[1]!, range: { start, end } };
}

function formatRef(path: string, range: LineRange | null): string {
  return range ? `${path}:${range.start}-${range.end}` : path;
}

function overlaps(a: LineRange, b: LineRange): boolean {
  return a.start <= b.end && a.end >= b.start;
}

export interface GroundingIndex {
  changedFiles: Map<string, LineRange[]>;
  /** Caller lines of a file that is a blast caller but NOT a changed file
   *  (`src/caller.ts:line`) — a caller line on a changed file is grounded
   *  by its hunk ranges instead (D7 / INSIGHTS 2026-09-28). */
  callerLines: Map<string, number[]>;
}

/**
 * Build the grounding index once per generation: every changed file's hunk
 * ranges, and every blast-caller file's caller lines (skipping files that
 * are also changed files — those are grounded by hunks, never by caller
 * lines).
 */
export function buildGroundingIndex(files: GroundingFile[], blast: BlastRadius): GroundingIndex {
  const changedFiles = new Map<string, LineRange[]>();
  for (const f of files) {
    const ranges = f.headers.map(parseHunkRange).filter((r): r is LineRange => r !== null);
    changedFiles.set(f.path, ranges);
  }
  const callerLines = new Map<string, number[]>();
  for (const downstream of blast.downstream) {
    for (const caller of downstream.callers) {
      if (changedFiles.has(caller.file)) continue;
      const existing = callerLines.get(caller.file) ?? [];
      existing.push(caller.line);
      callerLines.set(caller.file, existing);
    }
  }
  return { changedFiles, callerLines };
}

/**
 * Ground one `path`/`path:s-e` reference (D7):
 *  - a changed file keeps its range iff it overlaps a hunk range, else keeps
 *    only the path (AC-19);
 *  - a blast-caller-only file keeps its range iff a caller line of that
 *    file lies in it, else keeps only the path (AC-20);
 *  - anything else is dropped entirely (AC-18).
 */
export function groundFileRef(ref: string, index: GroundingIndex): string | null {
  const { path, range } = parseFileRef(ref);

  const hunkRanges = index.changedFiles.get(path);
  if (hunkRanges) {
    if (!range) return path;
    const kept = hunkRanges.some((hunk) => overlaps(range, hunk));
    return kept ? formatRef(path, range) : path;
  }

  const callerLines = index.callerLines.get(path);
  if (callerLines) {
    if (!range) return path;
    const kept = callerLines.some((line) => line >= range.start && line <= range.end);
    return kept ? formatRef(path, range) : path;
  }

  return null;
}

function dedupe(refs: string[]): string[] {
  return [...new Set(refs)];
}

/** AC-16/AC-17/AC-18/AC-21: an unknown `kind` becomes `other`, refs are
 *  grounded and deduplicated, and a risk left with no reference is dropped. */
export function groundRisk(risk: PrBriefDraft['risks'][number], index: GroundingIndex): Risk | null {
  const kind = (RiskKind.options as readonly string[]).includes(risk.kind)
    ? (risk.kind as Risk['kind'])
    : 'other';
  const file_refs = dedupe(
    risk.file_refs.map((ref) => groundFileRef(ref, index)).filter((ref): ref is string => ref !== null),
  );
  if (file_refs.length === 0) return null;
  return { kind, title: risk.title, explanation: risk.explanation, severity: risk.severity, file_refs };
}

/** AC-22/AC-23: a focus item naming a file that was never changed is
 *  dropped entirely; a line outside every hunk of its (changed) file is
 *  kept with the file and reason but a `null` line. */
export function groundFocusItem(
  item: PrBriefDraft['review_focus'][number],
  index: GroundingIndex,
): ReviewFocusItem | null {
  const hunkRanges = index.changedFiles.get(item.file);
  if (!hunkRanges) return null;
  if (item.line === null) return { file: item.file, line: null, reason: item.reason };
  const inHunk = hunkRanges.some((hunk) => item.line! >= hunk.start && item.line! <= hunk.end);
  return { file: item.file, line: inHunk ? item.line : null, reason: item.reason };
}

export interface GroundedDraft {
  summary: string;
  risks: Risk[];
  review_focus: ReviewFocusItem[];
}

/**
 * Ground the whole draft (AC-24) and apply the storage limits (AC-15): the
 * summary is cut to `BRIEF_SUMMARY_MAX_CHARS`, risks and focus items keep
 * only the first `BRIEF_MAX_RISKS`/`BRIEF_MAX_FOCUS` SURVIVORS, in model
 * order — a dropped item never consumes one of the kept slots.
 */
export function groundDraft(draft: PrBriefDraft, index: GroundingIndex): GroundedDraft {
  const summary = draft.summary.slice(0, BRIEF_SUMMARY_MAX_CHARS);
  const risks = draft.risks
    .map((r) => groundRisk(r, index))
    .filter((r): r is Risk => r !== null)
    .slice(0, BRIEF_MAX_RISKS);
  const review_focus = draft.review_focus
    .map((f) => groundFocusItem(f, index))
    .filter((f): f is ReviewFocusItem => f !== null)
    .slice(0, BRIEF_MAX_FOCUS);
  return { summary, risks, review_focus };
}
