import { z } from 'zod';

/**
 * PR Brief building blocks: Intent, Blast radius, Risks, PR History,
 * Smart Diff. Composed into PrBrief.
 */

// ---- Intent ----
export const Intent = z.object({
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
});
export type Intent = z.infer<typeof Intent>;

/** How confident the classifier is in the derived intent. Gates the reviewer-core
 *  scope filter (only medium/high filter) and caps when a source is missing (AC5). */
export const IntentConfidence = z.enum(['low', 'medium', 'high']);
export type IntentConfidence = z.infer<typeof IntentConfidence>;

/** Kind of reference the classifier resolved from the PR body / changed files. */
export const IntentSourceKind = z.enum([
  'pr_title',
  'pr_body',
  'file_list',
  'linked_issue',
  'doc_link',
  'repo_doc',
  'changed_spec',
  'ticket',
]);
export type IntentSourceKind = z.infer<typeof IntentSourceKind>;

/** Whether a reference's content actually reached the classifier prompt. */
export const IntentSourceStatus = z.enum(['used', 'missing', 'not_fetched']);
export type IntentSourceStatus = z.infer<typeof IntentSourceStatus>;

/** Every reason a `missing`/`not_fetched` source can carry (D1). `IntentSource.reason`
 *  itself stays `z.string().nullish()` so rows written before this enum existed still
 *  parse — this is the runtime list the UI translates against (`reasonKey`). */
export const IntentSourceReason = z.enum([
  'not_found',
  'timeout',
  'phase_timeout',
  'no_token',
  'cross_org',
  'host_not_allowed',
  'unsupported',
  'too_large',
  'no_adapter',
  'cap_reached',
  'fetch_failed',
]);
export type IntentSourceReason = z.infer<typeof IntentSourceReason>;

/**
 * One resolved reference. `ref` is the normalised, loggable identifier
 * (`owner/repo#N`, `owner/repo:path@sha7`, `jira:KEY-12`, `host:<hostname>`) — the
 * only thing ever logged or shown, never the raw URL/query (AC6, AC12).
 */
export const IntentSource = z.object({
  kind: IntentSourceKind,
  ref: z.string(),
  status: IntentSourceStatus,
  reason: z.string().nullish(),
  chars: z.number().int().nullish(),
  truncated: z.boolean().nullish(),
});
export type IntentSource = z.infer<typeof IntentSource>;

// ---- Blast radius ----
export const ChangedSymbol = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbol>;

export const BlastCaller = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
  depth: z.union([z.literal(1), z.literal(2)]).nullish(),
  via: z.string().nullish(),
});
export type BlastCaller = z.infer<typeof BlastCaller>;

export const DownstreamImpact = z.object({
  symbol: z.string(),
  callers: z.array(BlastCaller),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
});
export type DownstreamImpact = z.infer<typeof DownstreamImpact>;

/** Every reason a blast-radius read can be degraded (D2). Mirrors repo-intel's
 *  internal `DegradedReason` one-for-one; kept as a separate enum here because this
 *  contract is the public API/UI shape, not the facade's internal type. */
export const BlastDegradedReason = z.enum([
  'flag_off',
  'index_failed',
  'index_partial',
  'repo_too_large',
  'no_data',
]);
export type BlastDegradedReason = z.infer<typeof BlastDegradedReason>;

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  summary: z.string(),
  degraded: z.boolean().nullish(),
  reason: BlastDegradedReason.nullish(),
  limits: z
    .object({
      max_callers_per_symbol: z.number().int(),
      bfs_depth: z.number().int(),
    })
    .nullish(),
  /** Commit the caller lines were read from; null when not read from the index. */
  indexed_sha: z.string().nullish(),
});
export type BlastRadius = z.infer<typeof BlastRadius>;

// ---- Risks ----
export const RiskSeverity = z.enum(['high', 'medium', 'low']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

/** Closed list of risk kinds a PR Brief can surface (AC-16). */
export const RiskKind = z.enum([
  'auth_surface',
  'dependency',
  'performance',
  'data_migration',
  'api_contract',
  'config_secrets',
  'test_coverage',
  'other',
]);
export type RiskKind = z.infer<typeof RiskKind>;

export const Risk = z.object({
  kind: RiskKind,
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  file_refs: z.array(z.string()),
});
export type Risk = z.infer<typeof Risk>;

export const Risks = z.object({
  risks: z.array(Risk),
});
export type Risks = z.infer<typeof Risks>;

// ---- PR History ----
export const PrHistoryItem = z.object({
  pr_number: z.number().int(),
  title: z.string(),
  merged_at: z.string(),
  author: z.string(),
  files_overlap: z.array(z.string()),
  notes: z.string(),
});
export type PrHistoryItem = z.infer<typeof PrHistoryItem>;

export const PrHistory = z.object({
  history: z.array(PrHistoryItem),
});
export type PrHistory = z.infer<typeof PrHistory>;

// ---- Smart Diff ----
export const SmartDiffRole = z.enum(['core', 'tests', 'wiring', 'docs', 'boilerplate']);
export type SmartDiffRole = z.infer<typeof SmartDiffRole>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  finding_lines: z.array(z.number().int()),
});
export type SmartDiffFile = z.infer<typeof SmartDiffFile>;

export const SmartDiffGroup = z.object({
  role: SmartDiffRole,
  files: z.array(SmartDiffFile),
});
export type SmartDiffGroup = z.infer<typeof SmartDiffGroup>;

export const ProposedSplit = z.object({
  name: z.string(),
  files: z.array(z.string()),
});
export type ProposedSplit = z.infer<typeof ProposedSplit>;

export const SmartDiff = z.object({
  groups: z.array(SmartDiffGroup),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    proposed_splits: z.array(ProposedSplit),
  }),
});
export type SmartDiff = z.infer<typeof SmartDiff>;

// ---- Review focus ----
export const ReviewFocusItem = z.object({
  file: z.string(),
  line: z.number().int().nullable(),
  reason: z.string(),
});
export type ReviewFocusItem = z.infer<typeof ReviewFocusItem>;

// ---- Missing inputs (D6) ----
export const MissingInputName = z.enum(['intent', 'blast', 'description', 'findings', 'document', 'files']);
export type MissingInputName = z.infer<typeof MissingInputName>;

export const MissingInputState = z.enum(['missing', 'stale', 'degraded', 'skipped', 'trimmed']);
export type MissingInputState = z.infer<typeof MissingInputState>;

export const MissingInput = z.object({
  input: MissingInputName,
  state: MissingInputState,
  detail: z.string().nullable(),
});
export type MissingInput = z.infer<typeof MissingInput>;

// ---- Brief generation stats (D1) ----
export const BriefStats = z.object({
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
  cost_usd: z.number().nullable(),
  attempts: z.number().int(),
  duration_ms: z.number().int(),
});
export type BriefStats = z.infer<typeof BriefStats>;

// ---- Composed PR Brief (pr_brief.json + D1 columns) ----
export const PrBrief = z.object({
  pr_id: z.string(),
  head_sha: z.string(),
  summary: z.string(),
  risks: z.array(Risk),
  review_focus: z.array(ReviewFocusItem),
  missing_inputs: z.array(MissingInput),
  model: z.string(),
  provider: z.string(),
  generated_at: z.string(),
  stats: BriefStats,
});
export type PrBrief = z.infer<typeof PrBrief>;

// ---- Brief job phases / SSE events (D3) ----
export const BriefPhase = z.enum(['assembling', 'calling_model', 'grounding', 'saving']);
export type BriefPhase = z.infer<typeof BriefPhase>;

export const BriefJobEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('phase'), phase: BriefPhase }),
  z.object({ type: z.literal('done'), brief: PrBrief }),
  z.object({ type: z.literal('failed'), code: z.string(), message: z.string() }),
]);
export type BriefJobEvent = z.infer<typeof BriefJobEvent>;
