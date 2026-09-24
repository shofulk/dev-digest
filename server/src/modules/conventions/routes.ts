import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ConventionCandidate,
  ConventionSkillDraft,
  ConventionStatus,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { runEventStream } from '../_shared/sse-stream.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ConventionsService } from './service.js';

/**
 * Conventions Extractor — scan a repo for its house rules, triage them, turn
 * the accepted ones into a skill.
 *
 *   GET    /repos/:id/conventions         → this repo's candidates
 *   POST   /repos/:id/conventions/scan    → 202 {scan_id}; the scan runs detached
 *   GET    /conventions/scans/:id/events  → SSE progress for that scan
 *   POST   /repos/:id/conventions/skill   → skill DRAFT from accepted (no write)
 *   PATCH  /conventions/:id               → accept / reject / edit the rule
 *   DELETE /conventions/:id               → drop a candidate
 *
 * The scan is a POST because it costs a model call, and it answers 202 rather
 * than the result because sampling + one structured call over a whole repo
 * outlives a comfortable request timeout; everything else is ordinary CRUD over
 * the candidates the scan produced.
 */

const UpdateConventionBody = z.object({
  rule: z.string().min(1).optional(),
  rationale: z.string().nullable().optional(),
  status: ConventionStatus.optional(),
});

/** Optional explicit selection; omitted means "every accepted candidate". */
const SkillDraftBody = z
  .object({ convention_ids: z.array(z.string().uuid()).optional() })
  .default({});

const ScanAccepted = z.object({ scan_id: z.string() });
const OkResponse = z.object({ ok: z.boolean() });

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ConventionsService(container);

  // ---- Static paths first, so `/conventions/scans/:id/events` is not
  // swallowed by `/conventions/:id`. ---------------------------------------

  // No rate limit: SSE is one long-lived connection, not burst traffic.
  app.get(
    '/conventions/scans/:id/events',
    { schema: { params: IdParams }, config: { rateLimit: false } },
    async (req, reply) => {
      await getContext(container, req);
      reply.sse(runEventStream(container.runBus, req.params.id));
    },
  );

  app.get(
    '/repos/:id/conventions',
    { schema: { params: IdParams, response: { 200: z.array(ConventionCandidate) } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.list(workspaceId, req.params.id);
    },
  );

  // Tight per-route limit: each call is a model call over a whole repository.
  app.post(
    '/repos/:id/conventions/scan',
    {
      schema: { params: IdParams, response: { 202: ScanAccepted } },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const started = service.startScan(workspaceId, req.params.id, req.log);
      return reply.code(202).send(started);
    },
  );

  app.post(
    '/repos/:id/conventions/skill',
    {
      schema: { params: IdParams, body: SkillDraftBody, response: { 200: ConventionSkillDraft } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.skillDraft(workspaceId, req.params.id, req.body.convention_ids);
    },
  );

  app.patch(
    '/conventions/:id',
    {
      schema: { params: IdParams, body: UpdateConventionBody, response: { 200: ConventionCandidate } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const updated = await service.update(workspaceId, req.params.id, req.body);
      if (!updated) throw new NotFoundError('Convention not found');
      return updated;
    },
  );

  app.delete(
    '/conventions/:id',
    { schema: { params: IdParams, response: { 200: OkResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const ok = await service.delete(workspaceId, req.params.id);
      if (!ok) throw new NotFoundError('Convention not found');
      return { ok: true };
    },
  );
}
