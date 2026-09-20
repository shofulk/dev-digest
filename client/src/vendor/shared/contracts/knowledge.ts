import { z } from 'zod';

/**
 * Conformance, Onboarding, Eval, Memory, Conventions, Skills,
 * Agents and their DTOs.
 */

// ---- Conformance ----
export const ConformanceStatus = z.enum(['implemented', 'missing', 'out_of_scope']);
export type ConformanceStatus = z.infer<typeof ConformanceStatus>;

export const ConformanceItem = z.object({
  requirement: z.string(),
  status: ConformanceStatus,
  evidence_file: z.string().nullish(),
  notes: z.string().nullish(),
});
export type ConformanceItem = z.infer<typeof ConformanceItem>;

export const Conformance = z.object({
  spec_id: z.string(),
  spec_title: z.string(),
  items: z.array(ConformanceItem),
  completeness_pct: z.number().min(0).max(100),
});
export type Conformance = z.infer<typeof Conformance>;

// ---- Onboarding ----
export const OnboardingLink = z.object({
  label: z.string(),
  path: z.string(),
});
export type OnboardingLink = z.infer<typeof OnboardingLink>;

export const OnboardingSection = z.object({
  kind: z.string(),
  title: z.string(),
  body: z.string(), // markdown
  diagram: z.string().nullish(), // mermaid
  links: z.array(OnboardingLink),
});
export type OnboardingSection = z.infer<typeof OnboardingSection>;

export const Onboarding = z.object({
  sections: z.array(OnboardingSection),
});
export type Onboarding = z.infer<typeof Onboarding>;

// ---- Eval ----
export const EvalPerTrace = z.object({
  name: z.string(),
  pass: z.boolean(),
  expected: z.unknown(),
  actual: z.unknown(),
});
export type EvalPerTrace = z.infer<typeof EvalPerTrace>;

export const EvalRun = z.object({
  recall: z.number().min(0).max(1),
  precision: z.number().min(0).max(1),
  citation_accuracy: z.number().min(0).max(1),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
  per_trace: z.array(EvalPerTrace),
});
export type EvalRun = z.infer<typeof EvalRun>;

export const EvalOwnerKind = z.enum(['skill', 'agent']);
export type EvalOwnerKind = z.infer<typeof EvalOwnerKind>;

export const EvalCase = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string(),
  input_diff: z.string(),
  input_files: z.unknown(),
  input_meta: z.unknown(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCase = z.infer<typeof EvalCase>;

// ---- Memory ----
export const MemoryScope = z.enum(['repo', 'global', 'team']);
export type MemoryScope = z.infer<typeof MemoryScope>;

export const MemoryKind = z.enum([
  'decision',
  'convention',
  'preference',
  'fact',
  'learning',
]);
export type MemoryKind = z.infer<typeof MemoryKind>;

export const MemorySource = z.object({
  pr: z.number().int().nullish(),
  context: z.string(),
});
export type MemorySource = z.infer<typeof MemorySource>;

export const MemoryItem = z.object({
  content: z.string(),
  scope: MemoryScope,
  kind: MemoryKind,
  confidence: z.number().min(0).max(1),
  sources: z.array(MemorySource),
});
export type MemoryItem = z.infer<typeof MemoryItem>;

// ---- Skills ----
export const SkillType = z.enum(['rubric', 'convention', 'security', 'custom']);
export type SkillType = z.infer<typeof SkillType>;

export const SkillSource = z.enum(['manual', 'imported_url', 'imported_file', 'extracted', 'community']);
export type SkillSource = z.infer<typeof SkillSource>;

export const Skill = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: SkillType,
  source: SkillSource,
  body: z.string(),
  enabled: z.boolean(),
  version: z.number().int(),
  evidence_files: z.array(z.string()).nullish(),
  created_at: z.string(),
  /** Exact token count of the saved body; null when the tokenizer is unavailable. */
  tokens: z.number().int().nullish(),
});
export type Skill = z.infer<typeof Skill>;

/**
 * `GET /skills` row — a Skill plus the card-footer numbers. Rates are attributed per
 * RUN (a run that had the skill in its prompt), over a 30-day window: they do not claim
 * a finding was caused by this skill.
 */
export const SkillListItem = Skill.extend({
  agent_count: z.number().int(),
  pull_rate: z.number(),
  accept_rate: z.number(),
});
export type SkillListItem = z.infer<typeof SkillListItem>;

export const SkillVersionEntry = z.object({
  version: z.number().int(),
  note: z.string().nullish(),
  created_at: z.string(),
  is_current: z.boolean(),
});
export type SkillVersionEntry = z.infer<typeof SkillVersionEntry>;

/**
 * `GET /skills/:id/stats`. Every number is attributed at RUN granularity through
 * `agent_runs.skills_used` over 30 days: a finding is counted for every skill that was in
 * that run's prompt. It is NOT a claim that one skill caused one finding.
 */
export const SkillStats = z.object({
  agent_count: z.number().int(),
  pull_rate: z.number(),
  accept_rate: z.number(),
  findings_30d: z.number().int(),
  agents: z.array(z.object({ id: z.string(), name: z.string() })),
  by_category: z.array(z.object({ category: z.string(), count: z.number().int() })),
});
export type SkillStats = z.infer<typeof SkillStats>;

export const SkillImportIgnoredReason = z.enum([
  'executable',
  'binary',
  'not-markdown',
  'nested-archive',
]);
export type SkillImportIgnoredReason = z.infer<typeof SkillImportIgnoredReason>;

export const SkillImportPreview = z.object({
  name: z.string(),
  description: z.string(),
  type: SkillType,
  body: z.string(),
  source: SkillSource,
  truncated: z.boolean(),
  ignored: z.array(z.object({ path: z.string(), reason: SkillImportIgnoredReason })),
});
export type SkillImportPreview = z.infer<typeof SkillImportPreview>;

export const CommunitySkill = z.object({
  name: z.string(),
  repo: z.string(),
  stars: z.number().int(),
  lang: z.string(),
  desc: z.string(),
});
export type CommunitySkill = z.infer<typeof CommunitySkill>;

// ---- Conventions ----
export const ConventionCategory = z.enum([
  'naming',
  'structure',
  'errors',
  'testing',
  'imports',
  'typing',
  'api',
  'general',
]);
export type ConventionCategory = z.infer<typeof ConventionCategory>;

/**
 * Triage state of a candidate. Three states, not a boolean: a re-scan replaces
 * only `pending` rows, so `rejected` is what keeps a rule the user dismissed
 * from reappearing on every scan.
 */
export const ConventionStatus = z.enum(['pending', 'accepted', 'rejected']);
export type ConventionStatus = z.infer<typeof ConventionStatus>;

/**
 * One extracted house-rule proposal. `evidence_path` / `evidence_line` /
 * `evidence_snippet` are VERIFIED server-side against the checked-out file
 * before the row is written — a candidate whose snippet is not in the file is
 * dropped, never persisted, so everything the UI shows is real code.
 */
export const ConventionCandidate = z.object({
  id: z.string(),
  repo_id: z.string().nullish(),
  category: ConventionCategory,
  rule: z.string(),
  rationale: z.string().nullish(),
  evidence_path: z.string(),
  evidence_line: z.number().int().nullish(),
  evidence_snippet: z.string(),
  confidence: z.number().min(0).max(1),
  status: ConventionStatus,
  created_at: z.string().nullish(),
});
export type ConventionCandidate = z.infer<typeof ConventionCandidate>;

/**
 * Result of `POST /repos/:id/conventions/scan`. The counters explain the gap
 * between what the model proposed and what survived — `dropped_ungrounded` is
 * the code-side evidence gate doing its job, and the UI reports it so a thin
 * result set reads as "the gate worked", not "the feature is broken".
 */
export const ConventionExtractResult = z.object({
  candidates: z.array(ConventionCandidate),
  sampled_files: z.array(z.string()),
  proposed: z.number().int(),
  dropped_ungrounded: z.number().int(),
  dropped_duplicate: z.number().int(),
  model: z.string(),
  cost_usd: z.number().nullish(),
});
export type ConventionExtractResult = z.infer<typeof ConventionExtractResult>;

/**
 * The skill draft assembled from accepted candidates. Persists NOTHING — the
 * user edits it in the modal and then POSTs it to `/skills`, the same
 * preview-then-confirm flow skill import uses.
 */
export const ConventionSkillDraft = z.object({
  name: z.string(),
  description: z.string(),
  type: SkillType,
  body: z.string(),
  evidence_files: z.array(z.string()),
  convention_ids: z.array(z.string()),
});
export type ConventionSkillDraft = z.infer<typeof ConventionSkillDraft>;

// ---- Agents ----
// 'openrouter' routes through the OpenAI-compatible API (OpenAIProvider with a
// custom baseURL) — used by the CI runner for cheap models (DeepSeek/GLM/MiniMax).
export const Provider = z.enum(['openai', 'anthropic', 'openrouter']);
export type Provider = z.infer<typeof Provider>;

// Review execution strategy (matches @devdigest/reviewer-core's ReviewStrategy):
//  - single-pass: send the WHOLE diff in ONE model call (default)
//  - map-reduce:  one model call PER changed file (for very large diffs)
//  - auto:        single-pass, switching to map-reduce when the diff is large
export const ReviewStrategy = z.enum(['single-pass', 'map-reduce', 'auto']);
export type ReviewStrategy = z.infer<typeof ReviewStrategy>;

// CI gate policy — when a review should BLOCK (REQUEST_CHANGES + fail the check)
// vs just comment. Deterministic from finding severities, NOT the model's verdict:
//  - never:    never block, always comment (advisory only)
//  - critical: block iff >=1 CRITICAL finding (default)
//  - warning:  block iff >=1 WARNING or CRITICAL finding
//  - any:      block iff >=1 finding of any severity
export const CiFailOn = z.enum(['never', 'critical', 'warning', 'any']);
export type CiFailOn = z.infer<typeof CiFailOn>;

export const Agent = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  enabled: z.boolean(),
  version: z.number().int(),
  strategy: ReviewStrategy.default('single-pass'),
  ci_fail_on: CiFailOn.default('critical'),
  // Inject repo-intel context (repo skeleton + callers + rank note) into this
  // agent's review prompt. Default on; gated again by the global flag.
  repo_intel: z.boolean().default(true),
});
export type Agent = z.infer<typeof Agent>;

export const AgentSkillLink = z.object({
  agent_id: z.string(),
  skill_id: z.string(),
  order: z.number().int(),
  enabled: z.boolean(),
});
export type AgentSkillLink = z.infer<typeof AgentSkillLink>;

/** `GET /agents/:id/skills` row — the link plus what the tab renders, in one request. */
export const AgentLinkedSkill = AgentSkillLink.extend({
  name: z.string(),
  description: z.string(),
  type: SkillType,
  version: z.number().int(),
  /** The skill's own global `enabled` flag (second gate: link.enabled && skill.enabled). */
  skill_enabled: z.boolean(),
});
export type AgentLinkedSkill = z.infer<typeof AgentLinkedSkill>;

// The immutable config snapshot captured in `agent_versions` whenever an agent's
// config changes (everything but `enabled`). Mirrors the shape written by the
// agents repository — provider/model/prompt/output_schema/strategy/gate/repo_intel
// plus the ordered skill ids linked at snapshot time. Used for reproducibility
// (eval replays a past version) and for surfacing an agent's edit history.
export const AgentVersionConfig = z.object({
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  strategy: ReviewStrategy,
  ci_fail_on: CiFailOn,
  repo_intel: z.boolean(),
  skills: z.array(z.string()),
});
export type AgentVersionConfig = z.infer<typeof AgentVersionConfig>;

export const AgentVersion = z.object({
  agent_id: z.string(),
  version: z.number().int(),
  config: AgentVersionConfig,
  created_at: z.string(),
});
export type AgentVersion = z.infer<typeof AgentVersion>;
