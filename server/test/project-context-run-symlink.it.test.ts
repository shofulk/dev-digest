import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Review, RunTrace } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[project-context-run-symlink] Docker not available — skipping integration tests.');
}

/**
 * Fix F6 (plan-verifier T4) — a review run whose agent has a symlink-escape
 * path attached. `project-context-run.it.test.ts` only exercises `../evil.md`
 * (a syntax-level rejection, before any filesystem is touched); this test
 * attaches two IN-CHECKOUT symlinks instead — one pointing outside the
 * checkout root, one pointing into `.git/` — the same class F1 fixed in
 * `adapters/project-docs/index.ts` (`read()`'s realpath re-check, see
 * `project-docs-symlink.test.ts`). No `projectDocs` override here: the real
 * `FsProjectDocsSource` is required for a symlink to actually resolve.
 *
 * S27/server INSIGHTS (2026-09-25): the pre-work intent classifier shares the
 * mock provider unless given its OWN `openrouter` mock — so the review's own
 * `completeStructured({schemaName:'Review'})` call is isolated by filtering
 * `llm.calls` on `req.schemaName === 'Review'`, not by taking `calls[0]`.
 */
const INTENT_FIXTURE = {
  summary: 'Add a users endpoint.',
  in_scope: ['api/users.ts'],
  out_of_scope: [],
  confidence: 'medium' as const,
};

const DIFF = `diff --git a/api/users.ts b/api/users.ts
new file mode 100644
--- /dev/null
+++ b/api/users.ts
@@ -0,0 +1,2 @@
+import { db } from '../db/client';
+export function getUser() { return db; }`;

const REVIEW_FIXTURE: Review = {
  verdict: 'approve',
  summary: 'Looks fine.',
  score: 90,
  findings: [],
};

/** Content planted OUTSIDE the checkout root — must never reach the prompt. */
const OUTSIDE_SECRET = 'OUTSIDE_SECRET_CONTENT_7f3a';
/** Content planted inside `.git/config` — must never reach the prompt. */
const GIT_SECRET = '[remote "origin"]\n\turl = https://x-access-token:SECRET@github.com/acme/payments-api\n';

d('project-context in a review run — symlink escape (F6/T4)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let root: string;
  let outsideDir: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'devdigest-pcrun-symlink-'));
    outsideDir = await mkdtemp(join(tmpdir(), 'devdigest-pcrun-outside-'));
    await mkdir(join(root, 'docs'), { recursive: true });
    await mkdir(join(root, '.git'), { recursive: true });
    await writeFile(join(root, 'docs', 'architecture.md'), '# Payments API architecture\nmodule api/ does not import db/ directly');
    await writeFile(join(outsideDir, 'secret.md'), OUTSIDE_SECRET);
    await writeFile(join(root, '.git', 'config'), GIT_SECRET);
    // In-checkout symlink that escapes the checkout root entirely.
    await symlink(join(outsideDir, 'secret.md'), join(root, 'docs', 'escape.md'));
    // In-checkout symlink straight into .git/.
    await symlink(join(root, '.git', 'config'), join(root, 'docs', 'gitleak.md'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  });

  function makeApp(openaiLlm: MockLLMProvider) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ diff: DIFF }),
        // No `projectDocs` override — the real `FsProjectDocsSource` is
        // required to resolve (and reject) an actual symlink.
        llm: {
          openai: openaiLlm,
          openrouter: new MockLLMProvider('openrouter', { structured: INTENT_FIXTURE }),
        },
      },
    });
  }

  it('AC-26/AC-29: a symlink escaping the checkout, and one into .git/, are both recorded invalid_path, excluded from the prompt, and the run still finishes done', async () => {
    const openaiLlm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const app = await makeApp(openaiLlm);
    const name = `payments-api-${Date.now()}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath: root })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 777,
        title: 'Add users endpoint',
        author: 'marisa.koch',
        branch: 'feat/users',
        base: 'main',
        headSha: 'deadbeef',
        additions: 2,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: 'Adds a users endpoint.',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values([
      {
        prId: pr!.id,
        path: 'api/users.ts',
        additions: 2,
        deletions: 0,
        patch: "@@ -0,0 +1,2 @@\n+import { db } from '../db/client';\n+export function getUser() { return db; }",
      },
    ]);

    const agentRes = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name: 'Architecture Reviewer', provider: 'openai', model: 'gpt-4.1', system_prompt: 'Review for architecture violations.' },
    });
    const agent = agentRes.json() as { id: string };
    await pg.handle.db
      .update(t.agents)
      .set({ contextDocs: ['docs/architecture.md', 'docs/escape.md', 'docs/gitleak.md'] })
      .where(eq(t.agents.id, agent.id));

    const run = await app.inject({
      method: 'POST',
      url: `/pulls/${pr!.id}/review`,
      payload: { agentId: agent.id },
    });
    expect(run.statusCode).toBe(200);
    const runId = run.json().runs[0].run_id as string;

    await waitForPrRuns(pg.handle.db, pr!.id, { expected: 1 });

    const [agentRun] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    expect(agentRun!.status).toBe('done');

    const traceRes = await app.inject({ method: 'GET', url: `/runs/${runId}/trace` });
    const trace = traceRes.json() as RunTrace;

    // The legitimate doc is included; both symlink-escape paths are rejected.
    expect(trace.specs_read).toEqual(['docs/architecture.md']);
    const docs = trace.context_docs ?? [];
    expect(docs.find((doc) => doc.path === 'docs/architecture.md')?.status).toBe('included');
    expect(docs.find((doc) => doc.path === 'docs/escape.md')?.status).toBe('invalid_path');
    expect(docs.find((doc) => doc.path === 'docs/gitleak.md')?.status).toBe('invalid_path');

    // Neither rejected path's content (nor the .git secret / outside secret) reaches the prompt.
    expect(trace.prompt_assembly.specs).toContain('module api/ does not import db/ directly');
    expect(trace.prompt_assembly.specs).not.toContain(OUTSIDE_SECRET);
    expect(trace.prompt_assembly.specs).not.toContain('x-access-token:SECRET');

    // Exactly one Review-schema LLM call (filtered — see header comment).
    const reviewCalls = openaiLlm.calls.filter(
      (c) => c.method === 'completeStructured' && (c.req as { schemaName: string }).schemaName === 'Review',
    );
    expect(reviewCalls).toHaveLength(1);

    await app.close();
  });
});
