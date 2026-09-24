import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Skill, SkillImportPreview, SkillListItem, SkillStats, SkillType, SkillVersionEntry } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { IMPORT_PREVIEW_BODY_LIMIT, SKILL_BODY_BODY_LIMIT } from './constants.js';
import { SkillsService } from './service.js';

/**
 * Skills module (spec: `.spec/skills.spec.md`).
 *   POST   /skills/import/preview   → parse an upload, write nothing
 *   POST   /skills/import           → create from the confirmed preview (disabled)
 *   POST   /skills/extracted        → create from accepted conventions (enabled)
 *   POST   /skills/tokens           → exact token count of an unsaved body
 *   GET    /skills                  → list (workspace-scoped, ?q= ?type=)
 *   POST   /skills                  → create
 *   GET    /skills/:id              → one skill
 *   PUT    /skills/:id              → patch (a body change makes a new version)
 *   DELETE /skills/:id              → delete (versions + agent links cascade)
 *   GET    /skills/:id/versions     → history, newest first, current row synthesised
 *   GET    /skills/:id/versions/:version          → one version with its body
 *   POST   /skills/:id/versions/:version/restore  → restore as a NEW version
 *   GET    /skills/:id/stats        → 30-day usage stats (run-granularity attribution)
 */

const VersionParams = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

const ListQuery = z.object({
  q: z.string().trim().optional(),
  type: SkillType.optional(),
});

const CreateSkillBody = z.object({
  name: z.string().trim().min(1),
  description: z.string(),
  type: SkillType,
  body: z.string().min(1),
  enabled: z.boolean().optional(),
});

const UpdateSkillBody = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  type: SkillType.optional(),
  body: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  note: z.string().optional(),
});

const TokensBody = z.object({ body: z.string() });
const TokensResponse = z.object({ tokens: z.number().int().nullable() });

const ImportPreviewBody = z.object({
  filename: z.string().min(1),
  content_base64: z.string(),
});

const ConfirmImportBody = z.object({
  name: z.string().trim().min(1),
  description: z.string(),
  type: SkillType,
  body: z.string().min(1),
});

const CreateExtractedBody = z.object({
  name: z.string().trim().min(1),
  description: z.string(),
  type: SkillType,
  body: z.string().min(1),
  evidence_files: z.array(z.string()).default([]),
  enabled: z.boolean().optional(),
});

const SkillVersionDetail = SkillVersionEntry.extend({ body: z.string() });

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(app.container);

  // Static paths first: they must never be read as a `/skills/:id`.
  app.post(
    '/skills/import/preview',
    {
      bodyLimit: IMPORT_PREVIEW_BODY_LIMIT,
      schema: { body: ImportPreviewBody, response: { 200: SkillImportPreview } },
    },
    async (req) => {
      await getContext(app.container, req);
      return service.previewImport(req.body.filename, req.body.content_base64);
    },
  );

  app.post(
    '/skills/import',
    { bodyLimit: SKILL_BODY_BODY_LIMIT, schema: { body: ConfirmImportBody, response: { 201: Skill } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.confirmImport(workspaceId, req.body);
      reply.status(201);
      return skill;
    },
  );

  app.post(
    '/skills/extracted',
    { schema: { body: CreateExtractedBody, response: { 201: Skill } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const { evidence_files, ...rest } = req.body;
      const skill = await service.createExtracted(workspaceId, {
        ...rest,
        evidenceFiles: evidence_files,
      });
      reply.status(201);
      return skill;
    },
  );

  app.post(
    '/skills/tokens',
    { schema: { body: TokensBody, response: { 200: TokensResponse } } },
    async (req) => {
      await getContext(app.container, req);
      return { tokens: service.tokens(req.body.body) };
    },
  );

  app.get(
    '/skills',
    { schema: { querystring: ListQuery, response: { 200: z.array(SkillListItem) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.list(workspaceId, {
        ...(req.query.q ? { q: req.query.q } : {}),
        ...(req.query.type ? { type: req.query.type } : {}),
      });
    },
  );

  app.post(
    '/skills',
    { bodyLimit: SKILL_BODY_BODY_LIMIT, schema: { body: CreateSkillBody, response: { 201: Skill } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.create(workspaceId, req.body);
      reply.status(201);
      return skill;
    },
  );

  app.get(
    '/skills/:id',
    { schema: { params: IdParams, response: { 200: Skill } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.get(workspaceId, req.params.id);
      if (!skill) throw new NotFoundError('Skill not found');
      return skill;
    },
  );

  app.put(
    '/skills/:id',
    {
      bodyLimit: SKILL_BODY_BODY_LIMIT,
      schema: { params: IdParams, body: UpdateSkillBody, response: { 200: Skill } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.update(workspaceId, req.params.id, req.body);
      if (!skill) throw new NotFoundError('Skill not found');
      return skill;
    },
  );

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.delete(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Skill not found');
    return { ok: true };
  });

  app.get(
    '/skills/:id/versions',
    { schema: { params: IdParams, response: { 200: z.array(SkillVersionEntry) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const versions = await service.listVersions(workspaceId, req.params.id);
      if (!versions) throw new NotFoundError('Skill not found');
      return versions;
    },
  );

  app.get(
    '/skills/:id/versions/:version',
    { schema: { params: VersionParams, response: { 200: SkillVersionDetail } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const version = await service.getVersion(workspaceId, req.params.id, req.params.version);
      if (!version) throw new NotFoundError('Skill version not found');
      return version;
    },
  );

  app.post(
    '/skills/:id/versions/:version/restore',
    { schema: { params: VersionParams, response: { 200: Skill } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.restore(workspaceId, req.params.id, req.params.version);
      if (!skill) throw new NotFoundError('Skill version not found');
      return skill;
    },
  );

  app.get(
    '/skills/:id/stats',
    { schema: { params: IdParams, response: { 200: SkillStats } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const stats = await service.stats(workspaceId, req.params.id);
      if (!stats) throw new NotFoundError('Skill not found');
      return stats;
    },
  );
}
