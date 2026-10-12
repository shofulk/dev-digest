import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { EvalCaseRow, EvalRunJoinedRow, EvalRunRow } from '../../db/rows.js';
import { linkedSkillRowsForAgent } from '../_shared/repository/agent-skills.repo.js';
import type { AgentSkillRow } from '../_shared/repository/agent-skills.repo.js';

/**
 * Eval data-access (ring 2). Owns `eval_cases` and `eval_runs`. Every query is
 * scoped to a workspace through `eval_cases.workspace_id` — `eval_runs` carries no
 * tenancy column of its own, so a run is only ever reached through its case.
 *
 * A suite run is NOT a table: its rows are grouped by `actual_output->>'run_id'`.
 */

export type { EvalCaseRow, EvalRunRow, EvalRunJoinedRow };

export interface InsertEvalCase {
  workspaceId: string;
  agentId: string;
  name: string;
  inputDiff: string;
  inputFiles: unknown;
  inputMeta: unknown;
  expectedOutput: unknown;
  notes: string | null;
}

/** The editable columns of a case; `name` through `expectedOutput` are all written together. */
export interface UpdateEvalCase {
  name: string;
  notes: string | null;
  inputDiff: string;
  inputFiles: unknown;
  inputMeta: unknown;
  expectedOutput: unknown;
}

/** Columns written when a case finishes (one UPDATE, together with the status). */
export interface CompleteRowCols {
  pass: boolean;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  durationMs: number;
  costUsd: number | null;
}

const rowStatus = sql`${t.evalRuns.actualOutput}->>'status'`;
const sourceFinding = sql`${t.evalCases.inputMeta}->>'source_finding_id'`;

export class EvalRepository {
  constructor(private db: Db) {}

  // ---- cases --------------------------------------------------------------

  async findCaseBySourceFinding(
    workspaceId: string,
    agentId: string,
    findingId: string,
  ): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.evalCases.ownerId, agentId),
          sql`${sourceFinding} = ${findingId}`,
        ),
      );
    return row;
  }

  async insertCase(values: InsertEvalCase): Promise<EvalCaseRow> {
    const [row] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId: values.workspaceId,
        ownerKind: 'agent',
        ownerId: values.agentId,
        name: values.name,
        inputDiff: values.inputDiff,
        inputFiles: values.inputFiles,
        inputMeta: values.inputMeta,
        expectedOutput: values.expectedOutput,
        notes: values.notes,
      })
      .returning();
    return row!;
  }

  /**
   * Edit a case. In ONE transaction: first pin every older run row of the case that
   * stores no `expectation` to the case's pre-update `expected_output` (so past
   * results keep the expectation they were scored with), then write the case.
   * Never touches `pass` or a metric column. `undefined` when the case is not an
   * agent case of the workspace.
   */
  async updateCase(
    workspaceId: string,
    id: string,
    values: UpdateEvalCase,
  ): Promise<EvalCaseRow | undefined> {
    return this.db.transaction(async (tx) => {
      const inCase = and(
        eq(t.evalCases.workspaceId, workspaceId),
        eq(t.evalCases.id, id),
        eq(t.evalCases.ownerKind, 'agent'),
      );
      // Lock the case first (DELETE takes the case row, then cascades to its runs).
      const [current] = await tx
        .select({ expectedOutput: t.evalCases.expectedOutput })
        .from(t.evalCases)
        .where(inCase)
        .for('update');
      if (!current) return undefined;
      await tx
        .update(t.evalRuns)
        .set({
          actualOutput: sql`${t.evalRuns.actualOutput} || jsonb_build_object('expectation', ${JSON.stringify(current.expectedOutput ?? null)}::jsonb)`,
        })
        .where(and(eq(t.evalRuns.caseId, id), sql`${t.evalRuns.actualOutput}->'expectation' IS NULL`));
      const [row] = await tx
        .update(t.evalCases)
        .set({
          name: values.name,
          notes: values.notes,
          inputDiff: values.inputDiff,
          inputFiles: values.inputFiles,
          inputMeta: values.inputMeta,
          expectedOutput: values.expectedOutput,
        })
        .where(inCase)
        .returning();
      return row;
    });
  }

  async listCases(workspaceId: string, agentId: string): Promise<EvalCaseRow[]> {
    return this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.evalCases.ownerId, agentId),
        ),
      )
      .orderBy(asc(t.evalCases.name), asc(t.evalCases.id));
  }

  async getCase(workspaceId: string, id: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)));
    return row;
  }

  /** Delete a case; its `eval_runs` rows cascade. False when it is not in the workspace. */
  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  /** Case count per agent id. */
  async countCasesByAgent(workspaceId: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ agentId: t.evalCases.ownerId, n: sql<number>`count(*)::int` })
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerKind, 'agent')))
      .groupBy(t.evalCases.ownerId);
    return new Map(rows.map((r) => [r.agentId, r.n]));
  }

  // ---- runs ---------------------------------------------------------------

  /** One pending row per case, all in one statement so they share `ran_at`. */
  async insertPendingRows(
    rows: { caseId: string; actualOutput: unknown }[],
  ): Promise<EvalRunRow[]> {
    if (rows.length === 0) return [];
    return this.db
      .insert(t.evalRuns)
      .values(rows.map((r) => ({ caseId: r.caseId, actualOutput: r.actualOutput })))
      .returning();
  }

  /**
   * Finish a row: status document and metric columns in ONE statement, so a poller
   * never sees `completed` without its metrics. Guarded on `pending` — a row the
   * timeout reconciler already errored, or whose case was deleted, is left alone.
   */
  async completeRow(rowId: string, cols: CompleteRowCols, actualOutput: unknown): Promise<boolean> {
    const rows = await this.db
      .update(t.evalRuns)
      .set({
        actualOutput,
        pass: cols.pass,
        recall: cols.recall,
        precision: cols.precision,
        citationAccuracy: cols.citationAccuracy,
        durationMs: cols.durationMs,
        costUsd: cols.costUsd,
      })
      .where(and(eq(t.evalRuns.id, rowId), sql`${rowStatus} = 'pending'`))
      .returning({ id: t.evalRuns.id });
    return rows.length > 0;
  }

  /** Finish a row as errored (same single-statement, pending-guarded rule). */
  async errorRow(rowId: string, actualOutput: unknown, durationMs: number | null): Promise<boolean> {
    const rows = await this.db
      .update(t.evalRuns)
      .set({ actualOutput, durationMs })
      .where(and(eq(t.evalRuns.id, rowId), sql`${rowStatus} = 'pending'`))
      .returning({ id: t.evalRuns.id });
    return rows.length > 0;
  }

  /** Rows of this workspace still pending since before `cutoff` become `errored` / `timeout`. */
  async reconcileStalePending(workspaceId: string, cutoff: Date, now: Date): Promise<number> {
    const patch = JSON.stringify({
      status: 'errored',
      reason: 'timeout',
      finished_at: now.toISOString(),
    });
    const rows = await this.db
      .update(t.evalRuns)
      .set({ actualOutput: sql`${t.evalRuns.actualOutput} || ${patch}::jsonb` })
      .where(
        and(
          sql`${rowStatus} = 'pending'`,
          lt(t.evalRuns.ranAt, cutoff),
          inArray(
            t.evalRuns.caseId,
            this.db
              .select({ id: t.evalCases.id })
              .from(t.evalCases)
              .where(eq(t.evalCases.workspaceId, workspaceId)),
          ),
        ),
      )
      .returning({ id: t.evalRuns.id });
    return rows.length;
  }

  async hasPendingForAgent(workspaceId: string, agentId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: t.evalRuns.id })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.evalCases.ownerId, agentId),
          sql`${rowStatus} = 'pending'`,
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async runRowsForAgent(workspaceId: string, agentId: string): Promise<EvalRunJoinedRow[]> {
    return this.joined(
      and(
        eq(t.evalCases.workspaceId, workspaceId),
        eq(t.evalCases.ownerKind, 'agent'),
        eq(t.evalCases.ownerId, agentId),
      ),
    );
  }

  async runRowsByRunId(workspaceId: string, runId: string): Promise<EvalRunJoinedRow[]> {
    return this.joined(
      and(
        eq(t.evalCases.workspaceId, workspaceId),
        sql`${t.evalRuns.actualOutput}->>'run_id' = ${runId}`,
      ),
    );
  }

  async runRowsForWorkspace(workspaceId: string): Promise<EvalRunJoinedRow[]> {
    return this.joined(
      and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerKind, 'agent')),
    );
  }

  private joined(where: ReturnType<typeof and>): Promise<EvalRunJoinedRow[]> {
    return this.db
      .select({ run: t.evalRuns, evalCase: t.evalCases })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(where)
      .orderBy(desc(t.evalRuns.ranAt), asc(t.evalCases.id));
  }

  // ---- skills -------------------------------------------------------------

  /** Every skill the agent links, both gates' flags included (the caller applies them). */
  agentSkillRows(agentId: string): Promise<AgentSkillRow[]> {
    return linkedSkillRowsForAgent(this.db, agentId);
  }
}
