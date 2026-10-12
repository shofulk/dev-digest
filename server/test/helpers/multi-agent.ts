import { eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AuthProvider, Review, StructuredRequest, StructuredResult, UnifiedDiff } from '@devdigest/shared';
import * as t from '../../src/db/schema.js';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/platform/config.js';
import { MockEmbedder, MockGitClient, MockLLMProvider } from '../../src/adapters/mocks.js';
import type { PgFixture } from './pg.js';

/**
 * Shared fixtures for the multi-agent review integration suites (SPEC-05).
 *
 * - `ScriptedLLM`: a model whose Review answers, speed and failures the test
 *   controls (the `eval.it.test.ts` gate pattern). Only `schemaName === 'Review'`
 *   calls are counted/gated; the pre-work intent call is answered from a fixture.
 * - `CountingGit`: a MockGitClient that counts `diff()` calls and can throw.
 * - `setupEnv`: builds EVERY app a suite needs up front. `buildApp` reaps every
 *   `running` row on boot (server/src/app.ts), so no app may be built while runs
 *   exist — hence one build phase in `beforeAll`, before any test seeds a run.
 * - seed helpers that write multi-runs / agent runs / reviews / findings directly,
 *   so read-side tests do not depend on the start path.
 */

type Db = PgFixture['handle']['db'];

/** Two context lines around one added line (new-side line 11 is inside the hunk). */
export const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

export const PATCH = '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,';

export const GROUNDED_FINDING = {
  id: 'f-valid',
  severity: 'CRITICAL' as const,
  category: 'security' as const,
  title: 'Hardcoded Stripe secret key',
  file: 'src/config.ts',
  start_line: 11,
  end_line: 11,
  rationale: 'A live Stripe key is committed in source.',
  suggestion: 'Move the key to an environment variable.',
  confidence: 0.95,
  kind: 'finding' as const,
};

export const OFF_DIFF_FINDING = {
  id: 'f-halluc',
  severity: 'WARNING' as const,
  category: 'bug' as const,
  title: 'Phantom finding on a line not in the diff',
  file: 'src/config.ts',
  start_line: 999,
  end_line: 999,
  rationale: 'This line does not exist in the diff.',
  confidence: 0.5,
  kind: 'finding' as const,
};

/** One grounded finding: the model's answer when a test does not care about content. */
export const CLEAN_REVIEW: Review = {
  verdict: 'comment',
  summary: 'Looks mostly fine.',
  score: 80,
  findings: [GROUNDED_FINDING],
};

const INTENT_FIXTURE = {
  summary: 'Add rate limiting to public API endpoints.',
  in_scope: ['Rate limiter middleware'],
  out_of_scope: [],
  confidence: 'medium' as const,
};

export class ScriptedLLM extends MockLLMProvider {
  /** Answer for every Review call without a per-model fixture. */
  fixture: unknown = CLEAN_REVIEW;
  /** Per-agent answers, keyed by the agent's model name. */
  fixtureByModel = new Map<string, unknown>();
  /** model -> thrown message. */
  failModels = new Map<string, string>();
  gate: Promise<void> | undefined;
  /** Models of every Review call, in call order. */
  reviewModels: string[] = [];
  finishedReviewCalls = 0;

  constructor() {
    super('openai', { structuredBySchema: { IntentClassification: INTENT_FIXTURE } });
  }

  get reviewCalls(): number {
    return this.reviewModels.length;
  }

  /** Hold every Review call until the returned function is called. */
  hold(): () => void {
    let open!: () => void;
    this.gate = new Promise<void>((r) => (open = r));
    return () => {
      this.gate = undefined;
      open();
    };
  }

  reset(): void {
    this.fixture = CLEAN_REVIEW;
    this.fixtureByModel.clear();
    this.failModels.clear();
    this.gate = undefined;
    this.reviewModels = [];
    this.finishedReviewCalls = 0;
    this.calls.length = 0;
  }

  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    if (req.schemaName !== 'Review') return super.completeStructured(req);
    this.calls.push({ method: 'completeStructured', req });
    this.reviewModels.push(req.model);
    await this.gate;
    const failure = this.failModels.get(req.model);
    if (failure) throw new Error(failure);
    const fixture = this.fixtureByModel.has(req.model) ? this.fixtureByModel.get(req.model) : this.fixture;
    const result = await new MockLLMProvider('openai', { structured: fixture }).completeStructured(req);
    this.finishedReviewCalls += 1;
    return result;
  }
}

export class CountingGit extends MockGitClient {
  diffCalls = 0;
  failWith: string | undefined;

  override async diff(): Promise<UnifiedDiff> {
    this.diffCalls += 1;
    if (this.failWith) throw new Error(this.failWith);
    return super.diff();
  }

  reset(): void {
    this.diffCalls = 0;
    this.failWith = undefined;
  }
}

export interface Env {
  pg: PgFixture;
  db: Db;
  workspaceA: string;
  workspaceB: string;
  userId: string;
  llm: ScriptedLLM;
  intentLlm: MockLLMProvider;
  git: CountingGit;
  /** Requests run as workspace A (NODE_ENV=test: no rate limit). */
  app: FastifyInstance;
  /** Requests run as workspace B. */
  appB: FastifyInstance;
  /** Requests run as workspace A with NODE_ENV=development (the rate limiter is on). */
  appDev: FastifyInstance;
  close: () => Promise<void>;
}

/** Counts Review/intent calls across both injected providers. */
export function intentCalls(env: Pick<Env, 'llm' | 'intentLlm'>): number {
  const named = (p: MockLLMProvider) =>
    p.calls.filter(
      (c) => c.method === 'completeStructured' && (c.req as { schemaName?: string }).schemaName === 'IntentClassification',
    ).length;
  return named(env.llm) + named(env.intentLlm);
}

export async function setupEnv(pg: PgFixture): Promise<Env> {
  const db = pg.handle.db;
  const [ws] = await db.select().from(t.workspaces).where(eq(t.workspaces.name, 'default'));
  const workspaceA = ws!.id;
  const [other] = await db.insert(t.workspaces).values({ name: `other-${Date.now()}-${Math.random()}` }).returning();
  const workspaceB = other!.id;
  const [user] = await db.select().from(t.users);
  const userId = user!.id;

  const llm = new ScriptedLLM();
  const intentLlm = new MockLLMProvider('openrouter', { structured: INTENT_FIXTURE });
  const git = new CountingGit({ diff: DIFF });

  const make = (workspaceId: string, nodeEnv: 'test' | 'development') => {
    const auth: AuthProvider = {
      currentUser: async () => ({ id: userId, email: 'test@example.com', name: 'Test' }),
      currentWorkspace: async () => ({ id: workspaceId, name: 'test-ws' }),
    };
    return buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: nodeEnv, LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv),
      db,
      overrides: { auth, git, embedder: new MockEmbedder(), llm: { openai: llm, openrouter: intentLlm } },
    });
  };

  const app = await make(workspaceA, 'test');
  const appB = await make(workspaceB, 'test');
  const appDev = await make(workspaceA, 'development');
  return {
    pg,
    db,
    workspaceA,
    workspaceB,
    userId,
    llm,
    intentLlm,
    git,
    app,
    appB,
    appDev,
    close: async () => {
      await Promise.all([app.close(), appB.close(), appDev.close()]);
    },
  };
}

/** Per-test reset: release any held model, clear counters. */
export function resetEnv(env: Env): void {
  env.llm.reset();
  env.git.reset();
  env.intentLlm.calls.length = 0;
}

let seq = 0;
const uniq = () => `${++seq}-${Math.random().toString(36).slice(2, 7)}`;

export async function newRepoPr(
  db: Db,
  workspaceId: string,
  opts: { withPatch?: boolean; headSha?: string; number?: number; title?: string } = {},
) {
  const name = `multi-${uniq()}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: opts.number ?? 482,
      title: opts.title ?? 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: opts.headSha ?? 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Add rate limiting. Closes #471.',
    })
    .returning();
  if (opts.withPatch !== false) {
    await db.insert(t.prFiles).values({ prId: pr!.id, path: 'src/config.ts', additions: 1, deletions: 0, patch: PATCH });
  }
  return { repo: repo!, pr: pr! };
}

export async function newAgent(
  db: Db,
  workspaceId: string,
  opts: { name?: string; enabled?: boolean; model?: string; provider?: 'openai' | 'anthropic' | 'openrouter' } = {},
) {
  const id = uniq();
  const name = opts.name ?? `Agent ${id}`;
  const [agent] = await db
    .insert(t.agents)
    .values({
      workspaceId,
      name,
      provider: opts.provider ?? 'openai',
      model: opts.model ?? `model-${id}`,
      systemPrompt: 'Review the diff carefully.',
      strategy: 'single-pass',
      enabled: opts.enabled ?? true,
      version: 1,
    })
    .returning();
  return agent!;
}

export interface SeedFinding {
  file?: string;
  start: number;
  end?: number;
  severity?: 'CRITICAL' | 'WARNING' | 'SUGGESTION';
  title?: string;
  rationale?: string;
}

export interface SeedRun {
  agentId: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  /** Default: now. Pass explicit dates to control "newest run of an agent". */
  ranAt?: Date;
  durationMs?: number | null;
  costUsd?: number | null;
  score?: number | null;
  error?: string | null;
  verdict?: string;
  summary?: string;
  findings?: SeedFinding[];
  /** Write a review row even without findings. Default: true for done runs. */
  withReview?: boolean;
  /** Link to the multi-run. Default true. */
  linked?: boolean;
}

export interface SeededRun {
  runId: string;
  agentId: string;
  reviewId: string | null;
  findingIds: string[];
}

/** One multi-run with its agent runs, reviews and findings, written straight to the DB. */
export async function seedMultiRun(
  db: Db,
  args: { workspaceId: string; prId: string; headSha?: string | null; runs: SeedRun[] },
): Promise<{ multiRunId: string; runs: SeededRun[] }> {
  const [multi] = await db
    .insert(t.multiAgentRuns)
    .values({ workspaceId: args.workspaceId, prId: args.prId, headSha: args.headSha === undefined ? 'a1b2c3d4' : args.headSha })
    .returning();
  const seeded: SeededRun[] = [];
  let offset = 0;
  for (const r of args.runs) {
    offset += 1;
    const [run] = await db
      .insert(t.agentRuns)
      .values({
        workspaceId: args.workspaceId,
        agentId: r.agentId,
        prId: args.prId,
        ranAt: r.ranAt ?? new Date(Date.now() - 60_000 + offset),
        provider: 'openai',
        model: 'seeded-model',
        durationMs: r.durationMs === undefined ? 1000 : r.durationMs,
        costUsd: r.costUsd === undefined ? 0.01 : r.costUsd,
        status: r.status,
        error: r.error ?? null,
        score: r.score === undefined ? (r.status === 'done' ? 80 : null) : r.score,
        findingsCount: r.findings?.length ?? 0,
        multiAgentRunId: r.linked === false ? null : multi!.id,
      })
      .returning();
    let reviewId: string | null = null;
    const findingIds: string[] = [];
    if (r.withReview ?? (r.status === 'done' || (r.findings?.length ?? 0) > 0)) {
      const [review] = await db
        .insert(t.reviews)
        .values({
          workspaceId: args.workspaceId,
          prId: args.prId,
          agentId: r.agentId,
          runId: run!.id,
          kind: 'review',
          verdict: r.verdict ?? 'comment',
          summary: r.summary ?? 'Seeded review summary',
          score: r.score === undefined ? 80 : r.score,
          model: 'seeded-model',
        })
        .returning();
      reviewId = review!.id;
      if (r.findings?.length) {
        const rows = await db
          .insert(t.findings)
          .values(
            r.findings.map((f, i) => ({
              reviewId: review!.id,
              file: f.file ?? 'src/config.ts',
              startLine: f.start,
              endLine: f.end ?? f.start,
              severity: f.severity ?? 'WARNING',
              category: 'test',
              title: f.title ?? `Finding ${i + 1} at ${f.start}`,
              rationale: f.rationale ?? `Because of line ${f.start}.`,
              confidence: 0.8,
            })),
          )
          .returning();
        findingIds.push(...rows.map((x) => x.id));
      }
    }
    seeded.push({ runId: run!.id, agentId: r.agentId, reviewId, findingIds });
  }
  return { multiRunId: multi!.id, runs: seeded };
}

/** Poll until `runId` left `running` AND its trace row exists (the executor writes status first). */
export async function waitForRun(db: Db, runId: string, timeoutMs = 10_000) {
  const start = Date.now();
  for (;;) {
    const [run] = await db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    if (run && run.status !== 'running') {
      const traces = await db.select({ id: t.runTraces.runId }).from(t.runTraces).where(eq(t.runTraces.runId, runId));
      if (traces.length > 0) return run;
    }
    if (Date.now() - start > timeoutMs) return run;
    await new Promise((r) => setTimeout(r, 25));
  }
}

export async function waitForRuns(db: Db, runIds: string[], timeoutMs = 15_000) {
  return Promise.all(runIds.map((id) => waitForRun(db, id, timeoutMs)));
}

export async function agentRunsOfPr(db: Db, prId: string) {
  return db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, prId));
}

export async function multiRunsOfPr(db: Db, prId: string) {
  return db.select().from(t.multiAgentRuns).where(eq(t.multiAgentRuns.prId, prId));
}

export async function countAll(db: Db, table: typeof t.agentRuns | typeof t.multiAgentRuns | typeof t.memory): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(table);
  return row!.n;
}

export async function findingsOfPr(db: Db, prId: string) {
  const reviews = await db.select({ id: t.reviews.id }).from(t.reviews).where(eq(t.reviews.prId, prId));
  if (reviews.length === 0) return [];
  return db
    .select()
    .from(t.findings)
    .where(
      inArray(
        t.findings.reviewId,
        reviews.map((r) => r.id),
      ),
    );
}

/** p95 of a list of durations (nearest-rank). */
export function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1]!;
}
