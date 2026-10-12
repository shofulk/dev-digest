import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  jsonb,
  timestamp,
  doublePrecision,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { agentRuns } from './runs';

export const ciInstallations = pgTable(
  'ci_installations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    repo: text('repo').notNull(),
    targetType: text('target_type', { enum: ['gha', 'circle', 'jenkins', 'cli'] }).notNull(),
    installedAt: timestamp('installed_at', { withTimezone: true }).defaultNow().notNull(),
    status: text('status', { enum: ['pr_open', 'manual', 'active'] })
      .notNull()
      .default('manual'),
    installedAgentVersion: integer('installed_agent_version').notNull().default(1),
    prUrl: text('pr_url'),
    triggers: jsonb('triggers')
      .$type<string[]>()
      .notNull()
      .default(['opened', 'synchronize']),
    postAs: text('post_as', { enum: ['github_review', 'pr_comment', 'none'] })
      .notNull()
      .default('github_review'),
  },
  (t) => ({
    agentRepoUq: uniqueIndex('ci_installations_agent_repo_uq').on(t.agentId, t.repo),
  }),
);

export const ciRuns = pgTable(
  'ci_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ciInstallationId: uuid('ci_installation_id').references(() => ciInstallations.id, {
      onDelete: 'set null',
    }),
    prNumber: integer('pr_number'),
    ranAt: timestamp('ran_at', { withTimezone: true }),
    status: text('status'),
    findingsCount: integer('findings_count'),
    costUsd: doublePrecision('cost_usd'),
    githubUrl: text('github_url'),
    source: text('source'),
    agentRunId: uuid('agent_run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    githubRunId: bigint('github_run_id', { mode: 'number' }).notNull(),
    verdict: text('verdict', { enum: ['blocked', 'passed', 'no_findings', 'failed'] }).notNull(),
  },
  (t) => ({
    githubRunUq: uniqueIndex('ci_runs_github_run_installation_uq').on(t.githubRunId, t.ciInstallationId),
  }),
);
