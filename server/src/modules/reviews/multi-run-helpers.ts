import type { AgentColumn, Conflict, MultiAgentRunStatus, RunEstimate, Severity } from '@devdigest/shared';

/**
 * Ring 1 (application). Pure helpers for multi-run reads: finding groups,
 * conflicts, totals and run estimates. No LLM, no I/O.
 * */

/** One agent's column as the grouping sees it. */
export type GroupInputColumn = {
  agent_id: string;
  agent_name: string;
  status: string;
  findings: {
    id: string;
    severity: Severity;
    title: string;
    file: string;
    start_line: number;
    end_line: number;
  }[];
};

/** The per-run numbers `computeTotals` reads. */
export type TotalsInput = { status: string; duration_ms: number | null; cost_usd: number | null };

/** One finished `agent_runs` row feeding an estimate. */
export type EstimateRow = { agent_id: string; duration_ms: number | null; cost_usd: number | null };

type GroupFinding = GroupInputColumn['findings'][number];
type FlaggedFinding = GroupFinding & { agent_id: string; lo: number; hi: number };

const SEVERITY_RANK: Record<Severity, number> = { CRITICAL: 3, WARNING: 2, SUGGESTION: 1 };

const compareCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Most severe first; ties: lower start_line, then id ascending. */
function compareBySeverity(a: GroupFinding, b: GroupFinding): number {
  return (
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
    a.start_line - b.start_line ||
    compareCodeUnit(a.id, b.id)
  );
}

/** Group same-file overlapping findings of `done` columns into ordered `Conflict`s. */
export function groupFindings(columns: GroupInputColumn[]): Conflict[] {
  const done = columns.filter((c) => c.status === 'done');
  const byFile = new Map<string, FlaggedFinding[]>();
  for (const col of done) {
    for (const finding of col.findings) {
      const list = byFile.get(finding.file) ?? [];
      list.push({
        ...finding,
        agent_id: col.agent_id,
        lo: Math.min(finding.start_line, finding.end_line),
        hi: Math.max(finding.start_line, finding.end_line),
      });
      byFile.set(finding.file, list);
    }
  }

  const groups: Conflict[] = [];
  const smallestId = new Map<Conflict, string>();
  for (const [file, list] of byFile) {
    // Sort-and-sweep: a finding joins the open group while it starts inside the group's reach.
    list.sort((a, b) => a.lo - b.lo || a.hi - b.hi || compareCodeUnit(a.id, b.id));
    let current: FlaggedFinding[] = [];
    let reach = -Infinity;
    const flush = (): void => {
      if (current.length === 0) return;
      const group = buildGroup(file, current, done);
      groups.push(group);
      smallestId.set(group, current.map((f) => f.id).sort(compareCodeUnit)[0]!);
      current = [];
    };
    for (const f of list) {
      if (current.length > 0 && f.lo > reach) {
        flush();
        reach = -Infinity;
      }
      current.push(f);
      reach = Math.max(reach, f.hi);
    }
    flush();
  }

  return groups.sort(
    (a, b) =>
      compareCodeUnit(a.file, b.file) ||
      a.line - b.line ||
      compareCodeUnit(a.title, b.title) ||
      compareCodeUnit(smallestId.get(a)!, smallestId.get(b)!),
  );
}

function buildGroup(file: string, members: FlaggedFinding[], done: GroupInputColumn[]): Conflict {
  const titleFinding = [...members].sort(compareBySeverity)[0]!;
  const takes = done.map((col) => {
    const mine = members.filter((m) => m.agent_id === col.agent_id).sort(compareBySeverity)[0];
    return mine
      ? { agent_id: col.agent_id, persona: col.agent_name, verdict: mine.severity as Severity | 'ignored', note: mine.title }
      : { agent_id: col.agent_id, persona: col.agent_name, verdict: 'ignored' as Severity | 'ignored', note: '' };
  });
  const flagged = takes.filter((t) => t.verdict !== 'ignored');
  const isConflict =
    (flagged.length > 0 && flagged.length < takes.length) || new Set(flagged.map((t) => t.verdict)).size > 1;
  return {
    file,
    line: Math.min(...members.map((m) => m.start_line)),
    title: titleFinding.title,
    takes,
    is_conflict: isConflict,
  };
}

/** Totals over `done` runs only: longest duration (0 when none), summed non-null cost (null when none). */
export function computeTotals(runs: TotalsInput[]): { total_duration_ms: number; total_cost_usd: number | null } {
  const done = runs.filter((r) => r.status === 'done');
  const total_duration_ms = done.reduce((max, r) => Math.max(max, r.duration_ms ?? 0), 0);
  const costs = done.map((r) => r.cost_usd).filter((c): c is number => c !== null);
  return { total_duration_ms, total_cost_usd: costs.length ? costs.reduce((a, b) => a + b, 0) : null };
}

/** Median of `values`; an even count gives the mean of the middle two; null when empty. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** One `RunEstimate` per agent id, from that agent's finished runs in `rows`. */
export function buildEstimates(agentIds: string[], rows: EstimateRow[]): RunEstimate[] {
  return agentIds.map((agent_id) => {
    const mine = rows.filter((r) => r.agent_id === agent_id);
    const duration = median(mine.map((r) => r.duration_ms).filter((d): d is number => d !== null));
    const cost = median(mine.map((r) => r.cost_usd).filter((c): c is number => c !== null));
    return {
      agent_id,
      median_duration_ms: duration === null ? null : Math.round(duration),
      median_cost_usd: cost,
      sample_size: mine.length,
    };
  });
}

// ---- run list (SPEC-04) ----------------------------------------------------

/** The first row per non-null agent id wins (rows arrive newest first); null agent ids are skipped. */
export function newestPerAgent<T>(rowsNewestFirst: T[], agentIdOf: (row: T) => string | null): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rowsNewestFirst) {
    const id = agentIdOf(row);
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

const COLUMN_STATUSES: readonly AgentColumn['status'][] = ['done', 'failed', 'running', 'cancelled'];

/** The four column statuses map to themselves; anything else is `failed`. */
export function columnStatus(raw: string | null): AgentColumn['status'] {
  return COLUMN_STATUSES.find((s) => s === raw) ?? 'failed';
}

/** Overall status of a multi-run from its counted agent runs' statuses. */
export function summaryStatus(statuses: AgentColumn['status'][]): MultiAgentRunStatus {
  if (statuses.includes('running')) return 'running';
  if (statuses.length === 0) return 'failed';
  if (statuses.every((s) => s === 'done')) return 'done';
  return statuses.includes('done') ? 'partial' : 'failed';
}
