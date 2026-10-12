import { randomUUID } from 'node:crypto';
import {
  EvalCaseMeta,
  EvalExpectation,
  type EvalCase,
  type EvalCaseCreated,
  type EvalCaseDraftResponse,
  type EvalCaseFields,
  type EvalCaseFromFindingInput,
  type EvalCaseView,
  type EvalCompare,
  type EvalDashboardOverview,
  type EvalDryRunResult,
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
import { EVAL_DRY_RUN_TIMEOUT_MS, EVAL_PENDING_TIMEOUT_MS } from './constants.js';
import { executeCase } from './executor.js';
import {
  expectationTypeOf,
  freezeCase,
  validateCaseFields,
  type CaseFieldFailure,
  type FreezeFailure,
  type FrozenCase,
} from './frozen-input.js';
import {
  caseIsRunning,
  casesOnlyIn,
  diffLines,
  flipRows,
  groupSuites,
  isOneCaseSuite,
  latestCompletedResult,
  parseExpectation,
  runAllRefusal,
  sanitizeErrorReason,
  systemPromptOf,
  toCaseView,
  toDashboard,
  toEvalCaseDto,
  toSuiteDetail,
  type Suite,
} from './helpers.js';
import { caseFlips, matches, metricDeltas, scoreCase } from './scoring.js';
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

const CASE_FIELD_MESSAGES: Record<CaseFieldFailure, string> = {
  invalid_name: 'Give the case a name of 1 to 120 characters.',
  frozen_diff_too_large: 'The diff is too large to store in an eval case (200 KB at most).',
  invalid_diff: 'The diff has no file with a hunk. Paste a unified diff.',
  expectation_not_grounded: 'The expectation does not point at a line of the diff.',
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

  async draftFromFinding(workspaceId: string, findingId: string): Promise<EvalCaseDraftResponse> {
    const resolved = await this.resolveFinding(workspaceId, findingId);
    if (resolved.kind === 'existing') {
      return { agent_id: resolved.agent.id, existing_case: toEvalCaseDto(resolved.row), draft: null };
    }
    const { frozen } = resolved;
    return {
      agent_id: resolved.agent.id,
      existing_case: null,
      draft: {
        name: frozen.name,
        input_diff: frozen.input_diff,
        input_files: frozen.input_files,
        pr_title: frozen.input_meta.pr_title ?? null,
        pr_body: frozen.input_meta.pr_body ?? null,
        expectation: frozen.expected_output,
        notes: frozen.notes,
      },
    };
  }

  async createCase(workspaceId: string, agentId: string, fields: EvalCaseFields): Promise<EvalCase> {
    await this.requireAgent(workspaceId, agentId);
    const checked = validateCaseFields(fields, this.parseDiff, { checkName: true });
    if (!checked.ok) throw unprocessable(checked.code, CASE_FIELD_MESSAGES[checked.code]);

    const row = await this.store.insertCase({
      workspaceId,
      agentId,
      name: checked.value.name,
      inputDiff: fields.input_diff,
      inputFiles: checked.value.input_files,
      inputMeta: {
        pr_title: fields.pr_title ?? null,
        pr_body: fields.pr_body ?? null,
        created_at: new Date().toISOString(),
      },
      expectedOutput: fields.expectation,
      notes: fields.notes ?? null,
    });
    return toEvalCaseDto(row);
  }

  async updateCase(workspaceId: string, caseId: string, fields: EvalCaseFields): Promise<EvalCase> {
    const row = await this.store.getCase(workspaceId, caseId);
    if (!row || row.ownerKind !== 'agent') throw new NotFoundError('Eval case not found');

    // A case frozen from a finding keeps the diff and the verdict it was frozen with.
    const meta = EvalCaseMeta.safeParse(row.inputMeta);
    const fromFinding = meta.success && typeof meta.data.source_finding_id === 'string';
    if (
      fromFinding &&
      (fields.input_diff !== row.inputDiff ||
        fields.expectation.type !== parseExpectation(row.expectedOutput)?.type)
    ) {
      throw unprocessable(
        'locked_field',
        'The diff and the type of a case frozen from a finding cannot be changed.',
      );
    }

    const checked = validateCaseFields(fields, this.parseDiff, { checkName: true });
    if (!checked.ok) throw unprocessable(checked.code, CASE_FIELD_MESSAGES[checked.code]);

    const previousMeta =
      typeof row.inputMeta === 'object' && row.inputMeta !== null ? (row.inputMeta as Record<string, unknown>) : {};
    const updated = await this.store.updateCase(workspaceId, caseId, {
      name: checked.value.name,
      notes: fields.notes ?? null,
      inputDiff: fields.input_diff,
      inputFiles: checked.value.input_files,
      inputMeta: { ...previousMeta, pr_title: fields.pr_title ?? null, pr_body: fields.pr_body ?? null },
      expectedOutput: fields.expectation,
    });
    if (!updated) throw new NotFoundError('Eval case not found');
    return toEvalCaseDto(updated);
  }

  async startCaseRun(workspaceId: string, caseId: string, logger: Logger): Promise<EvalStartRunResponse> {
    const evalCase = await this.store.getCase(workspaceId, caseId);
    if (!evalCase || evalCase.ownerKind !== 'agent') throw new NotFoundError('Eval case not found');
    const agent = await this.requireAgent(workspaceId, evalCase.ownerId);
    await this.reconcile(workspaceId);
    await this.requireProvider(agent);

    const runId = await this.launch(workspaceId, agent, [evalCase], { oneCase: true }, logger);
    return { run_id: runId, cases_total: 1 };
  }

  /**
   * Runs an unsaved case once and answers with the scored result. Writes nothing:
   * the lock is in memory only, and it is released when the work settles or the
   * deadline passes, whichever comes first.
   */
  async dryRun(
    workspaceId: string,
    agentId: string,
    fields: EvalCaseFields,
    logger: Logger,
  ): Promise<EvalDryRunResult> {
    const agent = await this.requireAgent(workspaceId, agentId);
    const checked = validateCaseFields(fields, this.parseDiff, { checkName: false });
    if (!checked.ok) throw unprocessable(checked.code, CASE_FIELD_MESSAGES[checked.code]);
    await this.requireProvider(agent);

    this.takeLock(agentId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (await this.store.hasPendingForAgent(workspaceId, agentId)) throw this.runInFlight();

      const work = this.scoreDraft(agent, fields);
      // The provider call cannot be cancelled; once the deadline wins, swallow its late outcome.
      work.catch(() => undefined);
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new AppError('dry_run_timeout', 'The dry run took too long and was abandoned.', 504)),
          EVAL_DRY_RUN_TIMEOUT_MS,
        );
      });
      return await Promise.race([work, deadline]);
    } catch (err) {
      if (err instanceof AppError) throw err;
      logger.warn({ err, agentId }, 'eval dry run failed');
      throw new AppError('dry_run_failed', sanitizeErrorReason(err), 502);
    } finally {
      clearTimeout(timer);
      this.inFlight.delete(agentId);
    }
  }

  private async scoreDraft(agent: AgentRow, fields: EvalCaseFields): Promise<EvalDryRunResult> {
    const llm = await this.llms.llm(agent.provider);
    const skills = skillsForPrompt(selectIncludedSkills(await this.store.agentSkillRows(agent.id)));
    const result = await executeCase({
      llm,
      agent: { systemPrompt: agent.systemPrompt, model: agent.model, strategy: agent.strategy },
      skills,
      parseDiff: this.parseDiff,
      evalCase: {
        input_diff: fields.input_diff,
        input_meta: { pr_title: fields.pr_title ?? null, pr_body: fields.pr_body ?? null },
      },
    });
    const score = scoreCase(fields.expectation, result.findings, result.groundingKept, result.groundingDropped);
    return {
      pass: score.pass,
      findings: result.findings.map((f) => ({ ...f, matched: matches(f, fields.expectation) })),
      grounding_kept: result.groundingKept,
      grounding_dropped: result.groundingDropped,
      cost_usd: result.costUsd,
      duration_ms: result.durationMs,
      agent_version: agent.version,
    };
  }

  async createCaseFromFinding(
    workspaceId: string,
    findingId: string,
    body?: EvalCaseFromFindingInput,
  ): Promise<EvalCaseCreated> {
    const resolved = await this.resolveFinding(workspaceId, findingId);
    // Idempotent, and a case is never rewritten once it exists (even if re-triaged).
    if (resolved.kind === 'existing') return { ...toEvalCaseDto(resolved.row), created: false };
    const { agent, frozen } = resolved;

    let { name, input_meta: inputMeta, expected_output: expectation } = frozen;
    let notes: string | null = frozen.notes;
    if (body) {
      // The verdict and the diff stay the frozen ones; the form edits the rest.
      expectation = { ...body.expectation, type: frozen.expected_output.type };
      const checked = validateCaseFields(
        { name: body.name, input_diff: frozen.input_diff, expectation },
        this.parseDiff,
        { checkName: true },
      );
      if (!checked.ok) throw unprocessable(checked.code, CASE_FIELD_MESSAGES[checked.code]);
      name = checked.value.name;
      notes = body.notes ?? null;
      inputMeta = { ...frozen.input_meta, pr_title: body.pr_title ?? null, pr_body: body.pr_body ?? null };
    }

    const row = await this.store.insertCase({
      workspaceId,
      agentId: agent.id,
      name,
      inputDiff: frozen.input_diff,
      inputFiles: frozen.input_files,
      inputMeta,
      expectedOutput: expectation,
      notes,
    });
    return { ...toEvalCaseDto(row), created: true };
  }

  /**
   * Shared by the draft and the save: tenancy (through the review) → agent →
   * existing case → triage → stored patch → freeze.
   */
  private async resolveFinding(
    workspaceId: string,
    findingId: string,
  ): Promise<
    | { kind: 'existing'; agent: AgentRow; row: EvalCaseRow }
    | { kind: 'frozen'; agent: AgentRow; frozen: FrozenCase }
  > {
    const ctx = await this.findings.findingContext(findingId);
    // Findings carry no workspace column; tenancy is the review's.
    if (!ctx || ctx.review.workspaceId !== workspaceId) throw new NotFoundError('Finding not found');
    const { finding, review, pull } = ctx;

    const agent = review.agentId ? await this.agents.getById(workspaceId, review.agentId) : undefined;
    if (!agent) {
      throw unprocessable('finding_has_no_agent', 'This finding was not produced by an agent that still exists.');
    }

    const existing = await this.store.findCaseBySourceFinding(workspaceId, agent.id, finding.id);
    if (existing) return { kind: 'existing', agent, row: existing };

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
    return { kind: 'frozen', agent, frozen: frozen.value };
  }

  async listCases(workspaceId: string, agentId: string): Promise<EvalCaseView[]> {
    await this.requireAgent(workspaceId, agentId);
    await this.reconcile(workspaceId);
    const [cases, runRows] = await Promise.all([
      this.store.listCases(workspaceId, agentId),
      this.store.runRowsForAgent(workspaceId, agentId),
    ]);
    const suites = groupSuites(runRows);
    return cases.map((c) =>
      toCaseView(c, latestCompletedResult(c.id, suites), caseIsRunning(c.id, runRows)),
    );
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
    await this.requireProvider(agent);

    const runId = await this.launch(workspaceId, agent, cases, { oneCase: false }, logger);
    return { run_id: runId, cases_total: cases.length };
  }

  private async requireProvider(agent: AgentRow): Promise<void> {
    if (!(await this.llms.canUseLlm(agent.provider))) {
      throw unprocessable('provider_not_configured', `The ${agent.provider} provider is not configured.`);
    }
  }

  /** Check-and-add with no await in between, so two concurrent starts cannot both pass. */
  private takeLock(agentId: string): void {
    if (this.inFlight.has(agentId)) throw this.runInFlight();
    this.inFlight.add(agentId);
  }

  /**
   * The one lock and insert shared by suite and one-case runs: take the agent's
   * lock, write one pending row per case, then execute detached. Each pending row
   * stores the expectation its case has NOW, so the run is scored against it.
   */
  private async launch(
    workspaceId: string,
    agent: AgentRow,
    cases: EvalCaseRow[],
    opts: { oneCase: boolean },
    logger: Logger,
  ): Promise<string> {
    this.takeLock(agent.id);

    let started: { runId: string; rows: EvalRunRow[] };
    try {
      if (await this.store.hasPendingForAgent(workspaceId, agent.id)) throw this.runInFlight();
      // Seeded agents have no version-1 snapshot; compare needs the prompt each run used.
      await this.agents.ensureVersionSnapshot(agent);
      const runId = randomUUID();
      const rows = await this.store.insertPendingRows(
        cases.map((c) => ({
          caseId: c.id,
          actualOutput: {
            ...this.rowBase(agent, runId, c, opts.oneCase),
            status: 'pending',
          },
        })),
      );
      started = { runId, rows };
    } catch (err) {
      this.inFlight.delete(agent.id);
      throw err;
    }

    void this.executeRun(agent, cases, started.runId, started.rows, opts.oneCase, logger)
      .catch((err: unknown) => logger.error({ err, runId: started.runId }, 'eval run crashed'))
      .finally(() => this.inFlight.delete(agent.id));

    return started.runId;
  }

  /** The fields every state of a row's `actual_output` carries. */
  private rowBase(agent: AgentRow, runId: string, evalCase: EvalCaseRow, oneCase: boolean) {
    return {
      run_id: runId,
      agent_id: agent.id,
      agent_version: agent.version,
      expectation: parseExpectation(evalCase.expectedOutput),
      ...(oneCase ? { one_case: true } : {}),
    };
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
    oneCase: boolean,
    logger: Logger,
  ): Promise<void> {
    const rowByCase = new Map(rows.map((r) => [r.caseId, r]));

    let llm: LLMProvider;
    let skills: string[] | undefined;
    try {
      llm = await this.llms.llm(agent.provider);
      skills = skillsForPrompt(selectIncludedSkills(await this.store.agentSkillRows(agent.id)));
    } catch (err) {
      for (const evalCase of cases) {
        const row = rowByCase.get(evalCase.id);
        if (row) await this.failRow(row.id, this.rowBase(agent, runId, evalCase, oneCase), err, null);
      }
      throw err;
    }

    for (const evalCase of cases) {
      const row = rowByCase.get(evalCase.id);
      if (!row) continue;
      const startedAt = Date.now();
      // The expectation as of the start of the run, stored on the row; never re-read.
      const base = this.rowBase(agent, runId, evalCase, oneCase);
      try {
        const parsed = EvalExpectation.safeParse(base.expectation);
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
    base: object,
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
    return groupSuites(await this.store.runRowsForAgent(workspaceId, agentId))
      .filter((s) => !isOneCaseSuite(s))
      .map((s) => s.summary);
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
      groupSuites(runRows).filter((s) => !isOneCaseSuite(s)),
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
    // A one-case run is not a suite: it has no detail page and cannot be compared.
    if (!suite || isOneCaseSuite(suite)) throw new NotFoundError('Eval run not found');
    return suite;
  }

  /** Rows pending past the timeout become `errored` — their executor died with the process. */
  private async reconcile(workspaceId: string): Promise<void> {
    const now = new Date();
    await this.store.reconcileStalePending(workspaceId, new Date(now.getTime() - EVAL_PENDING_TIMEOUT_MS), now);
  }
}
