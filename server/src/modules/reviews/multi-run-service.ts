import { z } from 'zod';
import type {
  AgentColumn,
  AgentColumnFinding,
  MultiAgentCancelResult,
  MultiAgentRetryResult,
  MultiAgentRun,
  MultiAgentRunStarted,
  MultiAgentRunSummary,
  RunEstimate,
  Severity,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { AgentRow } from '../../db/rows.js';
import { findingRowToDto } from './helpers.js';
import { intentDeriverFor } from '../_shared/intent/deps.js';
import { ReviewRunExecutor, type Logger } from './run-executor.js';
import {
  buildEstimates,
  columnStatus,
  computeTotals,
  groupFindings,
  newestPerAgent,
  summaryStatus,
  type GroupInputColumn,
} from './multi-run-helpers.js';
import { MULTI_RUN_LIST_LIMIT } from './constants.js';

/**
 * Ring 1 (application). Multi-agent run use cases: start, read, cancel, retry
 * and run estimates. Everything is resolved in the constructor.
 *
 * Logging (NFR-6): only ids, counts, statuses and durations — never agent
 * names, error text, titles, rationale, prompts or diff.
 */

const isUuid = (v: string): boolean => z.string().uuid().safeParse(v).success;

type ColumnWithGroupInput = { column: AgentColumn; group: GroupInputColumn };

export class MultiRunService {
  private readonly repo: Container['reviewRepo'];
  private readonly agents: Container['agentsRepo'];
  private readonly bus: Container['runBus'];
  private readonly executor: ReviewRunExecutor;

  constructor(container: Container) {
    this.repo = container.reviewRepo;
    this.agents = container.agentsRepo;
    this.bus = container.runBus;
    this.executor = new ReviewRunExecutor(container, this.repo, this.agents, intentDeriverFor(container));
  }

  /** Create the multi-run + one linked run per agent, answer, then run them in the background. */
  async start(
    workspaceId: string,
    prId: string,
    agentIds: string[],
    logger?: Logger,
  ): Promise<MultiAgentRunStarted> {
    const pull = isUuid(prId) ? await this.repo.getPull(workspaceId, prId) : undefined;
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    // Dedupe (first seen wins); every id must be an agent of this workspace, enabled or not.
    const targets: AgentRow[] = [];
    for (const id of [...new Set(agentIds)]) {
      const agent = isUuid(id) ? await this.agents.getById(workspaceId, id) : undefined;
      if (!agent) throw new NotFoundError('Agent not found');
      targets.push(agent);
    }

    const created = await this.repo.createMultiRunWithRuns({
      workspaceId,
      prId,
      headSha: pull.headSha ?? null,
      runs: targets.map((a) => ({ agentId: a.id, provider: a.provider, model: a.model })),
    });

    const jobs = created.runs.map((r, i) => ({ agent: targets[i]!, runId: r.runId }));
    void this.executor
      .executeRuns(workspaceId, pull, repo, jobs, logger, { multiRunId: created.multiRunId })
      .catch(() => {
        logger?.error({ prId, multiRunId: created.multiRunId }, 'multi-run: background execution crashed');
      });

    return {
      multi_agent_run_id: created.multiRunId,
      pr_id: prId,
      runs: jobs.map(({ agent, runId }) => ({ run_id: runId, agent_id: agent.id, agent_name: agent.name })),
    };
  }

  /** The multi-run read model: columns, totals, groups and the stale flag. */
  async read(workspaceId: string, id: string): Promise<MultiAgentRun> {
    const multi = await this.repo.getMultiRun(workspaceId, id);
    if (!multi) throw new NotFoundError('Multi-agent run not found');
    const [pull, runs] = await Promise.all([
      this.repo.getPull(workspaceId, multi.prId),
      this.repo.runsForMultiRun(workspaceId, id),
    ]);

    // Newest run per agent (runs arrive ran_at desc, id desc).
    const chosen = newestPerAgent(runs, (r) => r.run.agentId);
    const reviews = await this.repo.reviewsWithFindingsForRuns(
      workspaceId,
      chosen.map((r) => r.run.id),
    );
    const reviewByRun = new Map<string, (typeof reviews)[number]>();
    for (const r of reviews) {
      if (r.review.runId && !reviewByRun.has(r.review.runId)) reviewByRun.set(r.review.runId, r);
    }
    const learned = await this.repo.findLearnings(
      workspaceId,
      reviews.flatMap((r) => r.findings.map((f) => f.id)),
    );

    const built: ColumnWithGroupInput[] = chosen.map(({ run, agentName }) => {
      const found = reviewByRun.get(run.id);
      const rows = [...(found?.findings ?? [])].sort(
        (a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || a.startLine - b.startLine || (a.id < b.id ? -1 : 1),
      );
      const status = columnStatus(run.status);
      const findings: AgentColumnFinding[] = rows.map((f) => {
        const dto = findingRowToDto(f, learned.has(f.id));
        return {
          id: dto.id,
          severity: dto.severity,
          category: dto.category,
          title: dto.title,
          file: dto.file,
          start_line: dto.start_line,
          kind: dto.kind ?? null,
          learned: dto.learned,
        };
      });
      const column: AgentColumn = {
        run_id: run.id,
        agent_id: run.agentId!,
        agent_name: agentName ?? '',
        provider: run.provider,
        model: run.model,
        status,
        verdict: found?.review.verdict ?? null,
        score: run.score ?? found?.review.score ?? null,
        summary: found?.review.summary ?? null,
        duration_ms: run.durationMs,
        cost_usd: run.costUsd,
        error: run.error ?? null,
        findings,
      };
      const group: GroupInputColumn = {
        agent_id: column.agent_id,
        agent_name: column.agent_name,
        status,
        findings: rows.map((f) => ({
          id: f.id,
          severity: f.severity as Severity,
          title: f.title,
          file: f.file,
          start_line: f.startLine,
          end_line: f.endLine,
        })),
      };
      return { column, group };
    });

    built.sort(
      (a, b) =>
        a.column.agent_name.toLowerCase().localeCompare(b.column.agent_name.toLowerCase()) ||
        (a.column.agent_id < b.column.agent_id ? -1 : 1),
    );
    const columns = built.map((b) => b.column);
    const totals = computeTotals(columns);

    return {
      id: multi.id,
      pr_id: multi.prId,
      pr_number: pull?.number ?? null,
      ran_at: multi.ranAt.toISOString(),
      agent_count: columns.length,
      total_duration_ms: totals.total_duration_ms,
      total_cost_usd: totals.total_cost_usd,
      columns,
      conflicts: groupFindings(built.map((b) => b.group)),
      head_sha: multi.headSha ?? null,
      stale: multi.headSha !== (pull?.headSha ?? null),
    };
  }

  /** Cancel every `running` run of the multi-run. */
  async cancel(workspaceId: string, id: string): Promise<MultiAgentCancelResult> {
    const multi = await this.repo.getMultiRun(workspaceId, id);
    if (!multi) throw new NotFoundError('Multi-agent run not found');
    const runs = await this.repo.runsForMultiRun(workspaceId, id);
    const cancelled: string[] = [];
    for (const { run } of runs) {
      if (run.status !== 'running') continue;
      this.bus.publish(run.id, 'info', 'Cancellation requested — stopping…');
      this.bus.cancel(run.id);
      if (await this.repo.cancelRunIfRunning(run.id)) cancelled.push(run.id);
      this.bus.complete(run.id);
    }
    return { ok: true, run_ids: cancelled };
  }

  /** Re-run one agent of the multi-run. */
  async retry(
    workspaceId: string,
    id: string,
    agentId: string,
    logger?: Logger,
  ): Promise<MultiAgentRetryResult> {
    const multi = await this.repo.getMultiRun(workspaceId, id);
    if (!multi) throw new NotFoundError('Multi-agent run not found');
    const agent = await this.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    const pull = await this.repo.getPull(workspaceId, multi.prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const result = await this.repo.createRetryRun({
      workspaceId,
      multiRunId: multi.id,
      agentId: agent.id,
      prId: pull.id,
      provider: agent.provider,
      model: agent.model,
    });
    if (result.status === 'no_run') throw new NotFoundError('Agent has no run in this multi-agent run');
    if (result.status === 'running') throw new AppError('agent_running', 'This agent is still running', 409);
    const runId = result.runId;
    void this.executor
      .executeRuns(workspaceId, pull, repo, [{ agent, runId }], logger, { multiRunId: multi.id })
      .catch(() => {
        logger?.error({ runId, agentId, multiRunId: multi.id }, 'multi-run: retry execution crashed');
      });
    return { run_id: runId };
  }

  /** 404 unless the multi-run is in the workspace and every id is one of its runs. */
  async assertRunsInMultiRun(workspaceId: string, id: string, runIds: string[]): Promise<void> {
    const multi = await this.repo.getMultiRun(workspaceId, id);
    if (!multi) throw new NotFoundError('Multi-agent run not found');
    const known = new Set((await this.repo.runsForMultiRun(workspaceId, id)).map((r) => r.run.id));
    if (runIds.some((r) => !known.has(r))) throw new NotFoundError('Run not found');
  }

  /** The newest multi-runs of a repo (or of one PR), with status and totals. */
  async list(
    workspaceId: string,
    repoId: string,
    prId?: string,
    logger?: Logger,
  ): Promise<MultiAgentRunSummary[]> {
    if (!(await this.repo.repoInWorkspace(workspaceId, repoId))) throw new NotFoundError('Repo not found');
    if (prId) {
      const pull = await this.repo.getPull(workspaceId, prId);
      if (!pull || pull.repoId !== repoId) throw new NotFoundError('Pull request not found');
    }
    const { multiRuns, runs } = await this.repo.listMultiRunSummaryRows(
      workspaceId,
      repoId,
      prId,
      MULTI_RUN_LIST_LIMIT,
    );
    const runsByMulti = new Map<string, typeof runs>();
    for (const r of runs) {
      const list = runsByMulti.get(r.multiAgentRunId);
      if (list) list.push(r);
      else runsByMulti.set(r.multiAgentRunId, [r]);
    }
    const items = multiRuns.map((m): MultiAgentRunSummary => {
      const counted = newestPerAgent(runsByMulti.get(m.id) ?? [], (r) => r.agentId);
      const statuses = counted.map((r) => columnStatus(r.status));
      const totals = computeTotals(
        counted.map((r) => ({ status: columnStatus(r.status), duration_ms: r.durationMs, cost_usd: r.costUsd })),
      );
      return {
        id: m.id,
        pr_id: m.prId,
        pr_number: m.prNumber,
        pr_title: m.prTitle,
        ran_at: m.ranAt.toISOString(),
        agent_count: counted.length,
        status: summaryStatus(statuses),
        ...totals,
      };
    });
    logger?.debug({ repoId, prId, count: items.length }, 'multi-run: list');
    return items;
  }

  /** Per-agent run estimates for the workspace. */
  async estimates(workspaceId: string): Promise<RunEstimate[]> {
    const [agents, rows] = await Promise.all([
      this.agents.list(workspaceId),
      this.repo.estimateRunRows(workspaceId),
    ]);
    return buildEstimates(
      agents.map((a) => a.id),
      rows,
    );
  }
}
