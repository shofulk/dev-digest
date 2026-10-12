// RING 2 — infrastructure. Writes straight to the `Db` passed in
// (`onion-architecture`); called only from `src/db/seed.ts`'s CLI
// entrypoint, never from a ring-1 service. Imports ONLY `./schema.js`,
// `./client.js` types and `drizzle-orm` — no package whose deps install
// after `db:seed` runs in CI (the review-engine workspace package, or
// `@devdigest/shared`).
/**
 * D10 — PR Brief demo fixture for the seeded `acme/payments-api` PR #482.
 *
 * Inserts the `pr_brief` row `onConflictDoNothing()` so a re-seed never
 * clobbers a later real generation. `seed()` itself stays untouched (the
 * `*.it.test.ts` suite therefore starts with no brief by design); only the
 * CLI entrypoint of `seed.ts` calls `seedBriefDemo`, after
 * `seedProjectContextDemo`.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import * as t from './schema.js';

/** The head SHA PR #482 is seeded at (`seed.ts`) — this brief describes it. */
export const SEED_BRIEF_HEAD_SHA = 'a1b2c3d4e5f6';

export const SEED_BRIEF_DOC = {
  summary:
    'Adds a token-bucket rate limiter in front of every public API route and a config ' +
    'change that a review already flagged for a committed secret.',
  risks: [
    {
      kind: 'config_secrets',
      severity: 'high',
      title: 'Secret key committed in config',
      explanation: 'src/config.ts carries a live Stripe key; it must move to the environment and be rotated.',
      file_refs: ['src/config.ts'],
    },
    {
      kind: 'performance',
      severity: 'medium',
      title: 'Limiter runs on every public request',
      explanation: 'Each public call now passes the token bucket, so its cost and failure mode matter for all routes.',
      file_refs: ['src/middleware/ratelimit.ts'],
    },
  ],
  review_focus: [
    {
      file: 'src/middleware/ratelimit.ts',
      line: null,
      reason: 'Start here: the new token-bucket limiter that every public route now depends on',
    },
    { file: 'src/config.ts', line: null, reason: 'Check the new limits and the committed secret' },
    { file: 'src/api/public/webhooks.ts', line: null, reason: 'See how the limiter is wired into the webhook routes' },
  ],
  missing_inputs: [{ input: 'blast', state: 'degraded', detail: 'no_data' }],
};

export const SEED_BRIEF_MODEL = 'openrouter/deepseek/deepseek-v4-flash';

export const SEED_BRIEF_STATS = {
  tokens_in: 8200,
  tokens_out: 1300,
  cost_usd: 0.014,
  attempts: 1,
  duration_ms: 4200,
};

export async function seedBriefDemo(db: Db): Promise<void> {
  const [repo] = await db.select().from(t.repos).where(eq(t.repos.fullName, 'acme/payments-api'));
  if (!repo) return; // seed() wasn't run first — nothing to attach the demo to.

  const [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repo.id), eq(t.pullRequests.number, 482)));
  if (!pr) return;

  await db
    .insert(t.prBrief)
    .values({
      prId: pr.id,
      json: SEED_BRIEF_DOC,
      headSha: SEED_BRIEF_HEAD_SHA,
      model: SEED_BRIEF_MODEL,
      stats: SEED_BRIEF_STATS,
    })
    .onConflictDoNothing();
}
