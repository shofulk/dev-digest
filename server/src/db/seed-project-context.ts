// RING 2 — infrastructure. Writes straight to `node:fs` and the `Db` passed
// in (`onion-architecture`); called only from `src/db/seed.ts`'s CLI
// entrypoint, never from a ring-1 service.
/**
 * D10 — Project Context demo fixtures for the seeded `acme/payments-api` repo.
 *
 * Writes three Markdown fixtures into a PLAIN FOLDER under `cloneDir`
 * (`<cloneDir>/acme/payments-api`) — no `git init`, no git client — points
 * `repos.clone_path` at it, attaches `docs/architecture.md` to the seeded
 * "Security Reviewer" agent, and inserts one demo review run (fixed id) with
 * its trace, so the Project Context page, the run trace drawer and the e2e
 * flow (T14) have something to show without ever running a real review.
 *
 * Idempotent: a re-run skips the filesystem write when the demo folder
 * already exists, and skips the DB insert when the fixed run id is already
 * there. `seed()` itself is unchanged — only the CLI entrypoint of `seed.ts`
 * calls this.
 *
 * `repos.clone_path` and the Security Reviewer agent's `context_docs` are
 * written ONLY the first time (guarded on `clonePath === null` / an empty
 * `contextDocs`) — a re-seed must never clobber a user's later edit to
 * either field.
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import * as t from './schema.js';
import { TiktokenTokenizer } from '../adapters/tokenizer/index.js';
import type { ContextDocTrace, RunTrace } from '@devdigest/shared';

/** Fixed so re-seeding never duplicates the demo run (the idempotency check). */
const DEMO_RUN_ID = '00000000-0000-0000-0000-00000000da7a';

export const ARCHITECTURE_MD = `# Payments API architecture

- The public API never talks to the database directly.
- \`api/\` calls \`services/\`, which call \`db/\`.
- module api/ does not import db/ directly.

\`\`\`ts
// api/users.ts
import { getUser } from '../services/users';
\`\`\`
`;

/**
 * CI-2 fix — this is a FIXED STRING LITERAL equal to what
 * `wrapUntrusted('docs/architecture.md', ARCHITECTURE_MD)` (reviewer-core)
 * would produce, written out by hand instead of imported: `db:seed` runs in
 * the `e2e-web` CI job BEFORE `reviewer-core`'s dependencies are installed,
 * so this module must not import `@devdigest/reviewer-core` (its
 * `structured.ts` pulls in the `openai` package). Kept honest by
 * `server/test/seed-project-context.test.ts`, which imports the real
 * `wrapUntrusted` (vitest resolves the alias; `db:seed` does not) and
 * asserts the two are identical.
 */
export const ARCHITECTURE_MD_SPECS_BLOCK = `<untrusted source="docs/architecture.md">
${ARCHITECTURE_MD}
</untrusted>`;

const RATE_LIMITING_SPEC_MD = `# Rate limiting

Every public endpoint is behind a token-bucket limiter keyed by API key.
`;

const INSIGHTS_MD = `# Insights

### Rate limiter buckets are per-process, not shared across replicas.
`;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Writes the demo checkout fixtures, only when the folder is absent. */
async function writeDemoCheckout(demoDir: string): Promise<void> {
  if (await exists(demoDir)) return;
  await mkdir(join(demoDir, 'docs'), { recursive: true });
  await mkdir(join(demoDir, 'specs'), { recursive: true });
  await mkdir(join(demoDir, 'insights'), { recursive: true });
  await writeFile(join(demoDir, 'docs', 'architecture.md'), ARCHITECTURE_MD, 'utf8');
  await writeFile(join(demoDir, 'specs', 'rate-limiting.spec.md'), RATE_LIMITING_SPEC_MD, 'utf8');
  await writeFile(join(demoDir, 'insights', 'INSIGHTS.md'), INSIGHTS_MD, 'utf8');
}

export async function seedProjectContextDemo(db: Db, cloneDir: string): Promise<void> {
  const demoDir = join(cloneDir, 'acme', 'payments-api');
  await writeDemoCheckout(demoDir);

  const [repo] = await db
    .select()
    .from(t.repos)
    .where(eq(t.repos.fullName, 'acme/payments-api'));
  if (!repo) return; // seed() wasn't run first — nothing to attach the demo to.
  if (repo.clonePath === null) {
    await db.update(t.repos).set({ clonePath: demoDir }).where(eq(t.repos.id, repo.id));
  }

  const [agent] = await db
    .select()
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, repo.workspaceId), eq(t.agents.name, 'Security Reviewer')));
  if (agent && (agent.contextDocs?.length ?? 0) === 0) {
    await db
      .update(t.agents)
      .set({ contextDocs: ['docs/architecture.md'] })
      .where(eq(t.agents.id, agent.id));
  }

  const [existingRun] = await db.select().from(t.agentRuns).where(eq(t.agentRuns.id, DEMO_RUN_ID));
  if (existingRun) return; // idempotent

  const [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repo.id), eq(t.pullRequests.number, 482)));
  if (!pr || !agent) return;

  const tokenizer = new TiktokenTokenizer();
  const tokens = tokenizer.count(ARCHITECTURE_MD);
  const specsBlock = ARCHITECTURE_MD_SPECS_BLOCK;

  const contextDocs: ContextDocTrace[] = [
    { path: 'docs/architecture.md', origin: 'agent', tokens, status: 'included' },
    { path: 'docs/missing.md', origin: 'agent', tokens: null, status: 'missing' },
  ];

  await db.insert(t.agentRuns).values({
    id: DEMO_RUN_ID,
    workspaceId: repo.workspaceId,
    agentId: agent.id,
    prId: pr.id,
    provider: agent.provider,
    model: agent.model,
    durationMs: 1200,
    tokensIn: 400,
    tokensOut: 120,
    costUsd: 0.002,
    status: 'done',
    source: 'local',
    findingsCount: 1,
    grounding: '1/1 passed',
    score: 72,
    blockers: 0,
    skillsUsed: [],
  });

  const trace: RunTrace = {
    config: {
      agent: agent.name,
      version: String(agent.version),
      provider: agent.provider,
      model: agent.model,
      pr: pr.number,
      source: 'local',
    },
    stats: {
      duration_ms: 1200,
      tokens_in: 400,
      tokens_out: 120,
      cost_usd: 0.002,
      findings: 1,
      grounding: '1/1 passed',
      scope_filtered: 0,
    },
    prompt_assembly: {
      system: agent.systemPrompt,
      skills: null,
      memory: null,
      specs: specsBlock,
      callers: null,
      repo_map: null,
      pr_description: pr.body ?? null,
      intent: null,
      user: `## Project context\n${specsBlock}`,
    },
    tool_calls: [],
    raw_output: '',
    memory_pulled: [],
    specs_read: ['docs/architecture.md'],
    context_docs: contextDocs,
    log: [],
  };

  await db.insert(t.runTraces).values({ runId: DEMO_RUN_ID, trace });
}
