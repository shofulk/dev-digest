// RING 3 — composition root / edge. HTTP wiring only: parse params, call one
// service method, return a DTO (`onion-architecture`). HTTP status codes come
// from `AppError`, never decided here.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ContextDocList, ContextDocContent, ContextDocsUpdate, IndexStatus } from '@devdigest/shared';
import { IdParams } from '../_shared/schemas.js';
import { getContext } from '../_shared/context.js';
import { ProjectContextService } from './service.js';

/**
 * project-context module (spec: `specs/project-context.spec.md`).
 *   GET  /repos/:id/context           → ContextDocList
 *   GET  /repos/:id/context/file      → ContextDocContent (?path=)
 *   POST /repos/:id/context/reindex   → IndexStatus
 *   PUT  /agents/:id/context-docs     → ContextDocsUpdate
 *   PUT  /skills/:id/context-docs     → ContextDocsUpdate
 *
 * Parses, calls one `ProjectContextService` method, returns a DTO. HTTP
 * status codes come from `AppError`, decided by the service, never here.
 */
const FileQuery = z.object({ path: z.string().min(1).max(512) });

export default async function projectContextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ProjectContextService(app.container);

  app.get(
    '/repos/:id/context',
    { schema: { params: IdParams, response: { 200: ContextDocList } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getContext(workspaceId, req.params.id);
    },
  );

  app.get(
    '/repos/:id/context/file',
    { schema: { params: IdParams, querystring: FileQuery, response: { 200: ContextDocContent } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getFile(workspaceId, req.params.id, req.query.path);
    },
  );

  app.post(
    '/repos/:id/context/reindex',
    { schema: { params: IdParams, response: { 200: IndexStatus } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.reindex(workspaceId, req.params.id);
    },
  );

  app.put(
    '/agents/:id/context-docs',
    { schema: { params: IdParams, body: ContextDocsUpdate, response: { 200: ContextDocsUpdate } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.setAgentContextDocs(workspaceId, req.params.id, req.body.context_docs);
    },
  );

  app.put(
    '/skills/:id/context-docs',
    { schema: { params: IdParams, body: ContextDocsUpdate, response: { 200: ContextDocsUpdate } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.setSkillContextDocs(workspaceId, req.params.id, req.body.context_docs);
    },
  );
}
