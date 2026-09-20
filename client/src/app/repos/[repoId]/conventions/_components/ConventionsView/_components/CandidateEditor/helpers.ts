/** Pure helpers for CandidateEditor. */

/** A rule must survive trimming; an empty rationale is stored as null, never as "". */
export function canSaveRule(rule: string): boolean {
  return rule.trim().length > 0;
}

export function toRationale(value: string): string | null {
  return value.trim() || null;
}
