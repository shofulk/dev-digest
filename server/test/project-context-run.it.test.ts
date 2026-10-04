import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockGitClient, MockProjectDocsSource } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Review, RunTrace } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[project-context-run] Docker not available — skipping integration tests.');
}

/**
 * T4 (red, L3) — a full review run with Project Context attached. Covers
 * AC-21, AC-22, AC-24, AC-26, AC-28, AC-29, AC-34, AC-42. The run executor
 * currently hard-codes `specs_read: []` and never reads `agents.context_docs`
 * (`modules/reviews/run-executor.ts`), so every assertion on the trace below
 * is expected to fail until a later lane wires `resolveProjectContext` in.
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

/** PR diff: edits docs/architecture.md (the rule) AND adds api/users.ts importing db/client. */
const DIFF = `diff --git a/docs/architecture.md b/docs/architecture.md
--- a/docs/architecture.md
+++ b/docs/architecture.md
@@ -1,1 +1,2 @@
 # Payments API architecture
+PR EDIT: this line must never reach the model as the injected rule text.
diff --git a/api/users.ts b/api/users.ts
new file mode 100644
--- /dev/null
+++ b/api/users.ts
@@ -0,0 +1,2 @@
+import { db } from '../db/client';
+export function getUser() { return db; }`;

/** The default-branch document text — distinct from the PR's edited version above. */
const ARCHITECTURE_DEFAULT_BRANCH_TEXT =
  '# Payments API architecture\nmodule api/ does not import db/ directly';

const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'api/ imports db/ directly, violating the architecture rule.',
  score: 40,
  findings: [
    {
      id: 'f-violation',
      severity: 'CRITICAL',
      category: 'bug',
      title: 'api/ imports db/ directly',
      file: 'api/users.ts',
      start_line: 1,
      end_line: 1,
      rationale: 'Violates docs/architecture.md: module api/ does not import db/ directly.',
      confidence: 0.95,
      kind: 'finding',
    },
  ],
};

d('project-context in a review run', () => {
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

  function makeApp(openaiLlm: MockLLMProvider) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ diff: DIFF }),
        projectDocs: new MockProjectDocsSource({
          'docs/architecture.md': ARCHITECTURE_DEFAULT_BRANCH_TEXT,
        }),
        llm: {
          openai: openaiLlm,
          // own mock for the pre-work intent classifier (server/INSIGHTS.md, 2026-09-25)
          openrouter: new MockLLMProvider('openrouter', { structured: INTENT_FIXTURE }),
        },
      },
    });
  }

  it('AC-21/AC-22/AC-24/AC-26/AC-28/AC-29/AC-34/AC-42: injects the resolved order from the default-branch checkout, with no extra model call, and traces it', async () => {
    const openaiLlm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const app = await makeApp(openaiLlm);
    const name = `payments-api-${Date.now()}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath: '/mock/checkout' })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 482,
        title: 'Add users endpoint',
        author: 'marisa.koch',
        branch: 'feat/users',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 2,
        deletions: 0,
        filesCount: 2,
        status: 'needs_review',
        body: 'Adds a users endpoint.',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values([
      {
        prId: pr!.id,
        path: 'docs/architecture.md',
        additions: 1,
        deletions: 0,
        patch: '@@ -1,1 +1,2 @@\n # Payments API architecture\n+PR EDIT',
      },
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
      .set({ contextDocs: ['docs/architecture.md', 'docs/missing.md', '../evil.md'] })
      .where(eq(t.agents.id, agent.id));

    const [skill] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId,
        name: 'Arch skill',
        description: 'd',
        type: 'rubric',
        source: 'manual',
        body: 'follow the architecture doc',
        contextDocs: ['docs/architecture.md'], // duplicate of the agent's own path (EC-5/AC-41)
      })
      .returning();
    await app.inject({ method: 'POST', url: `/agents/${agent.id}/skills`, payload: { skill_id: skill!.id } });

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

    // AC-29: specs_read + per-document trace with statuses/origins.
    expect(trace.specs_read).toEqual(['docs/architecture.md']);
    const docs = trace.context_docs ?? [];
    expect(docs.find((doc) => doc.path === 'docs/architecture.md')).toMatchObject({
      origin: 'agent',
      status: 'included',
    });
    expect(docs.find((doc) => doc.path === 'docs/missing.md')?.status).toBe('missing');
    expect(docs.find((doc) => doc.path === '../evil.md')?.status).toBe('invalid_path');

    // AC-22/EC-5/AC-41: the assembled specs block is path-labelled and deduped
    // (docs/architecture.md appears once even though both the agent and the
    // enabled skill attach it).
    expect(trace.prompt_assembly.specs).toContain('docs/architecture.md');
    expect(trace.prompt_assembly.specs?.split('docs/architecture.md')).toHaveLength(2);

    // AC-21/AC-42/EC-9: the DEFAULT-BRANCH text was injected, not the PR edit.
    expect(trace.prompt_assembly.specs).toContain('module api/ does not import db/ directly');
    expect(trace.prompt_assembly.specs).not.toContain('PR EDIT: this line must never reach the model');

    // AC-28/NFR-3: exactly one Review-schema LLM call (filtered — see header comment).
    const reviewCalls = openaiLlm.calls.filter(
      (c) => c.method === 'completeStructured' && (c.req as { schemaName: string }).schemaName === 'Review',
    );
    expect(reviewCalls).toHaveLength(1);

    // AC-34: the mock finding citing docs/architecture.md on the import line survives grounding.
    const reviews = (await app.inject({ method: 'GET', url: `/pulls/${pr!.id}/reviews` })).json();
    const findings = reviews[0]?.findings ?? [];
    expect(
      findings.some(
        (f: { file: string; rationale: string }) =>
          f.file === 'api/users.ts' && f.rationale.includes('docs/architecture.md'),
      ),
    ).toBe(true);

    await app.close();
  });
});
