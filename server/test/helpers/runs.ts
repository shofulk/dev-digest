import * as t from '../../src/db/schema.js';
import { eq, inArray } from 'drizzle-orm';
import type { PgFixture } from './pg.js';

/**
 * `runReview` is fire-and-forget: the POST returns runIds immediately and each
 * agent's review is persisted in the background (the client subscribes to SSE).
 * Tests that assert on persisted reviews/findings/traces must first wait for the
 * background runs to finish. This polls `agent_runs` until every row for the PR
 * reaches a terminal status (done / failed / cancelled) AND that run's trace
 * document exists: the executor marks the run terminal BEFORE it writes
 * `run_traces`, so a status-only wait can legally read the trace before it is
 * there (`GET /runs/:id/trace` then 404s and the assertion reads `undefined`).
 */
const TERMINAL = new Set(['done', 'failed', 'cancelled']);

export async function waitForPrRuns(
  db: PgFixture['handle']['db'],
  prId: string,
  opts: { expected?: number; timeoutMs?: number } = {},
): Promise<Array<typeof t.agentRuns.$inferSelect>> {
  const { expected, timeoutMs = 10_000 } = opts;
  const start = Date.now();
  for (;;) {
    const runs = await db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, prId));
    const terminal = runs.filter((r) => TERMINAL.has(r.status ?? ''));
    // With an explicit `expected`, wait until that many runs finish (ignores any
    // extra rows, e.g. a trifecta scan). Otherwise wait for all rows to settle.
    const done =
      expected != null
        ? terminal.length >= expected
        : runs.length > 0 && terminal.length === runs.length;
    if (done && (await tracesWritten(db, terminal.map((r) => r.id)))) return runs;
    if (Date.now() - start > timeoutMs) return runs;
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Every terminal run writes exactly one `run_traces` row — on the failure path too. */
async function tracesWritten(
  db: PgFixture['handle']['db'],
  runIds: string[],
): Promise<boolean> {
  if (runIds.length === 0) return true;
  const traces = await db
    .select({ runId: t.runTraces.runId })
    .from(t.runTraces)
    .where(inArray(t.runTraces.runId, runIds));
  return traces.length === runIds.length;
}
