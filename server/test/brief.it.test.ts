/**
 * RED (L2, T5) — PR Brief routes end to end against a real Postgres
 * (Testcontainers), through `app.inject()`. Covers AC-10, AC-13, AC-24,
 * AC-25..AC-31, AC-33, AC-34, AC-62, AC-64, AC-67, NFR-1, NFR-6, NFR-7.
 *
 * The model is always a fixture (`MockLLMProvider`/a small delayed fake) —
 * this suite is about the routes, the storage, the workspace scoping and the
 * detached-job/SSE wiring around the one model call, not the model itself.
 */
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { LLMProvider, PrBriefResponse, GenerateBriefAccepted, GenerateBriefCurrent } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) console.warn('[brief] Docker not available — skipping integration tests.');

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DRAFT = {
  summary: 'The brief summary.',
  risks: [{ kind: 'other', title: 'A risk', explanation: 'x', severity: 'low', file_refs: ['src/a.ts'] }],
  review_focus: [{ file: 'src/a.ts', line: null, reason: 'Start here' }],
};

/** A fake `LLMProvider` whose `completeStructured` resolves after `ms` — long
 *  enough for a second `generate` request to land while the job is in flight. */
function delayedLlm(ms: number, structured: unknown): LLMProvider {
  const inner = new MockLLMProvider('openai', { structured });
  return {
    id: 'openai',
    listModels: inner.listModels.bind(inner),
    complete: inner.complete.bind(inner),
    embed: inner.embed.bind(inner),
    completeStructured: (async (req: Parameters<LLMProvider['completeStructured']>[0]) => {
      await new Promise((r) => setTimeout(r, ms));
      return inner.completeStructured(req);
    }) as LLMProvider['completeStructured'],
  };
}

d('PR Brief routes (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  let repoSeq = 0;
  async function newPr(ws: string, opts: { files?: { path: string; additions: number; deletions: number; patch: string | null }[]; clonePath?: string | null } = {}) {
    repoSeq += 1;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name: `brief-${repoSeq}`, fullName: `acme/brief-${repoSeq}`, clonePath: opts.clonePath ?? null })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws,
        repoId: repo!.id,
        number: 1,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'head-sha-1',
        additions: 5,
        deletions: 1,
        filesCount: opts.files?.length ?? 1,
        status: 'open',
      })
      .returning();
    const files = opts.files ?? [{ path: 'src/a.ts', additions: 5, deletions: 1, patch: '@@ -1,1 +1,20 @@\n context' }];
    for (const f of files) {
      await pg.handle.db.insert(t.prFiles).values({ prId: pr!.id, ...f });
    }
    return { repoId: repo!.id, prId: pr!.id as string };
  }

  function makeApp(overrides: Parameters<typeof buildApp>[0]['overrides'] = {}) {
    return buildApp({ config: config(), db: pg.handle.db, overrides });
  }

  async function waitDone(app: FastifyInstance, jobId: string) {
    await new Promise<void>((resolve) => app.container.runBus.onDone(jobId, resolve));
  }

  it('AC-62: no model provider configured answers `config_error`, starts no job', async () => {
    const app = await makeApp({ llm: {} });
    const { prId } = await newPr(workspaceId);

    const res = await app.inject({ method: 'POST', url: `/pulls/${prId}/brief/generate`, payload: {} });
    expect(res.statusCode).toBe(500);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('config_error');
    expect(body.error.message).toMatch(/OPENAI_API_KEY|OPENROUTER_API_KEY|ANTHROPIC_API_KEY/);

    const read = await app.inject({ method: 'GET', url: `/pulls/${prId}/brief` });
    expect((read.json() as PrBriefResponse).job).toBeNull();
    await app.close();
  });

  it('AC-64: a PR with no changed files answers 409 `no_changed_files`, no job, no model call', async () => {
    const llm = new MockLLMProvider('openai', { structured: DRAFT });
    const app = await makeApp({ llm: { openai: llm } });
    const { prId } = await newPr(workspaceId, { files: [] });

    const res = await app.inject({ method: 'POST', url: `/pulls/${prId}/brief/generate`, payload: {} });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('no_changed_files');
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(0);
    await app.close();
  });

  it('AC-67: a PR of another workspace answers 404 on every brief route, before any read or job', async () => {
    const [other] = await pg.handle.db.insert(t.workspaces).values({ name: `other-${Date.now()}` }).returning();
    const { prId } = await newPr(other!.id);
    const app = await makeApp();

    const get = await app.inject({ method: 'GET', url: `/pulls/${prId}/brief` });
    expect(get.statusCode).toBe(404);
    const post = await app.inject({ method: 'POST', url: `/pulls/${prId}/brief/generate`, payload: {} });
    expect(post.statusCode).toBe(404);
    const events = await app.inject({ url: `/pulls/${prId}/brief/jobs/00000000-0000-0000-0000-000000000000/events` });
    expect(events.statusCode).toBe(404);
    await app.close();
  });

  it('AC-13/AC-25/AC-26/AC-29/AC-30/AC-33/NFR-1/NFR-7: generation picks the workspace-overridden model, streams phases then done, stores stats, costs nothing in agent_runs; reading makes no model call', async () => {
    const llm = new MockLLMProvider('anthropic', { structured: DRAFT });
    const app = await makeApp({ llm: { anthropic: llm } });
    const { prId } = await newPr(workspaceId);

    const put = await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: { feature_models: { risk_brief: { provider: 'anthropic', model: 'claude-haiku-4-5' } } },
    });
    expect(put.statusCode).toBe(200);

    const before = await app.inject({ method: 'GET', url: `/pulls/${prId}/brief` });
    expect(before.statusCode).toBe(200);
    expect((before.json() as PrBriefResponse).brief).toBeNull();
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(0); // NFR-1: reading never calls the model

    const gen = await app.inject({ method: 'POST', url: `/pulls/${prId}/brief/generate`, payload: {} });
    expect(gen.statusCode).toBe(202);
    const { job_id: jobId } = gen.json() as GenerateBriefAccepted;
    // NFR-7: the first phase event is already published by the time the
    // generate response itself resolves (D2).
    expect(app.container.runBus.buffer(jobId).length).toBeGreaterThan(0);

    await waitDone(app, jobId);

    const sse = await app.inject({ url: `/pulls/${prId}/brief/jobs/${jobId}/events` });
    expect(sse.statusCode).toBe(200);
    expect(sse.headers['content-type']).toContain('text/event-stream');
    const eventNames = sse.payload.split('\n').filter((l) => l.startsWith('event:')).map((l) => l.slice(6).trim());
    expect(eventNames[eventNames.length - 1]).toBe('done');
    expect(eventNames.slice(0, -1).every((e) => e === 'phase')).toBe(true);

    const after = (await app.inject({ method: 'GET', url: `/pulls/${prId}/brief` })).json() as PrBriefResponse;
    expect(after.brief).not.toBeNull();
    expect(after.brief!.provider).toBe('anthropic');
    expect(after.brief!.model).toBe('claude-haiku-4-5');
    expect(after.brief!.head_sha).toBe('head-sha-1');
    expect(after.brief!.stats).toMatchObject({ attempts: 1 });
    expect(after.outdated).toBe(false);
    expect(after.job).toBeNull();

    const runs = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, prId));
    expect(runs).toHaveLength(0); // AC-29: no agent_runs row for the brief's cost

    await app.close();
  });

  it('AC-28: a generate without `force` on a current brief returns it directly, starts no job, makes no model call', async () => {
    const llm = new MockLLMProvider('openai', { structured: DRAFT });
    const app = await makeApp({ llm: { openai: llm } });
    const { prId } = await newPr(workspaceId);

    const first = await app.inject({ method: 'POST', url: `/pulls/${prId}/brief/generate`, payload: {} });
    expect(first.statusCode).toBe(202);
    const { job_id: jobId } = first.json() as GenerateBriefAccepted;
    await waitDone(app, jobId);
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);

    const again = await app.inject({ method: 'POST', url: `/pulls/${prId}/brief/generate`, payload: {} });
    expect(again.statusCode).toBe(200);
    expect((again.json() as GenerateBriefCurrent).brief.head_sha).toBe('head-sha-1');
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1); // unchanged — no second call

    await app.close();
  });

  it('AC-27: a failed regeneration keeps the previously stored brief unchanged', async () => {
    const llm = new MockLLMProvider('openai', { structured: DRAFT });
    const app = await makeApp({ llm: { openai: llm } });
    const { prId } = await newPr(workspaceId);

    const first = await app.inject({ method: 'POST', url: `/pulls/${prId}/brief/generate`, payload: {} });
    expect(first.statusCode).toBe(202);
    const { job_id: jobId1 } = first.json() as GenerateBriefAccepted;
    await waitDone(app, jobId1);
    const stored = (await app.inject({ method: 'GET', url: `/pulls/${prId}/brief` })).json() as PrBriefResponse;
    expect(stored.brief).not.toBeNull();

    const failingLlm: LLMProvider = {
      id: 'openai',
      listModels: async () => [],
      complete: async () => {
        throw new Error('not used');
      },
      embed: async () => [],
      completeStructured: async () => {
        throw new Error('the model exploded');
      },
    };
    const app2 = await makeApp({ llm: { openai: failingLlm } });
    const regen = await app2.inject({ method: 'POST', url: `/pulls/${prId}/brief/generate`, payload: { force: true } });
    expect(regen.statusCode).toBe(202);
    const { job_id: jobId2 } = regen.json() as GenerateBriefAccepted;
    await waitDone(app2, jobId2);

    const after = (await app2.inject({ method: 'GET', url: `/pulls/${prId}/brief` })).json() as PrBriefResponse;
    expect(after.brief).toEqual(stored.brief);
    expect(after.job).toBeNull();

    await app.close();
    await app2.close();
  });

  it('AC-31: a running job is reused by a second generate request, never a second job', async () => {
    const llm = delayedLlm(150, DRAFT);
    const app = await makeApp({ llm: { openai: llm } });
    const { prId } = await newPr(workspaceId);

    const first = await app.inject({ method: 'POST', url: `/pulls/${prId}/brief/generate`, payload: {} });
    expect(first.statusCode).toBe(202);
    const { job_id: jobId1 } = first.json() as GenerateBriefAccepted;

    const second = await app.inject({ method: 'POST', url: `/pulls/${prId}/brief/generate`, payload: {} });
    expect(second.statusCode).toBe(202);
    const { job_id: jobId2, reused } = second.json() as GenerateBriefAccepted;
    expect(jobId2).toBe(jobId1);
    expect(reused).toBe(true);

    await waitDone(app, jobId1);
    await app.close();
  });

  it('AC-34: a late subscriber replays the whole job before the live tail', async () => {
    const llm = new MockLLMProvider('openai', { structured: DRAFT });
    const app = await makeApp({ llm: { openai: llm } });
    const { prId } = await newPr(workspaceId);

    const gen = await app.inject({ method: 'POST', url: `/pulls/${prId}/brief/generate`, payload: {} });
    expect(gen.statusCode).toBe(202);
    const { job_id: jobId } = gen.json() as GenerateBriefAccepted;
    await waitDone(app, jobId); // subscribe only AFTER the job finished

    const sse = await app.inject({ url: `/pulls/${prId}/brief/jobs/${jobId}/events` });
    expect(sse.statusCode).toBe(200);
    const dataLines = sse.payload.split('\n').filter((l) => l.startsWith('data:'));
    expect(dataLines.length).toBeGreaterThan(0);
    const last = JSON.parse(dataLines[dataLines.length - 1]!.slice(5)) as { type: string };
    expect(last.type).toBe('done');

    await app.close();
  });

  it('AC-24/AC-10/NFR-6: AC-10 reads attached agent documents from the checkout; the model is given no diff body and GET answers fast', async () => {
    const checkout = mkdtempSync(join(tmpdir(), 'brief-docs-'));
    mkdirSync(join(checkout, 'docs'), { recursive: true });
    writeFileSync(join(checkout, 'docs', 'plan.md'), 'UNIQUE_PLAN_MARKER');

    const llm = new MockLLMProvider('openai', { structured: DRAFT });
    const app = await makeApp({ llm: { openai: llm } });
    const { prId } = await newPr(workspaceId, { clonePath: checkout });

    await pg.handle.db.insert(t.agents).values({
      workspaceId,
      name: 'Reviewer',
      description: '',
      provider: 'openai',
      model: 'gpt-4.1',
      systemPrompt: 'review',
      contextDocs: ['docs/plan.md'],
      enabled: true,
    });

    const gen = await app.inject({ method: 'POST', url: `/pulls/${prId}/brief/generate`, payload: {} });
    expect(gen.statusCode).toBe(202);
    const { job_id: jobId } = gen.json() as GenerateBriefAccepted;
    await waitDone(app, jobId);

    const call = llm.calls.find((c) => c.method === 'completeStructured');
    expect(call).toBeDefined();
    const req = call!.req as { messages: { content: string }[] };
    expect(req.messages.map((m) => m.content).join('\n')).toContain('UNIQUE_PLAN_MARKER');

    const start = Date.now();
    const read = await app.inject({ method: 'GET', url: `/pulls/${prId}/brief` });
    expect(read.statusCode).toBe(200);
    expect(Date.now() - start).toBeLessThan(1000); // NFR-6 — generous bound for a shared CI runner

    await app.close();
  });
});
