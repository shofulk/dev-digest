// RING 1 — application service. Orchestrates the PR Brief generate/read use
// case through `BriefServiceDeps`, resolved ONCE by the caller (`deps.ts`,
// a later lane) — this file keeps no `container` field and imports only
// `@devdigest/shared` types, `platform/errors.ts`, `platform/resilience.ts`,
// `@devdigest/reviewer-core`, `_shared/intent/{prompt,references}.ts`,
// `_shared/project-context/resolve.ts` and `platform/sse.ts` types
// (`onion-architecture`).
import { randomUUID } from 'node:crypto';
import type { BriefPhase, FeatureModelChoice, LLMProvider, PrBrief, PrBriefResponse } from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { TimeoutError, withTimeout } from '../../platform/resilience.js';
import { extractHunkHeaders } from '../_shared/intent/references.js';
import { buildBriefFacts, fitToBudget } from './facts.js';
import { renderBriefMessages, PrBriefDraft } from './prompt.js';
import { buildGroundingIndex, groundDraft, type GroundingFile } from './grounding.js';
import type { BriefLogger, BriefPrFile, BriefPull, BriefServiceDeps } from './types.js';
import {
  BRIEF_ERROR_BRIEF_FAILED,
  BRIEF_ERROR_BRIEF_FAILED_MESSAGE,
  BRIEF_ERROR_MODEL_FAILED,
  BRIEF_ERROR_MODEL_FAILED_MESSAGE,
  BRIEF_ERROR_MODEL_TIMEOUT,
  BRIEF_ERROR_MODEL_TIMEOUT_MESSAGE,
  BRIEF_INPUT_TOKEN_BUDGET,
  BRIEF_MAX_SCHEMA_REPAIRS,
  BRIEF_MODEL_TIMEOUT_MS,
  BRIEF_SCHEMA_NAME,
} from './constants.js';

// Re-exported so every existing consumer (routes.ts, deps.ts, the red
// tests) keeps importing these from `service.ts` — `types.ts` exists only
// to break the `facts.ts`/`prompt.ts`/`grounding.ts` ↔ `service.ts` import
// cycle `pnpm arch`'s `no-circular` rule would otherwise flag.
export type { BriefBus, BriefFinding, BriefLogger, BriefPrFile, BriefPull, BriefReview, BriefServiceDeps } from './types.js';

export type GenerateBriefResult =
  | { kind: 'started'; job_id: string; reused: boolean }
  | { kind: 'current'; brief: PrBrief };

/** In-memory state of one running job (D2). */
interface RunningJob {
  jobId: string;
  phase: BriefPhase;
}

/**
 * PR Brief use case: read the stored brief (no model call, ever — AC-26) and
 * generate one as a detached background job on `deps.bus` (D2). `running`/
 * `jobs` are process-memory only (A-4/EC-14) — a restart loses the running
 * job but the stored brief is untouched.
 */
export class BriefService {
  private deps: BriefServiceDeps;
  /** One job at a time per PR (D2). */
  private running = new Map<string, RunningJob>();
  /** `jobId -> prId`, never pruned during the process so a late subscriber
   *  can always replay; an unknown id is a 404 (`assertJob`). */
  private jobs = new Map<string, string>();

  constructor(deps: BriefServiceDeps) {
    this.deps = deps;
  }

  /** Pure read (AC-26) — never calls the model. 404 when the PR is not in
   *  this workspace. */
  async read(workspaceId: string, prId: string): Promise<PrBriefResponse> {
    const pull = await this.deps.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const brief = await this.deps.getBrief(prId);
    const running = this.running.get(prId);
    return {
      brief,
      current_head_sha: pull.headSha,
      outdated: brief !== null && brief.head_sha !== pull.headSha,
      job: running ? { id: running.jobId, phase: running.phase } : null,
    };
  }

  /** D2's flowchart order: PR → changed files → provider → running job →
   *  current brief → start. */
  async generate(
    workspaceId: string,
    prId: string,
    body: { force?: boolean },
    log: BriefLogger,
  ): Promise<GenerateBriefResult> {
    const pull = await this.deps.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const files = await this.deps.getPrFiles(prId);
    if (files.length === 0) {
      throw new AppError('no_changed_files', 'This pull request has no changed files.', 409);
    }

    const { choice, llm } = await this.deps.resolveLlm(workspaceId);

    // Fetch the current brief up front — even on the force path, where it
    // goes unused below — so every `await` this method still needs is done
    // BEFORE the decision block that follows (F3/D2 fix): two
    // near-simultaneous requests must never both pass the empty-running
    // check and each start their own job, which an `await` sitting between
    // the check and `running.set` used to allow.
    const current = body.force ? null : await this.deps.getBrief(prId);

    // Synchronous from here: no `await` between the running-job check and
    // `running.set` (D2) — two near-simultaneous requests must never start
    // two jobs for the same PR.
    const existing = this.running.get(prId);
    if (existing) return { kind: 'started', job_id: existing.jobId, reused: true };

    if (current && current.head_sha === pull.headSha) return { kind: 'current', brief: current };

    const jobId = randomUUID();
    this.running.set(prId, { jobId, phase: 'assembling' });
    this.jobs.set(jobId, prId);
    this.deps.bus.publish(jobId, 'info', 'assembling', { type: 'phase', phase: 'assembling' });

    void this.runJob(workspaceId, prId, jobId, pull, files, choice, llm, log);

    return { kind: 'started', job_id: jobId, reused: false };
  }

  /** 404 unless `jobId` is a job of THIS pr in THIS workspace. */
  async assertJob(workspaceId: string, prId: string, jobId: string): Promise<void> {
    const pull = await this.deps.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    if (this.jobs.get(jobId) !== prId) throw new NotFoundError('Job not found');
  }

  private publishPhase(prId: string, jobId: string, phase: BriefPhase): void {
    const running = this.running.get(prId);
    if (running) running.phase = phase;
    this.deps.bus.publish(jobId, 'info', phase, { type: 'phase', phase });
  }

  /**
   * The one model call + grounding + save (D2/D3/D8). Any error — model
   * timeout, model failure, or anything else — ends the job `failed` with a
   * fixed code/message (D8); the previously stored brief is never touched
   * (AC-27) because `saveBrief` is only reached after grounding succeeds.
   */
  private async runJob(
    workspaceId: string,
    prId: string,
    jobId: string,
    pull: BriefPull,
    files: BriefPrFile[],
    choice: FeatureModelChoice,
    llm: LLMProvider,
    log: BriefLogger,
  ): Promise<void> {
    const startedAt = Date.now();
    let draft: PrBriefDraft | null = null;
    let groundedRisksCount = 0;
    let groundedFocusCount = 0;
    let tokensIn = 0;
    let tokensOut = 0;
    let costUsd: number | null = null;
    let attempts = 0;
    let missingInputLabels: string[] = [];
    let outcome: 'success' | 'failed' = 'success';
    let failCode = '';
    let modelErr: unknown;

    try {
      const [intent, blast, reviews, agentDocs] = await Promise.all([
        this.deps.readIntent(workspaceId, prId),
        this.deps.readBlast(workspaceId, prId),
        this.deps.listReviews(prId),
        this.deps.listEnabledAgentDocs(workspaceId),
      ]);

      const rawFacts = await buildBriefFacts({
        pull,
        files,
        intent,
        blast,
        reviews,
        agentDocs,
        projectDocs: this.deps.projectDocs,
        docRoots: this.deps.docRoots,
        maxDocBytes: this.deps.maxDocBytes,
        tokenizer: this.deps.tokenizer,
      });
      const facts = fitToBudget(
        rawFacts,
        (text) => this.countTokens(text),
        BRIEF_INPUT_TOKEN_BUDGET,
        renderBriefMessages,
      );
      missingInputLabels = facts.missingInputs.map((m) => `${m.input}:${m.state}`);

      this.publishPhase(prId, jobId, 'calling_model');
      const messages = renderBriefMessages(facts);

      let result;
      try {
        result = await withTimeout(
          llm.completeStructured({
            model: choice.model,
            schema: PrBriefDraft,
            schemaName: BRIEF_SCHEMA_NAME,
            messages,
            maxRetries: BRIEF_MAX_SCHEMA_REPAIRS,
            timeoutMs: BRIEF_MODEL_TIMEOUT_MS,
          }),
          BRIEF_MODEL_TIMEOUT_MS,
        );
      } catch (err) {
        modelErr = err;
        throw err;
      }
      draft = result.data;
      tokensIn = result.tokensIn;
      tokensOut = result.tokensOut;
      costUsd = result.costUsd;
      attempts = result.attempts;

      this.publishPhase(prId, jobId, 'grounding');
      const groundingFiles: GroundingFile[] = files.map((f) => ({
        path: f.path,
        headers: extractHunkHeaders(f.patch),
      }));
      const index = buildGroundingIndex(groundingFiles, blast);
      const grounded = groundDraft(draft, index);
      groundedRisksCount = grounded.risks.length;
      groundedFocusCount = grounded.review_focus.length;

      this.publishPhase(prId, jobId, 'saving');
      const brief: PrBrief = {
        pr_id: prId,
        head_sha: pull.headSha,
        summary: grounded.summary,
        risks: grounded.risks,
        review_focus: grounded.review_focus,
        missing_inputs: facts.missingInputs,
        model: choice.model,
        provider: choice.provider,
        generated_at: (this.deps.now?.() ?? new Date()).toISOString(),
        stats: {
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          cost_usd: costUsd,
          attempts,
          duration_ms: Date.now() - startedAt,
        },
      };
      await this.deps.saveBrief(brief);
      this.deps.bus.publish(jobId, 'result', 'done', { type: 'done', brief });
    } catch (err) {
      outcome = 'failed';
      if (modelErr !== undefined) {
        if (modelErr instanceof TimeoutError) {
          failCode = BRIEF_ERROR_MODEL_TIMEOUT;
          this.deps.bus.publish(jobId, 'error', failCode, {
            type: 'failed',
            code: failCode,
            message: BRIEF_ERROR_MODEL_TIMEOUT_MESSAGE,
          });
        } else {
          failCode = BRIEF_ERROR_MODEL_FAILED;
          this.deps.bus.publish(jobId, 'error', failCode, {
            type: 'failed',
            code: failCode,
            message: BRIEF_ERROR_MODEL_FAILED_MESSAGE,
          });
        }
      } else {
        failCode = BRIEF_ERROR_BRIEF_FAILED;
        this.deps.bus.publish(jobId, 'error', failCode, {
          type: 'failed',
          code: failCode,
          message: BRIEF_ERROR_BRIEF_FAILED_MESSAGE,
        });
      }
      void err; // the raw error text is never sent or logged (D8).
    } finally {
      const fields: Record<string, unknown> = {
        prId,
        jobId,
        outcome,
        provider: choice.provider,
        model: choice.model,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        cost_usd: costUsd,
        attempts,
        duration_ms: Date.now() - startedAt,
        risks_kept: groundedRisksCount,
        risks_dropped: draft ? draft.risks.length - groundedRisksCount : 0,
        focus_kept: groundedFocusCount,
        focus_dropped: draft ? draft.review_focus.length - groundedFocusCount : 0,
        missing_inputs: missingInputLabels,
      };
      if (outcome === 'failed') {
        fields.code = failCode;
        log.warn(fields, 'brief: job failed');
      } else {
        log.info(fields, 'brief: job finished');
      }
      this.running.delete(prId);
      this.deps.bus.complete(jobId);
    }
  }

  private countTokens(text: string): number {
    try {
      return this.deps.tokenizer.count(text);
    } catch {
      return Math.ceil(text.length / 4);
    }
  }
}
