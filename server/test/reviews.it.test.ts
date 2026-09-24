import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { Review, RunTrace } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * A unified diff touching src/config.ts (line 11 added) so grounding can keep a
 * finding on line 11 and drop one on line 999 / a non-existent file.
 */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** A Review fixture: one valid finding (line 11), one hallucinated (line 999). */
const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded Stripe secret introduced.',
  score: 42,
  findings: [
    {
      id: 'f-valid',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      suggestion: 'Move the key to an environment variable.',
      confidence: 0.95,
      kind: 'finding',
    },
    {
      id: 'f-halluc',
      severity: 'WARNING',
      category: 'bug',
      title: 'Phantom finding on a line not in the diff',
      file: 'src/config.ts',
      start_line: 999,
      end_line: 999,
      rationale: 'This line does not exist in the diff.',
      confidence: 0.5,
      kind: 'finding',
    },
  ],
};

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `payments-api-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 482,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Add rate limiting. Closes #471.',
    })
    .returning();
  // persist the patch so the reviewer can reconstruct a diff (MockGit also returns one)
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

d('A2 reviews + agents (Testcontainers pg)', () => {
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

  function appWith(structured: unknown, provider: 'openai' | 'anthropic' = 'openai') {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: {
          [provider]: new MockLLMProvider(provider, { structured }),
        },
      },
    });
  }

  it('agents CRUD', async () => {
    const app = await appWith(REVIEW_FIXTURE);

    const created = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'Test Reviewer',
        provider: 'openai',
        model: 'gpt-4.1',
        system_prompt: 'You are a reviewer.',
      },
    });
    expect(created.statusCode).toBe(201);
    const agent = created.json();
    expect(agent.version).toBe(1);

    const list = (await app.inject({ method: 'GET', url: '/agents' })).json();
    expect(list.some((a: { id: string }) => a.id === agent.id)).toBe(true);

    // a config change bumps version
    const updated = (
      await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}`,
        payload: { system_prompt: 'Updated prompt.' },
      })
    ).json();
    expect(updated.version).toBe(2);

    await app.close();
  });

  it('runs a review: map-reduce + grounding drops the hallucinated finding, keeps the valid one', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Sec', provider: 'openai', model: 'gpt-4.1', system_prompt: 'sec' },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.runs).toHaveLength(1);

    // runReview is fire-and-forget: wait for the background run, then read the
    // persisted reviews (the POST returns runIds, not the reviews themselves).
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    expect(reviews).toHaveLength(1);

    const review = reviews[0];
    expect(review.verdict).toBe('request_changes');
    // Score is derived from the GROUNDED findings, not the model's self-reported
    // 42: grounding keeps one CRITICAL (line 11) ⇒ 100 − 35 = 65.
    expect(review.score).toBe(65);
    // grounding kept only the valid finding (line 11), dropped the line-999 one
    expect(review.findings).toHaveLength(1);
    expect(review.findings[0].file).toBe('src/config.ts');
    expect(review.findings[0].start_line).toBe(11);

    // a run_traces document was written (single doc)
    const runId = body.runs[0].run_id;
    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.config.model).toBe('gpt-4.1');
    expect(trace.stats.grounding).toBe('1/2 passed');
    expect(trace.log.length).toBeGreaterThan(0);

    // agent_runs row populated for A5 to aggregate
    const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    expect(run!.status).toBe('done');
    expect(run!.findingsCount).toBe(1);
    expect(run!.grounding).toBe('1/2 passed');
    // Cost survives the whole path: adapter → ReviewOutcome → agent_runs → trace.
    expect(run!.costUsd).toBeCloseTo(0.001, 6);
    expect(trace.stats.cost_usd).toBeCloseTo(0.001, 6);

    await app.close();
  });

  describe('skills in the prompt (spec E, criteria 25-30)', () => {
    async function insertSkill(name: string, over: Partial<typeof t.skills.$inferInsert> = {}) {
      const [row] = await pg.handle.db
        .insert(t.skills)
        .values({
          workspaceId,
          name,
          description: `${name} description`,
          type: 'rubric',
          source: 'manual',
          body: `BODY-OF-${name}`,
          ...over,
        })
        .returning();
      return row!;
    }

    /** Run one agent over a fresh PR with a recording LLM; return everything the assertions need. */
    async function runAgent(
      agentName: string,
      links: { skill: { id: string }; enabled?: boolean }[],
      overrides: Partial<Parameters<typeof buildApp>[0]['overrides'] & object> = {},
    ) {
      const llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
      const app = await buildApp({
        config: config(),
        db: pg.handle.db,
        overrides: {
          embedder: new MockEmbedder(),
          git: new MockGitClient({ diff: DIFF }),
          llm: { openai: llm },
          ...overrides,
        },
      });
      const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
      const agent = (
        await app.inject({
          method: 'POST',
          url: '/agents',
          payload: { name: agentName, provider: 'openai', model: 'gpt-4.1', system_prompt: 'sys' },
        })
      ).json();
      if (links.length > 0) {
        const linked = await app.inject({
          method: 'POST',
          url: `/agents/${agent.id}/skills`,
          payload: {
            items: links.map((l) => ({
              skill_id: l.skill.id,
              ...(l.enabled !== undefined ? { enabled: l.enabled } : {}),
            })),
          },
        });
        expect(linked.statusCode).toBe(200);
      }
      const res = await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/review`,
        payload: { agentId: agent.id },
      });
      const runId = res.json().runs[0].run_id as string;
      await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
      const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json() as RunTrace;
      const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
      const call = llm.calls.find((c) => c.method === 'completeStructured');
      const user = (call!.req as { messages: { role: string; content: string }[] }).messages.find(
        (m) => m.role === 'user',
      )!.content;
      await app.close();
      return { trace, run: run!, user };
    }

    it('includes exactly the enabled skills, in link order, and records them', async () => {
      const first = await insertSkill('sk-first', { version: 3 });
      const linkOff = await insertSkill('sk-link-off');
      const second = await insertSkill('sk-second');
      const globalOff = await insertSkill('sk-global-off', { enabled: false });

      // Link order is deliberately not alphabetical: second, first.
      const { trace, run, user } = await runAgent('Skilled', [
        { skill: second },
        { skill: linkOff, enabled: false },
        { skill: first },
        { skill: globalOff },
      ]);

      expect(run.status).toBe('done');
      expect(run.skillsUsed).toEqual([second.id, first.id]);

      const block = '### sk-second\n\nBODY-OF-sk-second\n\n### sk-first\n\nBODY-OF-sk-first';
      expect(trace.prompt_assembly.skills).toBe(block);
      expect(user).toContain(`## Skills / rules\n${block}`);
      for (const off of ['sk-link-off', 'sk-global-off']) {
        expect(trace.prompt_assembly.skills).not.toContain(off);
        expect(user).not.toContain(off);
      }

      const logs = trace.log.map((l) => l.msg);
      expect(logs.filter((m) => m.startsWith('skill: '))).toEqual([
        expect.stringMatching(/^skill: sk-second v1 \(~\d+ tokens\)$/),
        expect.stringMatching(/^skill: sk-first v3 \(~\d+ tokens\)$/),
      ]);
      expect(logs).toContainEqual(expect.stringMatching(/^skills: 2 of 4 linked enabled → ~\d+ tokens$/));
    });

    it('an agent with no skills writes skills_used [] and leaves the prompt untouched', async () => {
      const { trace, run, user } = await runAgent('Unskilled', []);
      expect(run.status).toBe('done');
      expect(run.skillsUsed).toEqual([]);
      expect(trace.prompt_assembly.skills).toBeNull();
      expect(user).not.toContain('## Skills / rules');
      expect(trace.log.some((l) => l.msg.startsWith('skill'))).toBe(false);
    });

    it('linked but all disabled: [] / null, and the summary says 0 of m', async () => {
      const off = await insertSkill('sk-only-off');
      const { trace, run, user } = await runAgent('AllOff', [{ skill: off, enabled: false }]);
      expect(run.skillsUsed).toEqual([]);
      expect(trace.prompt_assembly.skills).toBeNull();
      expect(user).not.toContain('## Skills / rules');
      const logs = trace.log.map((l) => l.msg);
      expect(logs.some((m) => m.startsWith('skill: '))).toBe(false);
      expect(logs).toContain('skills: 0 of 1 linked enabled → ~0 tokens');
    });

    it('a failing tokenizer drops the ~n tokens suffix but never fails the run', async () => {
      const sk = await insertSkill('sk-tokenizer');
      const { trace, run } = await runAgent('NoTokenizer', [{ skill: sk }], {
        tokenizer: {
          count: () => {
            throw new Error('tokenizer down');
          },
        },
      });
      expect(run.status).toBe('done');
      expect(run.skillsUsed).toEqual([sk.id]);
      const logs = trace.log.map((l) => l.msg);
      expect(logs).toContain('skill: sk-tokenizer v1');
      expect(logs).toContain('skills: 1 of 1 linked enabled');
    });
  });

  it('dual-provider structured output: anthropic provider returns the same Review shape', async () => {
    const app = await appWith(REVIEW_FIXTURE, 'anthropic');
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Claude Rev', provider: 'anthropic', model: 'claude-x', system_prompt: 'rev' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    expect(reviews[0].findings).toHaveLength(1);
    expect(reviews[0].model).toBe('claude-x');
    await app.close();
  });

  it('finding actions: accept, dismiss', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'ActAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    const findingId = reviews[0].findings[0].id;

    const accepted = (
      await app.inject({ method: 'POST', url: `/findings/${findingId}/accept` })
    ).json();
    expect(accepted.finding.accepted_at).not.toBeNull();

    const dismissed = (
      await app.inject({ method: 'POST', url: `/findings/${findingId}/dismiss` })
    ).json();
    expect(dismissed.finding.dismissed_at).not.toBeNull();
    expect(dismissed.finding.accepted_at).toBeNull();

    await app.close();
  });

  it('SSE: /runs/:id/events streams events and completes', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'SseAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    // The run is synchronous; events are buffered on the bus. Subscribing after
    // the run still replays the buffer (replay-first semantics), then completes.
    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } })
    ).json();
    const runId = body.runs[0].run_id;

    const sse = await app.inject({ method: 'GET', url: `/runs/${runId}/events` });
    expect(sse.statusCode).toBe(200);
    expect(sse.headers['content-type']).toContain('text/event-stream');
    // The replay buffer should contain our log lines as SSE `data:` frames.
    expect(sse.payload).toContain('Starting review');
    expect(sse.payload).toContain('Citation grounding');
    await app.close();
  });

  it('run all enabled agents reviews with each enabled agent', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { all: true } })
    ).json();
    // seed has 2 enabled agents; we may have created more above in this PR's ws.
    expect(body.runs.length).toBeGreaterThanOrEqual(2);
    await app.close();
  });
});
