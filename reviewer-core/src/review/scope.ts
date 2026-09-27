import type { Finding } from '@devdigest/shared';

/**
 * Out-of-scope filter (AC9). Pure — no fs/env/DB. Runs AFTER `groundFindings`
 * and BEFORE `scoreFromFindings` in `run.ts`, so an ungrounded finding can
 * never become the "one serious signal" survivor.
 *
 * The MODEL tags `finding.scope` (see prompt.ts SCOPE_RULE); this function is
 * the mechanical gate that actually removes findings, and only when an intent
 * of confidence medium/high was supplied — a low-confidence intent never
 * filters (it may be classified from title + file names alone).
 */

const SEVERITY_RANK: Record<Finding['severity'], number> = {
  CRITICAL: 2,
  WARNING: 1,
  SUGGESTION: 0,
};

/** CRITICAL, or WARNING + security — the one signal that survives a filter. */
function isSerious(f: Finding): boolean {
  return f.severity === 'CRITICAL' || (f.severity === 'WARNING' && f.category === 'security');
}

/**
 * Deterministic ranking among out-of-scope findings, highest first:
 * severity desc → security-category-first → confidence desc → file asc →
 * start_line asc. Used only to pick the single survivor when more than one
 * out-of-scope finding is serious.
 */
function rank(a: Finding, b: Finding): number {
  const sev = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  if (sev !== 0) return sev;
  const secA = a.category === 'security' ? 1 : 0;
  const secB = b.category === 'security' ? 1 : 0;
  if (secA !== secB) return secB - secA;
  const conf = b.confidence - a.confidence;
  if (conf !== 0) return conf;
  const file = a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
  if (file !== 0) return file;
  return a.start_line - b.start_line;
}

export interface ScopeFilterResult {
  kept: Finding[];
  filtered: { finding: Finding; reason: string }[];
  /** True iff the confidence gate let the filter actually run (F9) — the
   *  caller emits its Live Log line whenever this is true, including when
   *  `filtered` ends up empty, so "the filter ran and found nothing to
   *  remove" is distinguishable from "the filter never ran at all". */
  applied: boolean;
}

export function applyScopeFilter(
  findings: Finding[],
  intent: { confidence: 'low' | 'medium' | 'high' } | undefined,
): ScopeFilterResult {
  // No intent, or too uncertain to trust for filtering: identity.
  if (!intent || intent.confidence === 'low') {
    return { kept: findings, filtered: [], applied: false };
  }

  const outOfScope = findings.filter((f) => f.scope === 'out');
  const ranked = [...outOfScope].sort(rank);
  const survivor = ranked.find(isSerious);

  const removed = new Set(outOfScope.filter((f) => f !== survivor));
  const filtered = [...removed].map((finding) => ({
    finding,
    reason: 'out of scope per derived PR intent',
  }));
  // Preserve the model's original ordering for everything that survives.
  const kept = findings.filter((f) => !removed.has(f));
  return { kept, filtered, applied: true };
}
