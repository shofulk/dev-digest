// RING 3 — composition root / edge. HTTP wiring only: parse params, call one
// service method, return a DTO (`onion-architecture`). This is the only brief
// file allowed to import `../blast/service.js` and `../repo-intel/constants.js`
// (EDGE exemption, `server/.dependency-cruiser.cjs:19`) once a later lane wires
// the real service; the L1 skeleton below does neither yet.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { GenerateBriefAccepted, GenerateBriefBody, GenerateBriefCurrent, PrBriefResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BlastService } from '../blast/service.js';
import { BFS_DEPTH, MAX_CALLERS_PER_SYMBOL } from '../repo-intel/constants.js';
import { buildBriefServiceDeps } from './deps.js';
import { BriefService } from './service.js';
import { briefEventStream } from './stream.js';

const BriefJobEventsParams = z.object({ id: z.string().uuid(), jobId: z.string().uuid() });

/** D12: `readBlast` passes a no-op logger to `BlastService.forPull` so blast
 *  adds no log line of its own for a brief generation. */
const NOOP_BLAST_LOGGER = { info: () => undefined };

/**
 * brief module (D2/D3).
 *   GET  /pulls/:id/brief                      → PrBriefResponse; no model call (AC-26)
 *   POST /pulls/:id/brief/generate              → 202 started or 200 current (AC-30)
 *   GET  /pulls/:id/brief/jobs/:jobId/events     → SSE job progress (AC-33)
 *
 * One `BriefService` per app, built at registration time (EDGE exemption:
 * this is the only brief file allowed to import `../blast/service.js` and
 * `../repo-intel/constants.js`).
 */
export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  const blast = new BlastService(container, { maxCallersPerSymbol: MAX_CALLERS_PER_SYMBOL, bfsDepth: BFS_DEPTH });
  const deps = buildBriefServiceDeps(container, (workspaceId, prId) =>
    blast.forPull(workspaceId, prId, NOOP_BLAST_LOGGER),
  );
  const service = new BriefService(deps);

  app.get(
    '/pulls/:id/brief',
    { schema: { params: IdParams, response: { 200: PrBriefResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.read(workspaceId, req.params.id);
    },
  );

  app.post(
    '/pulls/:id/brief/generate',
    {
      schema: {
        params: IdParams,
        body: GenerateBriefBody,
        response: { 200: GenerateBriefCurrent, 202: GenerateBriefAccepted },
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.generate(workspaceId, req.params.id, req.body, req.log);
      if (result.kind === 'current') {
        return reply.code(200).send({ brief: result.brief });
      }
      return reply.code(202).send({ job_id: result.job_id, reused: result.reused });
    },
  );

  // No rate limit: SSE is one long-lived connection, not burst traffic
  // (precedent: `modules/conventions/routes.ts`).
  app.get(
    '/pulls/:id/brief/jobs/:jobId/events',
    { schema: { params: BriefJobEventsParams }, config: { rateLimit: false } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      await service.assertJob(workspaceId, req.params.id, req.params.jobId);
      reply.sse(briefEventStream(container.runBus, req.params.jobId));
    },
  );
}
