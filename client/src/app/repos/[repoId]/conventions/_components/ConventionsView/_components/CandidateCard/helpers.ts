/** Pure helpers for CandidateCard. */

import { CONFIDENCE_OK, CONFIDENCE_WARN } from "./constants";

/** Bar colour for a confidence score — same bands as the ConfidenceNum dot. */
export function confidenceColor(confidence: number): string {
  if (confidence >= CONFIDENCE_OK) return "var(--ok)";
  if (confidence >= CONFIDENCE_WARN) return "var(--warn)";
  return "var(--text-muted)";
}

/** `src/api/users.ts` + line 23 → `src/api/users.ts:23` (the line is optional). */
export function evidenceLabel(path: string, line?: number | null): string {
  return line ? `${path}:${line}` : path;
}
