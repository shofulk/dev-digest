import { z } from 'zod';
import { Verdict, Finding, Severity, FindingCategory } from './findings.js';
import { EvalCase, EvalRun, EvalOwnerKind, Conformance, Provider, CiFailOn } from './knowledge.js';

/**
 * A4 — Eval / CI / Compose / Conformance API contracts (L06).
 *
 * These EXTEND the barrel; they do not modify existing contract files. The base
 * `EvalRun`, `EvalCase`, `EvalOwnerKind`, `Conformance` live in `knowledge.ts`;
 * here we add the *API-facing* request/response shapes (records persisted in
 * `eval_runs`, `composed_reviews`, `ci_installations`, `ci_runs`,
 * `conformance_checks`) plus the eval-dashboard aggregate.
 */

// ===========================================================================
// Eval — case input + persisted run record + dashboard
// ===========================================================================

/** Create/update payload for an eval case (id + owner resolved by the route). */
export const EvalCaseInput = z.object({
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string().min(1),
  input_diff: z.string().default(''),
  input_files: z.unknown().nullish(),
  input_meta: z.unknown().nullish(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCaseInput = z.infer<typeof EvalCaseInput>;

/** A persisted eval run row (one execution of a case), returned by the API. */
export const EvalRunRecord = z.object({
  id: z.string(),
  case_id: z.string(),
  case_name: z.string().nullish(),
  ran_at: z.string(),
  actual_output: z.unknown(),
  pass: z.boolean().nullable(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
});
export type EvalRunRecord = z.infer<typeof EvalRunRecord>;

/** Result of running a single case: the metrics (EvalRun) + the persisted row id. */
export const EvalRunResult = z.object({
  run_id: z.string(),
  case_id: z.string(),
  result: EvalRun,
});
export type EvalRunResult = z.infer<typeof EvalRunResult>;

/** One point on the dashboard trend (per run, chronological). */
export const EvalTrendPoint = z.object({
  ran_at: z.string(),
  recall: z.number(),
  precision: z.number(),
  citation_accuracy: z.number(),
  pass_rate: z.number(),
  cost_usd: z.number().nullable(),
});
export type EvalTrendPoint = z.infer<typeof EvalTrendPoint>;

/** Aggregate dashboard for an owner (agent/skill) or the whole workspace. */
export const EvalDashboard = z.object({
  owner_kind: EvalOwnerKind.nullable(),
  owner_id: z.string().nullable(),
  cases_total: z.number().int(),
  current: z.object({
    recall: z.number(),
    precision: z.number(),
    citation_accuracy: z.number(),
    traces_passed: z.number().int(),
    traces_total: z.number().int(),
    cost_usd: z.number().nullable(),
  }),
  delta: z.object({
    recall: z.number(),
    precision: z.number(),
    citation_accuracy: z.number(),
  }),
  trend: z.array(EvalTrendPoint),
  recent_runs: z.array(EvalRunRecord),
  alert: z.string().nullable(),
});
export type EvalDashboard = z.infer<typeof EvalDashboard>;

// ---------------------------------------------------------------------------
// Eval pipeline — frozen cases from triaged findings, suite runs, compare
// ---------------------------------------------------------------------------

/** `must_find` from an accepted finding, `must_not_flag` from a dismissed one. */
export const EvalExpectationType = z.enum(['must_find', 'must_not_flag']);
export type EvalExpectationType = z.infer<typeof EvalExpectationType>;

/** What a case expects: a finding at `file:start_line-end_line` (or none there). */
export const EvalExpectation = z.object({
  type: EvalExpectationType,
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  severity: Severity,
  category: FindingCategory,
  title: z.string(),
});
export type EvalExpectation = z.infer<typeof EvalExpectation>;

/** `eval_cases.input_meta` (jsonb, read back): every field is optional; `source_finding_id` is present only for cases frozen from a finding. */
export const EvalCaseMeta = z.object({
  source_finding_id: z.string().nullish(),
  source_review_id: z.string().nullish(),
  pr_number: z.number().int().nullish(),
  pr_title: z.string().nullish(),
  pr_body: z.string().nullish(),
  created_at: z.string().nullish(),
});
export type EvalCaseMeta = z.infer<typeof EvalCaseMeta>;

/** Response of `POST /findings/:id/eval-case`: the case plus whether this call made it. */
export const EvalCaseCreated = EvalCase.extend({ created: z.boolean() });
export type EvalCaseCreated = z.infer<typeof EvalCaseCreated>;

/** Latest result of a case, from the newest completed run. */
export const EvalCaseResult = z.enum(['pass', 'fail', 'errored', 'never_run']);
export type EvalCaseResult = z.infer<typeof EvalCaseResult>;

/** A case as listed for an agent: the row, its parsed expectation and its latest result. */
export const EvalCaseView = z.object({
  case: EvalCase,
  expectation: EvalExpectation.nullable(),
  last_result: EvalCaseResult,
  last_run_id: z.string().nullish(),
  /** Findings of the newest completed run that matched the expectation; null = never run / errored. */
  last_matched: z.number().int().nullish(),
  /** A run for this case is pending right now. */
  running: z.boolean(),
});
export type EvalCaseView = z.infer<typeof EvalCaseView>;

export const EvalRowStatus = z.enum(['pending', 'completed', 'errored']);
export type EvalRowStatus = z.infer<typeof EvalRowStatus>;

/** A finding the agent produced for a case (grounded ones only). */
const EvalActualFinding = z.object({
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  severity: Severity,
  category: FindingCategory,
  title: z.string(),
});

/**
 * `eval_runs.actual_output` (jsonb, read back). Only the four fields written when the
 * pending row is inserted are required; everything else is nullish (legacy-safe).
 */
export const EvalRunActualOutput = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_version: z.number().int(),
  status: EvalRowStatus,
  findings: z.array(EvalActualFinding).nullish(),
  grounding_kept: z.number().int().nullish(),
  grounding_dropped: z.number().int().nullish(),
  reason: z.string().nullish(),
  finished_at: z.string().nullish(),
  one_case: z.boolean().nullish(),
  /** Read leniently (`unknown`): a legacy value pinned by `updateCase` may not parse as an `EvalExpectation`; the reader degrades it instead of dropping the row. */
  expectation: z.unknown().nullish(),
});
export type EvalRunActualOutput = z.infer<typeof EvalRunActualOutput>;

export const EvalSuiteStatus = z.enum(['running', 'completed']);
export type EvalSuiteStatus = z.infer<typeof EvalSuiteStatus>;

/** Run-level metrics (non-errored cases only). `null` = not computable. */
export const EvalRunMetrics = z.object({
  recall: z.number().min(0).max(1).nullable(),
  precision: z.number().min(0).max(1).nullable(),
  citation_accuracy: z.number().min(0).max(1).nullable(),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  cases_errored: z.number().int(),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
});
export type EvalRunMetrics = z.infer<typeof EvalRunMetrics>;

/** One suite run (the rows sharing a `run_id`), with its metrics. */
export const EvalSuiteRun = EvalRunMetrics.extend({
  run_id: z.string(),
  agent_id: z.string(),
  status: EvalSuiteStatus,
  agent_version: z.number().int(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  cases_total: z.number().int(),
  cases_done: z.number().int(),
});
export type EvalSuiteRun = z.infer<typeof EvalSuiteRun>;

/** One case inside a suite run. */
export const EvalCaseOutcome = z.object({
  case_id: z.string(),
  name: z.string(),
  expectation: EvalExpectation.nullable(),
  status: EvalRowStatus,
  pass: z.boolean().nullable(),
  findings: z.array(EvalActualFinding.extend({ matched: z.boolean() })),
  grounding_kept: z.number().int(),
  grounding_dropped: z.number().int(),
  reason: z.string().nullish(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
});
export type EvalCaseOutcome = z.infer<typeof EvalCaseOutcome>;

/** Response of `GET /eval-runs/:runId`. */
export const EvalSuiteRunDetail = EvalSuiteRun.extend({ per_case: z.array(EvalCaseOutcome) });
export type EvalSuiteRunDetail = z.infer<typeof EvalSuiteRunDetail>;

/** Response of `POST /agents/:id/eval-runs` (202). */
export const EvalStartRunResponse = z.object({
  run_id: z.string().uuid(),
  cases_total: z.number().int(),
});
export type EvalStartRunResponse = z.infer<typeof EvalStartRunResponse>;

/** `b − a` per metric; `null` when either side is `null`. */
export const EvalMetricDelta = z.object({
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  cost_usd: z.number().nullable(),
});
export type EvalMetricDelta = z.infer<typeof EvalMetricDelta>;

/** A case both runs share whose pass state differs. */
export const EvalCaseFlip = z.object({
  case_id: z.string(),
  name: z.string(),
  a_pass: z.boolean(),
  b_pass: z.boolean(),
  direction: z.enum(['pass_to_fail', 'fail_to_pass']),
});
export type EvalCaseFlip = z.infer<typeof EvalCaseFlip>;

export const EvalPromptDiffLine = z.object({
  op: z.enum(['same', 'add', 'del']),
  text: z.string(),
});
export type EvalPromptDiffLine = z.infer<typeof EvalPromptDiffLine>;

const EvalCaseRef = z.object({ case_id: z.string(), name: z.string() });

/** Response of `GET /eval-runs/compare?a&b`. */
export const EvalCompare = z.object({
  a: EvalSuiteRun,
  b: EvalSuiteRun,
  delta: EvalMetricDelta,
  flips: z.array(EvalCaseFlip),
  only_in_a: z.array(EvalCaseRef),
  only_in_b: z.array(EvalCaseRef),
  prompt_diff: z.array(EvalPromptDiffLine),
  /** false when either version has no stored `system_prompt` (then `prompt_diff` is empty). */
  prompt_available: z.boolean(),
});
export type EvalCompare = z.infer<typeof EvalCompare>;

/** Query of `GET /eval-runs/compare`. */
export const EvalCompareQuery = z.object({ a: z.string().uuid(), b: z.string().uuid() });
export type EvalCompareQuery = z.infer<typeof EvalCompareQuery>;

/** One dashboard row: an agent with at least one case. */
export const EvalDashboardAgent = z.object({
  agent_id: z.string(),
  name: z.string(),
  model: z.string(),
  cases_total: z.number().int(),
  /** Newest completed run, or `null` when the agent was never run. */
  latest: EvalSuiteRun.nullable(),
  /** Last 10 completed runs, oldest first (sparklines). */
  trend: z.array(
    z.object({
      run_id: z.string(),
      started_at: z.string(),
      recall: z.number().nullable(),
      precision: z.number().nullable(),
    }),
  ),
});
export type EvalDashboardAgent = z.infer<typeof EvalDashboardAgent>;

/** Response of `GET /eval/dashboard`. */
export const EvalDashboardOverview = z.object({
  agents: z.array(EvalDashboardAgent),
  /** The 20 most recent suite runs across all agents, newest first. */
  recent_runs: z.array(EvalSuiteRun.extend({ agent_name: z.string() })),
});
export type EvalDashboardOverview = z.infer<typeof EvalDashboardOverview>;

/** Body of `POST /eval/runs/all` — an explicit confirmation, one model call per case. */
export const EvalRunAllInput = z.object({
  confirm: z.literal(true),
});
export type EvalRunAllInput = z.infer<typeof EvalRunAllInput>;

/** Why one agent was not started by run-all. */
export const EvalRunAllRefusal = z.enum(['run_in_flight', 'provider_not_configured', 'no_cases', 'start_failed']);
export type EvalRunAllRefusal = z.infer<typeof EvalRunAllRefusal>;

/** One agent's outcome in run-all: a started `run_id`, or a refusal reason. */
export const EvalRunAllEntry = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  run_id: z.string().uuid().nullable(),
  refused_reason: EvalRunAllRefusal.nullable(),
});
export type EvalRunAllEntry = z.infer<typeof EvalRunAllEntry>;

/** Response of `POST /eval/runs/all`. */
export const EvalRunAllResult = z.object({
  started: z.array(EvalRunAllEntry),
});
export type EvalRunAllResult = z.infer<typeof EvalRunAllResult>;

/** Editable fields of an eval case (hand-written, edited, or from a finding). */
export const EvalCaseFields = z.object({
  name: z.string(),
  notes: z.string().max(4096).nullish(),
  pr_title: z.string().max(300).nullish(),
  pr_body: z.string().max(65536).nullish(),
  input_diff: z.string(),
  expectation: EvalExpectation,
});
export type EvalCaseFields = z.infer<typeof EvalCaseFields>;

/** Body of `POST /findings/:id/eval-case`: the fields without the diff; the type is implied by the verdict. */
export const EvalCaseFromFindingInput = EvalCaseFields.omit({ input_diff: true }).extend({
  expectation: EvalExpectation.omit({ type: true }),
});
export type EvalCaseFromFindingInput = z.infer<typeof EvalCaseFromFindingInput>;

/** A prefilled, unsaved case built from a finding. */
export const EvalCaseDraft = z.object({
  name: z.string(),
  input_diff: z.string(),
  input_files: z.array(z.string()),
  pr_title: z.string().nullable(),
  pr_body: z.string().nullable(),
  expectation: EvalExpectation,
  notes: z.string().nullable(),
});
export type EvalCaseDraft = z.infer<typeof EvalCaseDraft>;

/** Response of `GET /findings/:id/eval-case-draft`. */
export const EvalCaseDraftResponse = z.object({
  agent_id: z.string(),
  existing_case: EvalCase.nullable(),
  draft: EvalCaseDraft.nullable(),
});
export type EvalCaseDraftResponse = z.infer<typeof EvalCaseDraftResponse>;

/** Response of `POST /agents/:id/eval-cases/dry-run`: nothing is stored. */
export const EvalDryRunResult = z.object({
  pass: z.boolean(),
  findings: z.array(EvalActualFinding.extend({ matched: z.boolean() })),
  grounding_kept: z.number().int(),
  grounding_dropped: z.number().int(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int(),
  agent_version: z.number().int(),
});
export type EvalDryRunResult = z.infer<typeof EvalDryRunResult>;

// ===========================================================================
// Compose Review
// ===========================================================================

export const ComposeReviewInput = z.object({
  /** Finding ids to fold into the draft (optional — body may be hand-written). */
  finding_ids: z.array(z.string()).default([]),
  /** Editable markdown body. If omitted, the server composes one from findings. */
  body: z.string().nullish(),
  verdict: Verdict.default('comment'),
  /** When true, attach selected findings as inline comments (path+line+body). */
  inline_comments: z.boolean().default(false),
});
export type ComposeReviewInput = z.infer<typeof ComposeReviewInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type ComposeReviewInputBody = z.input<typeof ComposeReviewInput>;

/** A persisted composed review (mirrors the `composed_reviews` row). */
export const ComposedReview = z.object({
  id: z.string(),
  pr_id: z.string(),
  body: z.string(),
  verdict: Verdict.nullable(),
  posted_at: z.string().nullable(),
  github_review_id: z.string().nullable(),
});
export type ComposedReview = z.infer<typeof ComposedReview>;

/** A preview (no GitHub side-effect) of what would be posted. */
export const ComposeReviewPreview = z.object({
  body: z.string(),
  verdict: Verdict,
  inline_comments: z.array(
    z.object({ path: z.string(), line: z.number().int(), body: z.string() }),
  ),
});
export type ComposeReviewPreview = z.infer<typeof ComposeReviewPreview>;

// ===========================================================================
// Export-to-CI + CI Runs
// ===========================================================================

export const CiTarget = z.enum(['gha', 'circle', 'jenkins', 'cli']);
export type CiTarget = z.infer<typeof CiTarget>;

/** When the shared workflow runs. Canonical order is this enum's order. */
export const CiTrigger = z.enum(['opened', 'synchronize', 'reopened']);
export type CiTrigger = z.infer<typeof CiTrigger>;

/** Where the runner posts its result. */
export const CiPostAs = z.enum(['github_review', 'pr_comment', 'none']);
export type CiPostAs = z.infer<typeof CiPostAs>;

/** One agent's verdict on one pull request. */
export const CiVerdict = z.enum(['blocked', 'passed', 'no_findings', 'failed']);
export type CiVerdict = z.infer<typeof CiVerdict>;

/** `pr_open` — export PR opened; `manual` — files handed over; `active` — a result came back. */
export const CiInstallationStatus = z.enum(['pr_open', 'manual', 'active']);
export type CiInstallationStatus = z.infer<typeof CiInstallationStatus>;

/** Version of the `devdigest-result.json` artifact. */
export const CI_RESULT_VERSION = 1;

/** One file in the CI bundle. `contents` is null for the runner in previews. */
export const CiFile = z.object({
  path: z.string(),
  contents: z.string().nullable(),
  editable: z.boolean(),
  size_bytes: z.number().int(),
});
export type CiFile = z.infer<typeof CiFile>;

/**
 * AgentManifest — the agent contract shared by the studio and the CI runner.
 *
 * The studio WRITES this shape to `.devdigest/agents/<slug>-<id8>.yaml`; the CI
 * runner READS it. One Zod schema for both ends keeps the formats from drifting.
 * `skills` are the ordered active skill slugs.
 */
export const AgentManifest = z.object({
  agent_id: z.string().min(1),
  name: z.string().min(1),
  version: z.number().int().positive(),
  provider: Provider.default('openrouter'),
  model: z.string().min(1),
  system_prompt: z.string(),
  // Tolerate both a missing key and an explicit `null` (YAML `skills:` with no
  // value parses to null, which `.default([])` does NOT catch) — normalize both
  // to an empty array so manifests without skills validate cleanly.
  skills: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  strategy: z.enum(['auto', 'single-pass', 'map-reduce']).default('auto'),
  post_as: CiPostAs.default('github_review'),
  // CI gate policy (see CiFailOn) — when the posted review should BLOCK
  // (REQUEST_CHANGES + fail the check) vs just comment. Default: block on critical.
  ci_fail_on: CiFailOn.default('critical'),
});
export type AgentManifest = z.infer<typeof AgentManifest>;
/** Caller-facing input type — `.default()` fields stay optional. */
export type AgentManifestInput = z.input<typeof AgentManifest>;

/** Request body for `POST /agents/:id/ci/preview`. */
export const CiPreviewInput = z.object({
  repo_id: z.string().uuid(),
  triggers: z.array(CiTrigger).min(1),
  post_as: CiPostAs,
});
export type CiPreviewInput = z.infer<typeof CiPreviewInput>;

/** Response of `POST /agents/:id/ci/preview`. */
export const CiPreview = z.object({ files: z.array(CiFile) });
export type CiPreview = z.infer<typeof CiPreview>;

/** Request body for `POST /agents/:id/export-ci`. */
export const CiExportInput = z.object({
  repo: z.string().min(1), // "owner/name"
  target: z.enum(['gha']).default('gha'),
  /** "open_pr" opens a PR with the files; "files" just returns them. */
  action: z.enum(['open_pr', 'files']).default('open_pr'),
  post_as: CiPostAs.default('github_review'),
  triggers: z.array(CiTrigger).min(1).default(['opened', 'synchronize']),
  /** The edited workflow text; omitted when the user did not edit it. */
  workflow: z.string().max(65536).nullish(),
});
export type CiExportInput = z.infer<typeof CiExportInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type CiExportInputBody = z.input<typeof CiExportInput>;

/** A CI installation (mirrors `ci_installations`) with its newest run. */
export const CiInstallation = z.object({
  id: z.string(),
  agent_id: z.string(),
  repo: z.string(),
  target_type: CiTarget,
  installed_at: z.string(),
  status: CiInstallationStatus,
  installed_agent_version: z.number().int(),
  pr_url: z.string().nullable(),
  triggers: z.array(CiTrigger),
  post_as: CiPostAs,
  last_run: z.object({ verdict: CiVerdict, ran_at: z.string() }).nullable(),
});
export type CiInstallation = z.infer<typeof CiInstallation>;

/** Response of `POST /agents/:id/export-ci`. */
export const CiExport = z.object({
  installation: CiInstallation,
  files: z.array(CiFile),
  pr_url: z.string().nullable(),
});
export type CiExport = z.infer<typeof CiExport>;

/** A CI run as listed on the agent's CI tab and the CI Runs page. */
export const CiRun = z.object({
  id: z.string(),
  repo: z.string(),
  pr_number: z.number().int().nullable(),
  pr_url: z.string().nullable(),
  agent_id: z.string(),
  agent_name: z.string(),
  verdict: CiVerdict,
  findings_count: z.number().int(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
  github_url: z.string().nullable(),
  ran_at: z.string(),
});
export type CiRun = z.infer<typeof CiRun>;

/** Response of `GET /agents/:id/ci`. */
export const CiAgentCi = z.object({
  installations: z.array(CiInstallation),
  runs: z.array(CiRun),
});
export type CiAgentCi = z.infer<typeof CiAgentCi>;

/** Response of `GET /ci/runs`. */
export const CiRunsList = z.object({ items: z.array(CiRun) });
export type CiRunsList = z.infer<typeof CiRunsList>;

/** Response of `POST /ci/refresh`. */
export const CiRefreshResult = z.object({
  stored: z.number().int(),
  skipped: z.number().int(),
  degraded: z.array(z.object({ repo: z.string(), reason: z.string() })),
});
export type CiRefreshResult = z.infer<typeof CiRefreshResult>;

/** One agent's result inside `devdigest-result.json`. */
export const CiAgentResult = z.object({
  agent_id: z.string(),
  agent_version: z.number().int(),
  verdict: CiVerdict,
  critical: z.number().int(),
  warning: z.number().int(),
  suggestion: z.number().int(),
  findings_count: z.number().int(),
  blockers: z.number().int(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
  model: z.string().nullable(),
  error_code: z.string().nullable(),
});
export type CiAgentResult = z.infer<typeof CiAgentResult>;

/**
 * The artifact uploaded by the CI workflow (`devdigest-result.json`).
 * Pulled back on refresh to populate `agent_runs` + `ci_runs`.
 */
export const CiResultArtifact = z.object({
  version: z.number().int(),
  pr_number: z.number().int(),
  head_sha: z.string(),
  results: z.array(CiAgentResult),
});
export type CiResultArtifact = z.infer<typeof CiResultArtifact>;

// ===========================================================================
// Conformance (PRD ↔ PR) — API record (the analysis shape is `Conformance`)
// ===========================================================================

/** Request body for `POST /pulls/:id/conformance`. */
export const ConformanceInput = z.object({
  /** Spec path/id to compare against; if omitted, the first available spec. */
  spec: z.string().nullish(),
  provider: z.enum(['openai', 'anthropic', 'openrouter']).nullish(),
  model: z.string().nullish(),
});
export type ConformanceInput = z.infer<typeof ConformanceInput>;

/** A persisted conformance check (mirrors `conformance_checks` + the report). */
export const ConformanceReport = z.object({
  id: z.string(),
  pr_id: z.string(),
  report: Conformance,
});
export type ConformanceReport = z.infer<typeof ConformanceReport>;

// ===========================================================================
// Hooks (Secret-Leak + Phantom-API detectors) — emit grounding-exempt findings
// ===========================================================================

export const HookKind = z.enum(['secret_leak', 'phantom']);
export type HookKind = z.infer<typeof HookKind>;

/** Result of running the built-in detectors over a PR. */
export const HookScanResult = z.object({
  pr_id: z.string(),
  review_id: z.string().nullable(),
  findings: z.array(Finding),
});
export type HookScanResult = z.infer<typeof HookScanResult>;
