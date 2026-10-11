import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  EvalCaseCreated,
  EvalCaseView,
  EvalCompare,
  EvalCompareQuery,
  EvalDashboardOverview,
  EvalRunAllInput,
  EvalRunAllResult,
  EvalStartRunResponse,
  EvalSuiteRun,
  EvalSuiteRunDetail,
} from '@devdigest/shared';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import {
  EVAL_RUN_ALL_RATE_LIMIT_MAX,
  EVAL_RUN_ALL_RATE_LIMIT_WINDOW,
  EVAL_RUN_RATE_LIMIT_MAX,
  EVAL_RUN_RATE_LIMIT_WINDOW,
} from './constants.js';
import { EvalService } from './service.js';

/**
 * Ring 3 (edge): the only eval file that names the concrete diff parser and
 * hands it to the ring-1 service.
 *
 * eval module — regression cases for reviewer agents, built from triaged findings.
 *   POST   /findings/:id/eval-case     → freeze a triaged finding (201 new, 200 existing)
 *   GET    /agents/:id/eval-cases      → the agent's cases with their latest result
 *   DELETE /eval-cases/:id             → drop a case (its runs go with it)
 *   POST   /agents/:id/eval-runs       → 202; the run executes detached
 *   GET    /agents/:id/eval-runs       → the agent's suite runs, newest first
 *   GET    /eval-runs/compare?a&b      → two runs of one agent side by side
 *   GET    /eval-runs/:runId           → one run with per-case outcomes (detail; clients poll the list route)
 *   GET    /eval/dashboard             → per-agent roll-up + recent runs
 *   POST   /eval/runs/all              → 202; one suite run per agent with cases (refusals are per agent)
 */
const RunParams = z.object({ runId: z.string().uuid() });

export default async function evalRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new EvalService(container, parseUnifiedDiff);

  app.post(
    '/findings/:id/eval-case',
    { schema: { params: IdParams, response: { 200: EvalCaseCreated, 201: EvalCaseCreated } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.createCaseFromFinding(workspaceId, req.params.id);
      reply.code(result.created ? 201 : 200);
      return result;
    },
  );

  app.get(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, response: { 200: z.array(EvalCaseView) } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.listCases(workspaceId, req.params.id);
    },
  );

  app.delete('/eval-cases/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(container, req);
    await service.deleteCase(workspaceId, req.params.id);
    reply.code(204).send();
  });

  // Tight per-route limit: every call fans out to one model call per case.
  app.post(
    '/agents/:id/eval-runs',
    {
      schema: { params: IdParams, response: { 202: EvalStartRunResponse } },
      config: { rateLimit: { max: EVAL_RUN_RATE_LIMIT_MAX, timeWindow: EVAL_RUN_RATE_LIMIT_WINDOW } },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const started = await service.startRun(workspaceId, req.params.id, req.log);
      reply.code(202);
      return started;
    },
  );

  app.get(
    '/agents/:id/eval-runs',
    { schema: { params: IdParams, response: { 200: z.array(EvalSuiteRun) } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.listRuns(workspaceId, req.params.id);
    },
  );

  // Static path before `/eval-runs/:runId`, for readability.
  app.get(
    '/eval-runs/compare',
    { schema: { querystring: EvalCompareQuery, response: { 200: EvalCompare } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.compare(workspaceId, req.query.a, req.query.b);
    },
  );

  app.get(
    '/eval-runs/:runId',
    { schema: { params: RunParams, response: { 200: EvalSuiteRunDetail } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getRun(workspaceId, req.params.runId);
    },
  );

  app.get(
    '/eval/dashboard',
    { schema: { response: { 200: EvalDashboardOverview } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.dashboard(workspaceId);
    },
  );

  app.post(
    '/eval/runs/all',
    {
      schema: { body: EvalRunAllInput, response: { 202: EvalRunAllResult } },
      config: { rateLimit: { max: EVAL_RUN_ALL_RATE_LIMIT_MAX, timeWindow: EVAL_RUN_ALL_RATE_LIMIT_WINDOW } },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.runAll(workspaceId, req.log);
      reply.code(202);
      return result;
    },
  );
}
