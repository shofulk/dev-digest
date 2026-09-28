// RING 3 — composition root / edge. HTTP wiring only: parse params, call one
// service method, return a DTO (`onion-architecture`). This is the only blast
// file allowed to import repo-intel's constants — the EDGE exemption keeps
// the cross-slice limit constants at their single source of truth.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { BlastRadiusResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BlastService } from './service.js';
import { BFS_DEPTH, MAX_CALLERS_PER_SYMBOL } from '../repo-intel/constants.js';

/**
 * blast module.
 *   GET /pulls/:id/blast → BlastRadiusResponse; reads only the repo-intel
 *   persistent index (no LLM, no GitHub, no git, no clone-file read).
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new BlastService(container, { maxCallersPerSymbol: MAX_CALLERS_PER_SYMBOL, bfsDepth: BFS_DEPTH });

  app.get(
    '/pulls/:id/blast',
    { schema: { params: IdParams, response: { 200: BlastRadiusResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.forPull(workspaceId, req.params.id, req.log);
    },
  );
}
