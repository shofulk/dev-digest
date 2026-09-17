import type { FindingRecord, Severity } from "@devdigest/shared";
import { LOW_CONFIDENCE_THRESHOLD, SEVERITY_ORDER } from "./constants";

export interface FindingsFilter {
  /** Drop findings below LOW_CONFIDENCE_THRESHOLD. */
  hideLow: boolean;
  /** Keep only this severity; null keeps them all. */
  severity: Severity | null;
}

/** The single place the panel's filters are applied: severity, then confidence, then sort
 *  by severity weight. An options object because the next filter should not have to become
 *  a third positional boolean. */
export function visibleFindings(
  findings: FindingRecord[],
  { hideLow, severity }: FindingsFilter,
): FindingRecord[] {
  let shown = findings;
  if (severity) shown = shown.filter((f) => f.severity === severity);
  if (hideLow) shown = shown.filter((f) => f.confidence >= LOW_CONFIDENCE_THRESHOLD);
  return [...shown].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
}
