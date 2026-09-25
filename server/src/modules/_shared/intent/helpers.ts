// RING 1 — pure functions. Confidence caps (AC3/AC5) and the row → API-record
// mapper (`stale`/`missing_context` are DERIVED, never stored). No I/O — C1
// forbids importing the persistence row-type module here (A8); `IntentRowData`
// below is a structural interface the real `PrIntentRow` (and any fake row a
// probe/test builds) satisfies without either side importing the other.
import type { IntentConfidence, IntentSource, IntentSourceKind, PrIntentRecord } from '@devdigest/shared';
import { MIN_BODY_CHARS_FOR_SUBSTANCE } from './constants.js';
import type { IntentClassification } from './prompt.js';

/** Structural shape of a `pr_intent` row — everything `toPrIntentRecord`
 *  needs, named here instead of importing the persistence row-type module
 *  (C1/A8). */
export interface IntentRowData {
  prId: string;
  intent: string;
  inScope: string[];
  outOfScope: string[];
  confidence: string;
  sources: unknown;
  headSha: string | null;
  model: string | null;
  derivedAt: Date;
}

/** Sources that are ALWAYS present (never a "reference" that could be missing)
 *  — `pr_title`/`pr_body`/`file_list` come straight from the DB row already in
 *  hand and never fail to fetch. Only a REFERENCED source (issue/doc/ticket/…)
 *  can be `missing`/`not_fetched`, so only these count toward `missing_context`
 *  and the AC5 confidence cap (F7 — an empty/short body is AC3's case alone,
 *  never AC5's). */
export function isReferencedSource(kind: IntentSourceKind): boolean {
  return kind !== 'pr_title' && kind !== 'pr_body' && kind !== 'file_list';
}

/** AC12 — persisted in `pr_intent.stats`; content-free by construction (only
 *  counts + normalised refs, never body/issue/doc/diff text). */
export interface IntentDerivationStats {
  provider: string;
  model: string;
  sections: { name: string; chars: number; tokens_est: number; truncated: boolean }[];
  tokens_est_total: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number | null;
  attempts: number;
  duration_ms: number;
  sources: {
    kind: string;
    ref: string;
    status: string;
    reason?: string | null;
    chars?: number | null;
    truncated?: boolean | null;
  }[];
}

export function isBodySubstantial(body: string | null | undefined): boolean {
  return (body ?? '').trim().length >= MIN_BODY_CHARS_FOR_SUBSTANCE;
}

/**
 * AC3 + AC5 confidence caps, applied AFTER the model returns its own guess:
 * - an insubstantial body with no other source fetched forces `low`;
 * - any missing/not_fetched referenced source caps `high` down to `medium`.
 */
export function applyConfidenceCaps(
  modelConfidence: IntentConfidence,
  opts: { bodySubstantial: boolean; anyOtherSourceUsed: boolean; anyMissing: boolean },
): IntentConfidence {
  let confidence = modelConfidence;
  if (!opts.bodySubstantial && !opts.anyOtherSourceUsed) confidence = 'low';
  if (opts.anyMissing && confidence === 'high') confidence = 'medium';
  return confidence;
}

/** Classification + cap in one step, for callers that only have the raw model output. */
export function capConfidence(
  classification: Pick<IntentClassification, 'confidence'>,
  opts: { bodySubstantial: boolean; anyOtherSourceUsed: boolean; anyMissing: boolean },
): IntentConfidence {
  return applyConfidenceCaps(classification.confidence, opts);
}

/** `pr_intent` row → the API/persisted shape. `stale` and `missing_context`
 *  are derived here, never trusted from a stored column. `missing_context`
 *  counts REFERENCED sources only (F7) — `pr_title`/`pr_body`/`file_list`
 *  never set it, even when the body was empty/short (that is AC3's case). */
export function toPrIntentRecord(row: IntentRowData, currentHeadSha: string): PrIntentRecord {
  const sources = (row.sources as IntentSource[] | null) ?? [];
  return {
    pr_id: row.prId,
    intent: row.intent,
    in_scope: row.inScope,
    out_of_scope: row.outOfScope,
    confidence: row.confidence as IntentConfidence,
    missing_context: sources.some((s) => isReferencedSource(s.kind) && s.status !== 'used'),
    sources,
    head_sha: row.headSha,
    current_head_sha: currentHeadSha,
    stale: row.headSha !== currentHeadSha,
    model: row.model,
    derived_at: row.derivedAt.toISOString(),
  };
}
