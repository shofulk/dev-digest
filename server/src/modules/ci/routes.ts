// RING 3 — composition root / edge. HTTP wiring only: parse with the contract, call one
// service method, return the DTO (`onion-architecture`).
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  CiAgentCi,
  CiExport,
  CiExportInput,
  CiPreview,
  CiPreviewInput,
  CiRefreshResult,
  CiRunsList,
} from '@devdigest/shared';
import { AppError } from '../../platform/errors.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { buildCiServiceDeps } from './deps.js';
import { CiService } from './service.js';

/** D12: the socket address, never `X-Forwarded-For` (Fastify runs without `trustProxy`). */
export function isLoopback(ip: string): boolean {
  return ip === '::1' || /^(::ffff:)?127\.\d+\.\d+\.\d+$/.test(ip);
}

/** D12: DNS-rebinding guard — the `Host` hostname must itself be a loopback name. */
export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const m = /^(\[[^\]]+\]|[^:]+)(?::\d+)?$/.exec(host.trim().toLowerCase());
  return !!m && ['localhost', '127.0.0.1', '[::1]'].includes(m[1]!);
}

const loopbackOnly = async (req: { ip: string; headers: { host?: string } }) => {
  if (!isLoopback(req.ip) || !isLoopbackHost(req.headers.host)) {
    throw new AppError('loopback_only', 'Export to CI is allowed only from this machine (localhost).', 403);
  }
};

/**
 * ci module.
 *   GET  /agents/:id/ci             → installations + recent runs
 *   POST /agents/:id/ci/preview     → the bundle, runner as size only
 *   POST /agents/:id/export-ci      → open the PR or return the files
 *   POST /ci/refresh                → pull finished CI runs back
 *   GET  /ci/runs                   → latest runs of the workspace
 */
export default async function ciRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new CiService(buildCiServiceDeps(container));

  app.get(
    '/agents/:id/ci',
    { schema: { params: IdParams, response: { 200: CiAgentCi } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.agentCi(workspaceId, req.params.id);
    },
  );

  app.post(
    '/agents/:id/ci/preview',
    { onRequest: loopbackOnly, schema: { params: IdParams, body: CiPreviewInput, response: { 200: CiPreview } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.preview(workspaceId, req.params.id, req.body);
    },
  );

  app.post(
    '/agents/:id/export-ci',
    { onRequest: loopbackOnly, schema: { params: IdParams, body: CiExportInput, response: { 200: CiExport } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.exportCi(workspaceId, req.params.id, req.body);
    },
  );

  app.post('/ci/refresh', { schema: { response: { 200: CiRefreshResult } } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.refresh(workspaceId);
  });

  app.get('/ci/runs', { schema: { response: { 200: CiRunsList } } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listRuns(workspaceId);
  });
}
