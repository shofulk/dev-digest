import { z } from 'zod';
import { Finding, Verdict } from './findings.js';
import { BlastRadius, BriefPhase, Intent, IntentConfidence, IntentSource, PrBrief, SmartDiff } from './brief.js';

/**
 * A2 — Review-Core API surface contracts. These extend the core
 * Review/Finding/Intent/SmartDiff contracts with the persisted/transport shapes
 * the reviewer endpoints return. A2 owns this file; the barrel re-exports it.
 *
 * Distinct from `Finding` (the raw LLM-output unit): `FindingRecord` adds the
 * persisted row identity + action timestamps so the UI can render accept/dismiss
 * state and the `review_id` it belongs to.
 */

export const FindingRecord = Finding.extend({
  review_id: z.string(),
  accepted_at: z.string().nullable(),
  dismissed_at: z.string().nullable(),
});
export type FindingRecord = z.infer<typeof FindingRecord>;

/** A persisted review with its kept findings + grounding summary. */
export const ReviewRecord = z.object({
  id: z.string(),
  pr_id: z.string(),
  agent_id: z.string().nullable(),
  run_id: z.string().nullable(),
  agent_name: z.string().nullish(),
  kind: z.enum(['summary', 'review']),
  verdict: Verdict.nullable(),
  summary: z.string().nullable(),
  score: z.number().int().nullable(),
  model: z.string().nullable(),
  grounding: z.string().nullish(),
  created_at: z.string(),
  findings: z.array(FindingRecord),
});
export type ReviewRecord = z.infer<typeof ReviewRecord>;

/**
 * Response of `POST /pulls/:id/review`. Each requested agent produces a run that
 * streams over SSE at `/runs/:runId/events`; clients subscribe per run. The
 * persisted reviews are also returned once the (synchronous) run completes.
 */
export const ReviewRunTarget = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
});
export type ReviewRunTarget = z.infer<typeof ReviewRunTarget>;

export const ReviewRunResponse = z.object({
  pr_id: z.string(),
  runs: z.array(ReviewRunTarget),
  reviews: z.array(ReviewRecord),
});
export type ReviewRunResponse = z.infer<typeof ReviewRunResponse>;

/**
 * Intent persisted for a PR. `missing_context` is DERIVED (some source isn't
 * `used`), never stored. `stale` is derived at read time against the PR's
 * CURRENT `head_sha` — never trusted from the stored row.
 */
export const PrIntentRecord = Intent.extend({
  pr_id: z.string(),
  confidence: IntentConfidence,
  missing_context: z.boolean(),
  sources: z.array(IntentSource),
  head_sha: z.string().nullable(),
  current_head_sha: z.string(),
  stale: z.boolean(),
  model: z.string().nullish(),
  derived_at: z.string().nullish(),
});
export type PrIntentRecord = z.infer<typeof PrIntentRecord>;

/** Response of `GET /pulls/:id/intent` — `null` when never derived. */
export const PrIntentResponse = z.object({ intent: PrIntentRecord.nullable() });
export type PrIntentResponse = z.infer<typeof PrIntentResponse>;

/** Smart-diff response for a PR (the SmartDiff). */
export const SmartDiffResponse = SmartDiff;
export type SmartDiffResponse = z.infer<typeof SmartDiffResponse>;

/** Blast-radius response for a PR (the BlastRadius). */
export const BlastRadiusResponse = BlastRadius;
export type BlastRadiusResponse = z.infer<typeof BlastRadiusResponse>;

// ---- PR Brief API ----

/** The job currently generating a brief for a PR (D2). */
export const PrBriefJob = z.object({ id: z.string(), phase: BriefPhase });
export type PrBriefJob = z.infer<typeof PrBriefJob>;

/** Response of `GET /pulls/:id/brief` — no model call, ever (AC-26). */
export const PrBriefResponse = z.object({
  brief: PrBrief.nullable(),
  current_head_sha: z.string(),
  outdated: z.boolean(),
  job: PrBriefJob.nullable(),
});
export type PrBriefResponse = z.infer<typeof PrBriefResponse>;

/** Body of `POST /pulls/:id/brief/generate`. */
export const GenerateBriefBody = z.object({ force: z.boolean().optional() }).default({});
export type GenerateBriefBody = z.infer<typeof GenerateBriefBody>;

/** A generation job was started (or is already running) in the background. */
export const GenerateBriefAccepted = z.object({ job_id: z.string(), reused: z.boolean() });
export type GenerateBriefAccepted = z.infer<typeof GenerateBriefAccepted>;

/** No generation was needed: the stored brief already describes the PR's head. */
export const GenerateBriefCurrent = z.object({ brief: PrBrief });
export type GenerateBriefCurrent = z.infer<typeof GenerateBriefCurrent>;

export const GenerateBriefResponse = z.union([GenerateBriefAccepted, GenerateBriefCurrent]);
export type GenerateBriefResponse = z.infer<typeof GenerateBriefResponse>;
