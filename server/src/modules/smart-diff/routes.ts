// RING 3 — composition root / edge. HTTP wiring only: parse params, call one
// service method, return a DTO (`onion-architecture`). No business branching.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { SmartDiffResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { SmartDiffService } from './service.js';

/**
 * smart-diff module.
 *   GET /pulls/:id/smart-diff → SmartDiffResponse; no LLM/GitHub/git call, DB-only.
 */
export default async function smartDiffRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new SmartDiffService(container);

  app.get(
    '/pulls/:id/smart-diff',
    { schema: { params: IdParams, response: { 200: SmartDiffResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.forPull(workspaceId, req.params.id);
    },
  );
}
