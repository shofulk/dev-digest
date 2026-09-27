import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, jsonb, timestamp, doublePrecision, index, check } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { pullRequests } from './pulls';

// ============================================================ Review & findings

export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id'),
  /** The agent_run that produced this review (links the timeline run ↔ review). */
  runId: uuid('run_id'),
  kind: text('kind', { enum: ['summary', 'review'] }).notNull(),
  verdict: text('verdict'),
  summary: text('summary'),
  score: integer('score'),
  model: text('model'),
  createdAt: now(),
}, (t) => ({
  // The PR list counts findings per PR by joining through here; Postgres does
  // not index a FK column on its own.
  prIdx: index('reviews_pr_idx').on(t.prId),
}));

export const findings = pgTable('findings', {
  id: uuid('id').primaryKey().defaultRandom(),
  reviewId: uuid('review_id')
    .notNull()
    .references(() => reviews.id, { onDelete: 'cascade' }),
  file: text('file').notNull(),
  startLine: integer('start_line').notNull(),
  endLine: integer('end_line').notNull(),
  severity: text('severity').notNull(),
  category: text('category').notNull(),
  title: text('title').notNull(),
  rationale: text('rationale').notNull(),
  suggestion: text('suggestion'),
  confidence: doublePrecision('confidence').notNull(),
  kind: text('kind').notNull().default('finding'),
  trifectaComponents: jsonb('trifecta_components').$type<string[]>(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  /** Model-tagged in/out-of-scope (only when a PR intent was in the prompt);
   *  the out-of-scope FILTER is mechanical, this column is just the tag. */
  scope: text('scope'),
}, (t) => ({
  // Findings are always read per review (the PR list's severity tally, the
  // detail page's per-run lists); the FK alone gives no index.
  reviewIdx: index('findings_review_idx').on(t.reviewId),
  scopeCk: check('findings_scope_ck', sql`${t.scope} is null or ${t.scope} in ('in', 'out')`),
}));

export const prIntent = pgTable('pr_intent', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  intent: text('intent').notNull(),
  inScope: jsonb('in_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  outOfScope: jsonb('out_of_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  /** low/medium/high — gates the reviewer-core scope filter (AC9) and the UI chip. */
  confidence: text('confidence').notNull().default('low'),
  /** Resolved references (`IntentSource[]`): kind, ref, status, reason, chars. */
  sources: jsonb('sources').$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
  /** PR head SHA this intent was derived at — staleness is derived by comparing
   *  to the PR's CURRENT head_sha, never stored as a boolean. */
  headSha: text('head_sha'),
  /** Provider/model that produced this intent (audit + UI footer). */
  model: text('model'),
  /** Last derivation's section sizes/usage — content-free (AC12). */
  stats: jsonb('stats'),
  derivedAt: timestamp('derived_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  confidenceCk: check(
    'pr_intent_confidence_ck',
    sql`${t.confidence} in ('low', 'medium', 'high')`,
  ),
}));

export const prBrief = pgTable('pr_brief', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  json: jsonb('json').notNull(),
});
