import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { Finding, RunSummary, RunTrace } from '@devdigest/shared';

/**
 * A2 — review data-access. The ONLY layer touching the DB for the review
 * domain. Owns `reviews`, `findings`, and persists the observability rows
 * `agent_runs` + `run_traces` (one trace doc per run). Workspace scoping is
 * enforced via the PR (which carries workspace_id). The `pr_intent` table's
 * persistence lives under `_shared/repository/` (D2/C1) — read it through the
 * shared `IntentDeriver`'s `read`/`derive` methods, never through this class.
 *
 * The query implementations are colocated, split by aggregate, under
 * `./repository/` (review+findings, agent runs, pull). This class composes
 * them so its public API stays identical.
 */

import type { FindingRow, PullRow } from '../../db/rows.js';
export type { FindingRow, PullRow };

export type ReviewRow = typeof t.reviews.$inferSelect;

import * as reviewRepo from './repository/review.repo.js';
import * as runRepo from './repository/run.repo.js';
import * as pullRepo from './repository/pull.repo.js';
import * as multiRunRepo from './repository/multi-run.repo.js';
import * as memoryRepo from './repository/memory.repo.js';
import type { MemoryRow } from '../../db/rows.js';

export class ReviewRepository {
  constructor(private db: Db) {}

  // ---- PR lookup (workspace-scoped) --------------------------------------

  getPull(workspaceId: string, prId: string): Promise<PullRow | undefined> {
    return pullRepo.getPull(this.db, workspaceId, prId);
  }

  getRepo(repoId: string): Promise<typeof t.repos.$inferSelect | undefined> {
    return pullRepo.getRepo(this.db, repoId);
  }

  getPrFiles(prId: string): Promise<(typeof t.prFiles.$inferSelect)[]> {
    return pullRepo.getPrFiles(this.db, prId);
  }

  /** Replace a PR's imported files (used when a run targets a PR whose page was never opened). */
  replacePrFiles(
    prId: string,
    files: { path: string; additions: number; deletions: number; patch: string | null }[],
  ): Promise<void> {
    return pullRepo.replacePrFiles(this.db, prId, files);
  }

  // ---- reviews + findings -------------------------------------------------

  insertReview(values: {
    workspaceId: string;
    prId: string;
    agentId: string | null;
    runId: string | null;
    kind: 'summary' | 'review';
    verdict: string | null;
    summary: string | null;
    score: number | null;
    model: string | null;
  }): Promise<ReviewRow> {
    return reviewRepo.insertReview(this.db, values);
  }

  insertFindings(reviewId: string, findings: Finding[]): Promise<FindingRow[]> {
    return reviewRepo.insertFindings(this.db, reviewId, findings);
  }

  /** Reviews for a PR (newest first), each with its findings. */
  reviewsForPull(prId: string): Promise<{ review: ReviewRow; findings: FindingRow[] }[]> {
    return reviewRepo.reviewsForPull(this.db, prId);
  }

  getReview(reviewId: string): Promise<ReviewRow | undefined> {
    return reviewRepo.getReview(this.db, reviewId);
  }

  /** In-flight runs for a PR (status='running') — the server-side source of
   *  truth for "which agents are running now". Joined with the agent name. */
  activeRunsForPull(
    workspaceId: string,
    prId: string,
  ): Promise<{ run_id: string; agent_id: string | null; agent_name: string | null; ran_at: string | null }[]> {
    return runRepo.activeRunsForPull(this.db, workspaceId, prId);
  }

  /** All runs for a PR (any status), newest first — the PR run history. */
  listRunsForPull(workspaceId: string, prId: string): Promise<RunSummary[]> {
    return runRepo.listRunsForPull(this.db, workspaceId, prId);
  }

  /** Delete one agent run (+ its trace via FK cascade). Workspace-scoped. */
  deleteAgentRun(workspaceId: string, runId: string): Promise<boolean> {
    return runRepo.deleteAgentRun(this.db, workspaceId, runId);
  }

  /** Mark a still-running run as cancelled (no-op if it already finished). */
  cancelRunIfRunning(runId: string): Promise<boolean> {
    return runRepo.cancelRunIfRunning(this.db, runId);
  }

  /** On boot: any run still 'running' is orphaned (its process died / restarted),
   *  so mark it failed. Prevents permanently stuck "running" runs in the UI. */
  reapStaleRunningRuns(): Promise<number> {
    return runRepo.reapStaleRunningRuns(this.db);
  }

  /** Delete a whole review (one agent's run) + its findings (cascade), scoped
   *  to the workspace. Returns false if not found in the workspace. */
  deleteReview(workspaceId: string, reviewId: string): Promise<boolean> {
    return reviewRepo.deleteReview(this.db, workspaceId, reviewId);
  }

  // ---- finding actions ----------------------------------------------------

  getFinding(findingId: string): Promise<FindingRow | undefined> {
    return reviewRepo.getFinding(this.db, findingId);
  }

  /** Resolve workspace_id + pr_id for a finding (via review → pr). */
  findingContext(
    findingId: string,
  ): Promise<{ finding: FindingRow; review: ReviewRow; pull: PullRow } | undefined> {
    return reviewRepo.findingContext(this.db, findingId);
  }

  setFindingAccepted(findingId: string, at: Date | null): Promise<FindingRow | undefined> {
    return reviewRepo.setFindingAccepted(this.db, findingId, at);
  }

  setFindingDismissed(findingId: string, at: Date | null): Promise<FindingRow | undefined> {
    return reviewRepo.setFindingDismissed(this.db, findingId, at);
  }

  // ---- observability: agent_runs + run_traces ----------------------------

  /** Create an agent_runs row in `running` state; returns its id (= the runId). */
  createAgentRun(values: {
    workspaceId: string;
    agentId: string | null;
    prId: string;
    provider: string | null;
    model: string | null;
    /** Links the run to a multi-agent run; omit for a single run. */
    multiAgentRunId?: string | null;
  }): Promise<string> {
    return runRepo.createAgentRun(this.db, values);
  }

  /** Finalise a run. Resolves false (writes nothing) when it was no longer `running`, e.g. cancelled. */
  completeAgentRun(
    runId: string,
    values: {
      status: 'done' | 'failed' | 'cancelled';
      durationMs: number;
      tokensIn: number;
      tokensOut: number;
      /** Run cost in USD; null when the model is unpriced or the run failed. */
      costUsd: number | null;
      findingsCount: number;
      grounding: string;
      /** Review score (0-100); null on failed/cancelled runs. */
      score?: number | null;
      /** Findings that tripped the agent's gate; 0 on failed/cancelled runs. */
      blockers?: number | null;
      /** Failure reason (status='failed') / cancellation note. Null clears it. */
      error?: string | null;
      /** Ordered ids of the skills the prompt included. Omit on failed/cancelled runs (stays NULL). */
      skillsUsed?: string[];
    },
  ): Promise<boolean> {
    return runRepo.completeAgentRun(this.db, runId, values);
  }

  /** Record the head SHA a review ran against (PR-list freshness derivation). */
  markReviewed(prId: string, sha: string): Promise<void> {
    return pullRepo.markReviewed(this.db, prId, sha);
  }

  /** Persist a refreshed `head_sha` from `GET /pulls/:id` (AC7/S11). */
  updateHeadSha(prId: string, sha: string): Promise<void> {
    return pullRepo.updateHeadSha(this.db, prId, sha);
  }

  /** Persist the WHOLE run log as ONE document. PK = runId → agent_runs. */
  saveRunTrace(runId: string, trace: RunTrace): Promise<void> {
    return runRepo.saveRunTrace(this.db, runId, trace);
  }

  getRunTrace(runId: string): Promise<RunTrace | undefined> {
    return runRepo.getRunTrace(this.db, runId);
  }

  // ---- multi-agent runs ----------------------------------------------------

  /** One transaction: the multi-run (with the PR head SHA) plus one linked `running` run per agent. */
  createMultiRunWithRuns(values: {
    workspaceId: string;
    prId: string;
    headSha: string | null;
    runs: { agentId: string; provider: string | null; model: string | null }[];
  }): Promise<{ multiRunId: string; runs: { runId: string; agentId: string }[] }> {
    return multiRunRepo.createMultiRunWithRuns(this.db, values);
  }

  getMultiRun(workspaceId: string, multiRunId: string) {
    return multiRunRepo.getMultiRun(this.db, workspaceId, multiRunId);
  }

  /** Every run of a multi-run (newest first) with its agent name. */
  runsForMultiRun(workspaceId: string, multiRunId: string): Promise<multiRunRepo.MultiRunAgentRun[]> {
    return multiRunRepo.runsForMultiRun(this.db, workspaceId, multiRunId);
  }

  /** Atomic retry guard + insert of a new run for one agent of a multi-run. */
  createRetryRun(v: Parameters<typeof multiRunRepo.createRetryRun>[1]): Promise<multiRunRepo.RetryRunResult> {
    return multiRunRepo.createRetryRun(this.db, v);
  }

  /** Reviews + findings for the given run ids (workspace-scoped through `reviews`). */
  reviewsWithFindingsForRuns(workspaceId: string, runIds: string[]) {
    return multiRunRepo.reviewsWithFindingsForRuns(this.db, workspaceId, runIds);
  }

  /** Last 10 `done` runs per agent in the workspace, for run estimates. */
  estimateRunRows(workspaceId: string) {
    return multiRunRepo.estimateRunRows(this.db, workspaceId);
  }

  /** True when the repo exists and belongs to the workspace. */
  repoInWorkspace(workspaceId: string, repoId: string): Promise<boolean> {
    return pullRepo.repoInWorkspace(this.db, workspaceId, repoId);
  }

  /** Newest `limit` multi-runs of a repo (or one PR) with their agent runs, for the run list. */
  listMultiRunSummaryRows(workspaceId: string, repoId: string, prId: string | undefined, limit: number) {
    return multiRunRepo.listMultiRunSummaryRows(this.db, workspaceId, repoId, prId, limit);
  }

  // ---- Learn (memory) -----------------------------------------------------

  /** Which of `findingIds` already have a Learn memory row. */
  findLearnings(workspaceId: string, findingIds: string[]): Promise<Set<string>> {
    return memoryRepo.findLearnings(this.db, workspaceId, findingIds);
  }

  insertLearning(values: memoryRepo.NewLearning): Promise<MemoryRow> {
    return memoryRepo.insertLearning(this.db, values);
  }

  /** Check-then-insert the finding's `learning` row in one transaction. */
  learnOnce(values: memoryRepo.NewLearning): Promise<{ row: MemoryRow; created: boolean }> {
    return memoryRepo.learnOnce(this.db, values);
  }
}
