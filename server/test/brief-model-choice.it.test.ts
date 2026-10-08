/**
 * AFTER (test-writer, fix list F8) — PR Brief model choice (AC-13), the
 * cheap-fallback branch: with no `feature_models.risk_brief` workspace
 * override and only a cheap-fallback provider configured, the brief uses
 * that provider/model (`resolveUsableFeatureModel`/`CHEAP_CHOICES`,
 * `server/src/modules/brief/deps.ts:59-63`).
 *
 * This is observable only through the container (the override is a
 * settings-table read, `getFeatureModelOverride` —
 * `server/src/modules/_shared/feature-models.ts`), so it runs against a real
 * Postgres (Testcontainers) through `app.inject()`, following
 * `brief.it.test.ts`'s own AC-13 case (workspace-override branch).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as t from '../src/db/schema.js';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import type { GenerateBriefAccepted, PrBriefResponse } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) console.warn('[brief-model-choice] Docker not available — skipping integration tests.');

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DRAFT = {
  summary: 'The brief summary.',
  risks: [{ kind: 'other', title: 'A risk', explanation: 'x', severity: 'low', file_refs: ['src/a.ts'] }],
  review_focus: [{ file: 'src/a.ts', line: null, reason: 'Start here' }],
};

d('PR Brief model choice — cheap fallback, no override (Testcontainers pg)', () => {
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
  async function newPr(ws: string) {
    repoSeq += 1;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name: `brief-mc-${repoSeq}`, fullName: `acme/brief-mc-${repoSeq}`, clonePath: null })
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
        filesCount: 1,
        status: 'open',
      })
      .returning();
    await pg.handle.db
      .insert(t.prFiles)
      .values({ prId: pr!.id, path: 'src/a.ts', additions: 5, deletions: 1, patch: '@@ -1,1 +1,20 @@\n context' });
    return { prId: pr!.id as string };
  }

  function makeApp(overrides: Parameters<typeof buildApp>[0]['overrides'] = {}) {
    return buildApp({ config: config(), db: pg.handle.db, overrides });
  }

  async function waitDone(app: Awaited<ReturnType<typeof makeApp>>, jobId: string) {
    await new Promise<void>((resolve) => app.container.runBus.onDone(jobId, resolve));
  }

  it('AC-13: no `feature_models.risk_brief` override, only `anthropic` configured — the brief is generated with the anthropic cheap-fallback model', async () => {
    const llm = new MockLLMProvider('anthropic', { structured: DRAFT });
    // `openai`/`openrouter` are NOT injected — `canUseLlm` sees only `anthropic`
    // as configured, so `resolveUsableFeatureModel`'s walk over `CHEAP_CHOICES`
    // (openrouter → anthropic → openai) must land on anthropic.
    const app = await makeApp({ llm: { anthropic: llm } });
    const { prId } = await newPr(workspaceId);

    // No PUT /settings call — `feature_models.risk_brief` stays unset.
    const gen = await app.inject({ method: 'POST', url: `/pulls/${prId}/brief/generate`, payload: {} });
    expect(gen.statusCode).toBe(202);
    const { job_id: jobId } = gen.json() as GenerateBriefAccepted;
    await waitDone(app, jobId);

    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);

    const after = (await app.inject({ method: 'GET', url: `/pulls/${prId}/brief` })).json() as PrBriefResponse;
    expect(after.brief).not.toBeNull();
    expect(after.brief!.provider).toBe('anthropic');
    expect(after.brief!.model).toBe('claude-haiku-4-5');

    await app.close();
  });
});
