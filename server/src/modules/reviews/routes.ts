import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  LearnFindingResult,
  MultiAgentCancelResult,
  MultiAgentRetryResult,
  MultiAgentRun,
  MultiAgentRunRequest,
  MultiAgentRunStarted,
  MultiAgentRunSummary,
  RunEstimate,
  RunRequest,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { mergedRunEventStream, runEventStream } from '../_shared/sse-stream.js';
import { IdParams } from '../_shared/schemas.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { ReviewService } from './service.js';
import { MultiRunService } from './multi-run-service.js';
import { learnFromFinding } from './learn.js';

/**
 * reviews module.
 *   POST   /pulls/:id/review  {agentId} | {all:true}  → run review(s); returns runs
 *   GET    /runs/:id/events                            → SSE stream of RunEvent (replay-first)
 *   GET    /runs/:id/trace                             → the single-document RunTrace
 *   GET    /pulls/:id/reviews                          → persisted reviews + findings for a PR
 *   POST   /findings/:id/(accept|dismiss)              → finding actions
 *   POST   /pulls/:id/multi-agent-run  {agent_ids}     → start one multi-run (rate-limited); answers before agents finish
 *   GET    /multi-agent-runs/:id                       → columns, totals, disagreement groups, stale flag
 *   POST   /multi-agent-runs/:id/cancel                → cancel every running agent run of the multi-run
 *   POST   /multi-agent-runs/:id/agents/:agentId/retry → re-run one agent in the same multi-run (rate-limited)
 *   GET    /multi-agent-runs/:id/events?run_ids=     → one SSE stream for several runs of a multi-run
 *   GET    /repos/:id/multi-agent-runs?pr_id=          → newest 20 multi-runs of a repo (or of one PR), with status and totals
 *   GET    /run-estimates                              → per-agent median time/cost estimates
 *   POST   /findings/:id/learn                         → store a `learning` memory row for a finding
 */
const FINDING_ACTIONS = ['accept', 'dismiss'] as const;
const RetryParams = z.object({ id: z.string().uuid(), agentId: z.string().uuid() });
/** Query of GET /multi-agent-runs/:id/events: comma-separated run ids (1..20). */
const MultiRunEventsQuery = z.object({
  run_ids: z
    .string()
    .transform((s) => s.split(','))
    .pipe(z.array(z.string().uuid()).min(1).max(20)),
});
/** Query of GET /repos/:id/multi-agent-runs: optional PR filter. */
const MultiRunListQuery = z.object({ pr_id: z.string().uuid().optional() });
export default async function reviewsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ReviewService(container);
  const multiRuns = new MultiRunService(container);

  // ---- Run a review (manual trigger) -------------------------------
  // Tight per-route limit: each call can fan out to expensive LLM runs.
  // Body stays a tolerant manual parse (both fields optional; empty body is OK).
  app.post(
    '/pulls/:id/review',
    { schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
    const { workspaceId } = await getContext(container, req);
    const body = RunRequest.parse(req.body ?? {});
    const targets = await service.resolveTargets(workspaceId, {
      ...(body.agentId !== undefined ? { agentId: body.agentId } : {}),
      ...(body.all !== undefined ? { all: body.all } : {}),
    });
    const { runs, reviews } = await service.runReview(
      workspaceId,
      req.params.id,
      targets,
      req.log,
    );
    return { pr_id: req.params.id, runs, reviews };
  });

  // ---- SSE: live run events (replay buffer first, then live; ends on done) -
  // No rate limit: SSE is one long-lived connection, not burst traffic.
  app.get(
    '/runs/:id/events',
    { schema: { params: IdParams }, config: { rateLimit: false } },
    async (req, reply) => {
    await getContext(container, req);
    const runId = req.params.id;

    reply.sse(runEventStream(container.runBus, runId));
  });

  // ---- Active (in-flight) runs for a PR (server source of truth) ----------
  app.get('/pulls/:id/runs/active', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.activeRuns(workspaceId, req.params.id);
  });

  // ---- All runs for a PR (any status; the run history, incl. failures) -----
  app.get('/pulls/:id/runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listRuns(workspaceId, req.params.id);
  });

  // ---- Delete one run from the history (+ its trace) ----------------------
  app.delete('/runs/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteRun(workspaceId, req.params.id);
    return { ok };
  });

  // ---- Cancel an in-flight run --------------------------------------------
  app.post('/runs/:id/cancel', { schema: { params: IdParams } }, async (req) => {
    await getContext(container, req);
    await service.cancelRun(req.params.id);
    return { ok: true };
  });

  // ---- Run trace (single document; A5 enriches with multi-agent/stats) ----
  app.get('/runs/:id/trace', { schema: { params: IdParams } }, async (req) => {
    await getContext(container, req);
    const trace = await service.getRunTrace(req.params.id);
    if (!trace) throw new NotFoundError('Run trace not found');
    return trace;
  });

  // ---- Reads --------------------------------------------------------------
  app.get('/pulls/:id/reviews', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.reviewsForPull(workspaceId, req.params.id);
  });

  // ---- Delete a whole review run (one agent's pass) + its findings --------
  app.delete('/reviews/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteReview(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Review not found');
    return { ok: true };
  });

  // ---- Finding actions (accept / dismiss) ---------------------------------
  for (const action of FINDING_ACTIONS) {
    app.post(`/findings/:id/${action}`, { schema: { params: IdParams } }, async (req) => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.actOnFinding(workspaceId, req.params.id, action);
      return result;
    });
  }

  // ---- Multi-agent run: start ---------------------------------------------
  // The body is parsed here (not `schema.body`) so a bad body answers 400, not 422.
  app.post(
    '/pulls/:id/multi-agent-run',
    {
      schema: { params: IdParams, response: { 200: MultiAgentRunStarted } },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const body = MultiAgentRunRequest.safeParse(req.body ?? {});
      if (!body.success) {
        throw new AppError('invalid_multi_run_request', 'Provide between 1 and 20 agent ids', 400);
      }
      return multiRuns.start(workspaceId, req.params.id, body.data.agent_ids, req.log);
    },
  );

  // ---- Multi-agent run: read ----------------------------------------------
  app.get(
    '/multi-agent-runs/:id',
    { schema: { params: IdParams, response: { 200: MultiAgentRun } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return multiRuns.read(workspaceId, req.params.id);
    },
  );

  // ---- Multi-agent run list: newest 20 of a repo, or of one PR ------------
  app.get(
    '/repos/:id/multi-agent-runs',
    {
      schema: {
        params: IdParams,
        querystring: MultiRunListQuery,
        response: { 200: z.array(MultiAgentRunSummary) },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return multiRuns.list(workspaceId, req.params.id, req.query.pr_id, req.log);
    },
  );

  // ---- Multi-agent run: cancel every running agent run --------------------
  app.post(
    '/multi-agent-runs/:id/cancel',
    { schema: { params: IdParams, response: { 200: MultiAgentCancelResult } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return multiRuns.cancel(workspaceId, req.params.id);
    },
  );

  // ---- Multi-agent run: retry one agent -----------------------------------
  app.post(
    '/multi-agent-runs/:id/agents/:agentId/retry',
    {
      schema: { params: RetryParams, response: { 200: MultiAgentRetryResult } },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return multiRuns.retry(workspaceId, req.params.id, req.params.agentId, req.log);
    },
  );

  // ---- Multi-agent run: one SSE stream for several runs --------------------
  app.get(
    '/multi-agent-runs/:id/events',
    { schema: { params: IdParams, querystring: MultiRunEventsQuery }, config: { rateLimit: false } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      await multiRuns.assertRunsInMultiRun(workspaceId, req.params.id, req.query.run_ids);
      reply.sse(mergedRunEventStream(container.runBus, req.query.run_ids));
    },
  );

  // ---- Run estimates (median time/cost per agent; no model call) ----------
  app.get('/run-estimates', { schema: { response: { 200: z.array(RunEstimate) } } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return multiRuns.estimates(workspaceId);
  });

  // ---- Learn from a finding (201 when created, 200 when it already existed) -
  app.post(
    '/findings/:id/learn',
    { schema: { params: IdParams, response: { 200: LearnFindingResult, 201: LearnFindingResult } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const result = await learnFromFinding(container.reviewRepo, workspaceId, req.params.id);
      return reply.code(result.created ? 201 : 200).send(result);
    },
  );
}
