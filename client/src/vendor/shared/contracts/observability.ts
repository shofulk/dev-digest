import { z } from 'zod';
import { Severity } from './findings.js';
import { ReviewRunTarget } from './review-api.js';

/**
 * A5 — Observability / Multi-agent contracts (L07).
 *
 * These are NEW contracts (A5 owns this file; the barrel re-exports it). They
 * sit alongside A2's `review-api.ts`:
 *   - MultiAgentRun        the read model of GET /multi-agent-runs/:id
 *   - MultiAgentRunSummary one row of GET /repos/:id/multi-agent-runs
 *   - AgentColumn          one agent's column in the multi-agent view
 *   - Conflict / ConflictTake  where agents disagree on the same file:line
 *   - AgentStats           per-agent quality aggregates (GET /agents/:id/stats)
 *   - CuratorResult        the cross-session memory curator outcome
 *
 * The single-document run trace itself stays in `contracts/trace.ts` (RunTrace).
 */

// ---------------------------------------------------------------------------
// Multi-Agent Review
// ---------------------------------------------------------------------------

/** A finding as surfaced in a multi-agent column (subset of FindingRecord). */
export const AgentColumnFinding = z.object({
  id: z.string(),
  severity: Severity,
  category: z.string(),
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  kind: z.string().nullish(),
  /** True when a memory row from Learn exists for this finding. */
  learned: z.boolean().nullish(),
});
export type AgentColumnFinding = z.infer<typeof AgentColumnFinding>;

/** One agent's result column in the multi-agent review. */
export const AgentColumn = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  status: z.enum(['done', 'failed', 'running', 'cancelled']),
  verdict: z.string().nullable(),
  score: z.number().int().nullable(),
  summary: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  /** Failure reason of a `failed` run; null otherwise. */
  error: z.string().nullable(),
  findings: z.array(AgentColumnFinding),
});
export type AgentColumn = z.infer<typeof AgentColumn>;

/** One agent's stance on a contended file:line. */
export const ConflictTake = z.object({
  agent_id: z.string(),
  persona: z.string(),
  /** Severity if the agent flagged it, or 'ignored' when it did not. */
  verdict: z.union([Severity, z.literal('ignored')]),
  note: z.string(),
});
export type ConflictTake = z.infer<typeof ConflictTake>;

/**
 * A conflict = a file:line that at least one agent flagged and at least one
 * other agent (that also reviewed) did NOT, OR where agents assigned divergent
 * severities. Computed from persisted findings; not stored.
 */
export const Conflict = z.object({
  file: z.string(),
  line: z.number().int(),
  title: z.string(),
  takes: z.array(ConflictTake),
  /** True when agents disagree (flagged vs not, or divergent severities). */
  is_conflict: z.boolean(),
});
export type Conflict = z.infer<typeof Conflict>;

/** Response of GET /multi-agent-runs/:id. */
export const MultiAgentRun = z.object({
  id: z.string(),
  pr_id: z.string(),
  pr_number: z.number().int().nullish(),
  ran_at: z.string(),
  agent_count: z.number().int(),
  total_duration_ms: z.number().int(),
  total_cost_usd: z.number().nullable(),
  columns: z.array(AgentColumn),
  conflicts: z.array(Conflict),
  /** PR head SHA recorded when the multi-run started. */
  head_sha: z.string().nullable(),
  /** True when the PR's current head SHA differs from `head_sha`. */
  stale: z.boolean(),
});
export type MultiAgentRun = z.infer<typeof MultiAgentRun>;

/** Overall status of a multi-run in the run list: running, done, partial (some done, some not) or failed. */
export const MultiAgentRunStatus = z.enum(['running', 'done', 'partial', 'failed']);
export type MultiAgentRunStatus = z.infer<typeof MultiAgentRunStatus>;

/** One row of GET /repos/:id/multi-agent-runs. */
export const MultiAgentRunSummary = z.object({
  id: z.string(),
  pr_id: z.string(),
  pr_number: z.number().int(),
  pr_title: z.string(),
  ran_at: z.string(),
  agent_count: z.number().int(),
  status: MultiAgentRunStatus,
  total_duration_ms: z.number().int(),
  total_cost_usd: z.number().nullable(),
});
export type MultiAgentRunSummary = z.infer<typeof MultiAgentRunSummary>;

/** Body of POST /pulls/:id/multi-agent-run. */
export const MultiAgentRunRequest = z.object({ agent_ids: z.array(z.string().min(1)).min(1).max(20) });
export type MultiAgentRunRequest = z.infer<typeof MultiAgentRunRequest>;

/** Response of POST /pulls/:id/multi-agent-run: answered before any agent finishes. */
export const MultiAgentRunStarted = z.object({
  multi_agent_run_id: z.string(),
  pr_id: z.string(),
  runs: z.array(ReviewRunTarget),
});
export type MultiAgentRunStarted = z.infer<typeof MultiAgentRunStarted>;

/** Response of POST /multi-agent-runs/:id/cancel. */
export const MultiAgentCancelResult = z.object({ ok: z.boolean(), run_ids: z.array(z.string()) });
export type MultiAgentCancelResult = z.infer<typeof MultiAgentCancelResult>;

/** Response of POST /multi-agent-runs/:id/agents/:agentId/retry. */
export const MultiAgentRetryResult = z.object({ run_id: z.string() });
export type MultiAgentRetryResult = z.infer<typeof MultiAgentRetryResult>;

/** One agent's run estimate (GET /run-estimates). */
export const RunEstimate = z.object({
  agent_id: z.string(),
  median_duration_ms: z.number().int().nullable(),
  median_cost_usd: z.number().nullable(),
  sample_size: z.number().int(),
});
export type RunEstimate = z.infer<typeof RunEstimate>;

// ---------------------------------------------------------------------------
// Per-agent Stats (GET /agents/:id/stats)
// ---------------------------------------------------------------------------

/** A single (date, value) point for a sparkline/trend. */
export const StatPoint = z.object({ label: z.string(), value: z.number() });
export type StatPoint = z.infer<typeof StatPoint>;

export const AgentStats = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  runs: z.number().int(),
  findings_total: z.number().int(),
  /** accept-rate is the headline quality signal. 0..1 over acted findings. */
  accepted: z.number().int(),
  dismissed: z.number().int(),
  pending: z.number().int(),
  accept_rate: z.number().nullable(),
  dismiss_rate: z.number().nullable(),
  avg_findings_per_run: z.number().nullable(),
  total_cost_usd: z.number().nullable(),
  avg_cost_usd: z.number().nullable(),
  avg_latency_ms: z.number().nullable(),
  findings_by_severity: z.object({
    CRITICAL: z.number().int(),
    WARNING: z.number().int(),
    SUGGESTION: z.number().int(),
  }),
  /** recent runs for a small trend chart (oldest→newest). */
  trend: z.array(StatPoint),
});
export type AgentStats = z.infer<typeof AgentStats>;

// ---------------------------------------------------------------------------
// Cross-session memory curator
// ---------------------------------------------------------------------------

/** A merge the curator performed (or would perform in dry-run). */
export const CuratorMerge = z.object({
  kept_id: z.string(),
  merged_ids: z.array(z.string()),
  content: z.string(),
  similarity: z.number(),
});
export type CuratorMerge = z.infer<typeof CuratorMerge>;

export const CuratorResult = z.object({
  scanned: z.number().int(),
  merges: z.array(CuratorMerge),
  removed: z.number().int(),
  dry_run: z.boolean(),
});
export type CuratorResult = z.infer<typeof CuratorResult>;
