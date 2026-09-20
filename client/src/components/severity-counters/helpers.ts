import { Severity } from "@devdigest/shared/contracts/findings";
import type { FindingRecord } from "@devdigest/shared";
import { SEVERITY_LEVELS } from "./constants";

export type SeverityCounts = Record<Severity, number>;

/** How many findings sit at each severity. Every level is present (0 when absent), and a
 *  severity outside the contract enum is ignored rather than adding a phantom key. */
export function countBySeverity(findings: FindingRecord[]): SeverityCounts {
  const counts = Object.fromEntries(SEVERITY_LEVELS.map((l) => [l, 0])) as SeverityCounts;
  for (const f of findings) {
    if (f.severity in counts) counts[f.severity] += 1;
  }
  return counts;
}

/** `?severity=` → a severity, or null for absent/unknown values. The contract enum *is*
 *  the allowlist, so a lowercase or invented level simply means "no filter". */
export function parseSeverityParam(raw: string | null): Severity | null {
  if (raw == null) return null;
  const parsed = Severity.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** True when there is nothing to count — the row hides itself instead of showing 0 · 0 · 0. */
export function isEmptyCounts(counts: SeverityCounts): boolean {
  return SEVERITY_LEVELS.every((l) => counts[l] === 0);
}
