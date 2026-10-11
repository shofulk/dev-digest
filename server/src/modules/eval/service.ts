import { randomUUID } from 'node:crypto';
import {
  EvalExpectation,
  type EvalCaseCreated,
  type EvalCaseView,
  type EvalCompare,
  type EvalDashboardOverview,
  type EvalRunAllResult,
  type EvalStartRunResponse,
  type EvalSuiteRun,
  type EvalSuiteRunDetail,
  type LLMProvider,
  type UnifiedDiff,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type {
  AgentRow,
  AgentVersionRow,
  EvalCaseRow,
  EvalRunRow,
  FindingRow,
} from '../../db/rows.js';
import { selectIncludedSkills, skillsForPrompt } from '../_shared/agent-skills.js';
import { EVAL_PENDING_TIMEOUT_MS } from './constants.js';
import { executeCase } from './executor.js';
import { expectationTypeOf, freezeCase, type FreezeFailure } from './frozen-input.js';
import {
  casesOnlyIn,
  diffLines,
  flipRows,
  groupSuites,
  latestCompletedResult,
  runAllRefusal,
  sanitizeErrorReason,
  systemPromptOf,
  toCaseView,
  toDashboard,
  toEvalCaseDto,
  toSuiteDetail,
  type Suite,
} from './helpers.js';
import { caseFlips, metricDeltas, scoreCase } from './scoring.js';
import type { EvalRepository } from './repository.js';

/** Structural subset of Fastify's request logger. */
type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
};

// ---- ports: the narrow slices of the shared repositories this use case reads ----

/** ← `container.reviewRepo` */
interface EvalFindingSource {
  findingContext(findingId: string): Promise<
    | {
        finding: FindingRow;
        review: { id: string; workspaceId: string; agentId: string | null };
        pull: { id: string; number: number; title: string; body: string | null };
      }
    | undefined
  >;
  getPrFiles(prId: string): Promise<{ path: string; patch: string | null }[]>;
}

/** ← `container.agentsRepo` */
interface EvalAgentSource {
  getById(workspaceId: string, id: string): Promise<AgentRow | undefined>;
  list(workspaceId: string): Promise<AgentRow[]>;
  getVersion(agentId: string, version: number): Promise<AgentVersionRow | undefined>;
  ensureVersionSnapshot(row: AgentRow): Promise<void>;
}

/** ← `container`, narrowed to the two provider calls. */
type EvalLlmSource = Pick<Container, 'canUseLlm' | 'llm'>;

type EvalStore = EvalRepository;

const FREEZE_MESSAGES: Record<FreezeFailure, string> = {
  no_diff_available: 'The finding’s file has no stored diff to freeze.',
  frozen_diff_too_large: 'The finding’s file diff is too large to freeze into an eval case.',
  expectation_not_grounded: 'The finding does not point at a line of its own diff.',
};

const unprocessable = (code: string, message: string) => new AppError(code, message, 422);

/**
 * Ring 1 (application service): no `adapters/` or ORM imports; the diff parser is
 * injected and the stores arrive as narrow ports resolved from the container in
 * the constructor.
 *
 * Eval pipeline use cases: freeze a triaged finding into a case, run an agent over
 * its cases, score the run with code alone, compare two runs.
 *
 * A run is the set of `eval_runs` rows sharing one `run_id`. It executes detached
 * (the start call answers 202) and sequentially — one model call at a time — and
 * a case that throws is recorded as `errored` without stopping the rest. Nothing
 * here touches the review tables: eval cost and output stay out of PR rollups.
 */
export class EvalService {
  private readonly store: EvalStore;
  private readonly findings: EvalFindingSource;
  private readonly agents: EvalAgentSource;
  private readonly llms: EvalLlmSource;

  /** Agents with a run executing in this process; checked and set synchronously. */
  private readonly inFlight = new Set<string>();

  /** `parseDiff` is the unified-diff parser, supplied by the ring-3 route wiring. */
  constructor(
    container: Container,
    private readonly parseDiff: (text: string) => UnifiedDiff,
  ) {
    this.store = container.evalRepo;
    this.findings = container.reviewRepo;
    this.agents = container.agentsRepo;
    this.llms = container;
  }

  // ------------------------------------------------------------------- cases

  async createCaseFromFinding(workspaceId: string, findingId: string): Promise<EvalCaseCreated> {
    const ctx = await this.findings.findingContext(findingId);
    // Findings carry no workspace column; tenancy is the review's.
    if (!ctx || ctx.review.workspaceId !== workspaceId) throw new NotFoundError('Finding not found');
    const { finding, review, pull } = ctx;

    const agent = review.agentId ? await this.agents.getById(workspaceId, review.agentId) : undefined;
    if (!agent) {
      throw unprocessable('finding_has_no_agent', 'This finding was not produced by an agent that still exists.');
    }

    // Idempotent, and a case is never rewritten once it exists (even if re-triaged).
    const existing = await this.store.findCaseBySourceFinding(workspaceId, agent.id, finding.id);
    if (existing) return { ...toEvalCaseDto(existing), created: false };

    const type = expectationTypeOf({ acceptedAt: finding.acceptedAt, dismissedAt: finding.dismissedAt });
    if (!type) throw unprocessable('finding_not_triaged', 'Accept or dismiss the finding first.');

    const files = await this.findings.getPrFiles(pull.id);
    const patch = files.find((f) => f.path === finding.file)?.patch ?? null;
    const frozen = freezeCase({
      finding,
      type,
      reviewId: review.id,
      pull,
      patch,
      now: new Date(),
      parseDiff: this.parseDiff,
    });
    if (!frozen.ok) throw unprocessable(frozen.code, FREEZE_MESSAGES[frozen.code]);

    const row = await this.store.insertCase({
      workspaceId,
      agentId: agent.id,
      name: frozen.value.name,
      inputDiff: frozen.value.input_diff,
      inputFiles: frozen.value.input_files,
      inputMeta: frozen.value.input_meta,
      expectedOutput: frozen.value.expected_output,
      notes: frozen.value.notes,
    });
    return { ...toEvalCaseDto(row), created: true };
  }

  async listCases(workspaceId: string, agentId: string): Promise<EvalCaseView[]> {
    await this.requireAgent(workspaceId, agentId);
    await this.reconcile(workspaceId);
    const [cases, runRows] = await Promise.all([
      this.store.listCases(workspaceId, agentId),
      this.store.runRowsForAgent(workspaceId, agentId),
    ]);
    const suites = groupSuites(runRows);
    return cases.map((c) => toCaseView(c, latestCompletedResult(c.id, suites)));
  }

  async deleteCase(workspaceId: string, caseId: string): Promise<void> {
    if (!(await this.store.deleteCase(workspaceId, caseId))) throw new NotFoundError('Eval case not found');
  }

  // -------------------------------------------------------------------- runs

  async startRun(workspaceId: string, agentId: string, logger: Logger): Promise<EvalStartRunResponse> {
    const agent = await this.requireAgent(workspaceId, agentId);
    await this.reconcile(workspaceId);

    const cases = await this.store.listCases(workspaceId, agentId);
    if (cases.length === 0) throw unprocessable('no_cases', 'This agent has no eval cases yet.');
    if (!(await this.llms.canUseLlm(agent.provider))) {
      throw unprocessable('provider_not_configured', `The ${agent.provider} provider is not configured.`);
    }

    // Check-and-add with no await in between, so two concurrent starts cannot both pass.
    if (this.inFlight.has(agentId)) throw this.runInFlight();
    this.inFlight.add(agentId);

    let started: { runId: string; rows: EvalRunRow[] };
    try {
      if (await this.store.hasPendingForAgent(workspaceId, agentId)) throw this.runInFlight();
      // Seeded agents have no version-1 snapshot; compare needs the prompt each run used.
      await this.agents.ensureVersionSnapshot(agent);
      const runId = randomUUID();
      const rows = await this.store.insertPendingRows(
        cases.map((c) => ({
          caseId: c.id,
          actualOutput: {
            run_id: runId,
            agent_id: agent.id,
            agent_version: agent.version,
            status: 'pending',
          },
        })),
      );
      started = { runId, rows };
    } catch (err) {
      this.inFlight.delete(agentId);
      throw err;
    }

    void this.executeRun(agent, cases, started.runId, started.rows, logger)
      .catch((err: unknown) => logger.error({ err, runId: started.runId }, 'eval run crashed'))
      .finally(() => this.inFlight.delete(agentId));

    return { run_id: started.runId, cases_total: cases.length };
  }

  /**
   * Starts one suite run per agent with at least one case, refusing agents
   * individually. Runs start sequentially through the same path as the
   * single-agent route, and one agent's failure never stops the rest.
   */
  async runAll(workspaceId: string, logger: Logger): Promise<EvalRunAllResult> {
    const [counts, agents] = await Promise.all([
      this.store.countCasesByAgent(workspaceId),
      this.agents.list(workspaceId),
    ]);
    const eligible = agents
      .filter((a) => (counts.get(a.id) ?? 0) > 0)
      .sort((a, b) => a.name.localeCompare(b.name));

    const started: EvalRunAllResult['started'] = [];
    for (const agent of eligible) {
      try {
        const run = await this.startRun(workspaceId, agent.id, logger);
        started.push({ agent_id: agent.id, agent_name: agent.name, run_id: run.run_id, refused_reason: null });
      } catch (err) {
        if (!(err instanceof AppError)) logger.warn({ err, agentId: agent.id }, 'eval run-all: start failed');
        started.push({
          agent_id: agent.id,
          agent_name: agent.name,
          run_id: null,
          refused_reason: runAllRefusal(err instanceof AppError ? err.code : undefined),
        });
      }
    }
    return { started };
  }

  private runInFlight(): AppError {
    return new AppError('run_in_flight', 'An eval run is already in flight for this agent.', 409);
  }

  /** Runs every case in order; per-case failures are recorded, never thrown. */
  private async executeRun(
    agent: AgentRow,
    cases: EvalCaseRow[],
    runId: string,
    rows: EvalRunRow[],
    logger: Logger,
  ): Promise<void> {
    const base = { run_id: runId, agent_id: agent.id, agent_version: agent.version };
    const rowByCase = new Map(rows.map((r) => [r.caseId, r]));

    let llm: LLMProvider;
    let skills: string[] | undefined;
    try {
      llm = await this.llms.llm(agent.provider);
      skills = skillsForPrompt(selectIncludedSkills(await this.store.agentSkillRows(agent.id)));
    } catch (err) {
      for (const row of rows) await this.failRow(row.id, base, err, null);
      throw err;
    }

    for (const evalCase of cases) {
      const row = rowByCase.get(evalCase.id);
      if (!row) continue;
      const startedAt = Date.now();
      try {
        const parsed = EvalExpectation.safeParse(evalCase.expectedOutput);
        if (!parsed.success) throw new Error('The case has no readable expectation.');

        const result = await executeCase({
          llm,
          agent: { systemPrompt: agent.systemPrompt, model: agent.model, strategy: agent.strategy },
          skills,
          parseDiff: this.parseDiff,
          evalCase: { input_diff: evalCase.inputDiff ?? '', input_meta: evalCase.inputMeta },
        });
        const score = scoreCase(parsed.data, result.findings, result.groundingKept, result.groundingDropped);
        await this.store.completeRow(
          row.id,
          {
            pass: score.pass,
            recall: score.recall,
            precision: score.precision,
            citationAccuracy: score.citation_accuracy,
            durationMs: result.durationMs,
            costUsd: result.costUsd,
          },
          {
            ...base,
            status: 'completed',
            findings: result.findings,
            grounding_kept: result.groundingKept,
            grounding_dropped: result.groundingDropped,
            finished_at: new Date().toISOString(),
          },
        );
      } catch (err) {
        logger.warn({ err, runId, caseId: evalCase.id }, 'eval case errored');
        await this.failRow(row.id, base, err, Date.now() - startedAt);
      }
    }
  }

  private async failRow(
    rowId: string,
    base: { run_id: string; agent_id: string; agent_version: number },
    err: unknown,
    durationMs: number | null,
  ): Promise<void> {
    // The stored reason is shown in the UI: class + redacted, capped message only.
    await this.store.errorRow(
      rowId,
      { ...base, status: 'errored', reason: sanitizeErrorReason(err), finished_at: new Date().toISOString() },
      durationMs,
    );
  }

  async listRuns(workspaceId: string, agentId: string): Promise<EvalSuiteRun[]> {
    await this.requireAgent(workspaceId, agentId);
    await this.reconcile(workspaceId);
    return groupSuites(await this.store.runRowsForAgent(workspaceId, agentId)).map((s) => s.summary);
  }

  async getRun(workspaceId: string, runId: string): Promise<EvalSuiteRunDetail> {
    return toSuiteDetail(await this.requireSuite(workspaceId, runId));
  }

  async compare(workspaceId: string, aId: string, bId: string): Promise<EvalCompare> {
    if (aId === bId) throw unprocessable('invalid_compare', 'Pick two different runs to compare.');
    const [a, b] = [await this.requireSuite(workspaceId, aId), await this.requireSuite(workspaceId, bId)];
    if (a.summary.agent_id !== b.summary.agent_id) {
      throw unprocessable('invalid_compare', 'Only runs of the same agent can be compared.');
    }

    const [versionA, versionB] = await Promise.all([
      this.agents.getVersion(a.summary.agent_id, a.summary.agent_version),
      this.agents.getVersion(b.summary.agent_id, b.summary.agent_version),
    ]);
    const promptA = versionA ? systemPromptOf(versionA.configJson) : null;
    const promptB = versionB ? systemPromptOf(versionB.configJson) : null;
    const available = promptA !== null && promptB !== null;

    return {
      a: a.summary,
      b: b.summary,
      delta: metricDeltas(a.summary, b.summary),
      flips: caseFlips(flipRows(a), flipRows(b)),
      only_in_a: casesOnlyIn(a, b),
      only_in_b: casesOnlyIn(b, a),
      prompt_diff: available ? diffLines(promptA, promptB) : [],
      prompt_available: available,
    };
  }

  async dashboard(workspaceId: string): Promise<EvalDashboardOverview> {
    await this.reconcile(workspaceId);
    const [agents, counts, runRows] = await Promise.all([
      this.agents.list(workspaceId),
      this.store.countCasesByAgent(workspaceId),
      this.store.runRowsForWorkspace(workspaceId),
    ]);
    return toDashboard(
      [...agents].sort((x, y) => x.name.localeCompare(y.name)).map((a) => ({ id: a.id, name: a.name, model: a.model })),
      counts,
      groupSuites(runRows),
    );
  }

  // ----------------------------------------------------------------- helpers

  private async requireAgent(workspaceId: string, agentId: string): Promise<AgentRow> {
    const agent = await this.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    return agent;
  }

  private async requireSuite(workspaceId: string, runId: string): Promise<Suite> {
    await this.reconcile(workspaceId);
    const suite = groupSuites(await this.store.runRowsByRunId(workspaceId, runId))[0];
    if (!suite) throw new NotFoundError('Eval run not found');
    return suite;
  }

  /** Rows pending past the timeout become `errored` — their executor died with the process. */
  private async reconcile(workspaceId: string): Promise<void> {
    const now = new Date();
    await this.store.reconcileStalePending(workspaceId, new Date(now.getTime() - EVAL_PENDING_TIMEOUT_MS), now);
  }
}
