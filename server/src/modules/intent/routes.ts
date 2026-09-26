// RING 3 — composition root / edge. HTTP wiring only: parse params, call one
// service method, return a DTO (`onion-architecture`).
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PrIntentRecord, PrIntentResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { IntentService } from './service.js';

/**
 * intent module (D4).
 *   GET  /pulls/:id/intent         → { intent: PrIntentRecord | null }; no LLM call
 *   POST /pulls/:id/intent/derive  → PrIntentRecord; one classifier call (rate-limited)
 */
export default async function intentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new IntentService(container);

  app.get(
    '/pulls/:id/intent',
    { schema: { params: IdParams, response: { 200: PrIntentResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const intent = await service.getForPr(workspaceId, req.params.id);
      return { intent };
    },
  );

  app.post(
    '/pulls/:id/intent/derive',
    {
      schema: { params: IdParams, response: { 200: PrIntentRecord } },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      // Route handler = parse → one service call → DTO. ALL stats/warning
      // logging lives in `IntentService.derive` (A7); `req.log` is passed in
      // as a plain structured-logger argument, never captured.
      const { record } = await service.derive(workspaceId, req.params.id, req.log);
      return record;
    },
  );
}
