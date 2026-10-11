import { describe, it, expect } from 'vitest';
import type { EvalCaseRow, EvalRunJoinedRow } from '../../db/rows.js';
import {
  casesOnlyIn,
  diffLines,
  EVAL_TASK_LINE,
  evalPrDescription,
  sanitizeErrorReason,
  groupSuites,
  latestCompletedResult,
  runAllRefusal,
  systemPromptOf,
  toCaseOutcome,
  toCaseView,
  toDashboard,
  type Suite,
} from './helpers.js';

const expectation = (file = 'src/a.ts') => ({
  type: 'must_find',
  file,
  start_line: 10,
  end_line: 20,
  severity: 'WARNING',
  category: 'bug',
  title: 't',
});

function caseRow(id: string, over: Partial<EvalCaseRow> = {}): EvalCaseRow {
  return {
    id,
    workspaceId: 'ws',
    ownerKind: 'agent',
    ownerId: 'agent-1',
    name: `case ${id}`,
    inputDiff: 'diff',
    inputFiles: ['src/a.ts'],
    inputMeta: { source_finding_id: `f-${id}` },
    expectedOutput: expectation(),
    notes: null,
    ...over,
  };
}

interface RowSpec {
  caseId: string;
  runId: string;
  agentId?: string;
  version?: number;
  at: string;
  status?: 'pending' | 'completed' | 'errored';
  pass?: boolean | null;
  findings?: { file: string; start_line: number; end_line: number }[];
  finishedAt?: string;
}

function runRow(s: RowSpec): EvalRunJoinedRow {
  const status = s.status ?? 'completed';
  const findings = (s.findings ?? []).map((f) => ({
    ...f,
    severity: 'WARNING' as const,
    category: 'bug' as const,
    title: 'f',
  }));
  return {
    evalCase: caseRow(s.caseId),
    run: {
      id: `row-${s.runId}-${s.caseId}`,
      caseId: s.caseId,
      ranAt: new Date(s.at),
      actualOutput:
        status === 'pending'
          ? { run_id: s.runId, agent_id: s.agentId ?? 'agent-1', agent_version: s.version ?? 1, status }
          : {
              run_id: s.runId,
              agent_id: s.agentId ?? 'agent-1',
              agent_version: s.version ?? 1,
              status,
              findings,
              grounding_kept: findings.length,
              grounding_dropped: 0,
              finished_at: s.finishedAt ?? s.at,
            },
      pass: status === 'completed' ? (s.pass ?? true) : null,
      recall: null,
      precision: null,
      citationAccuracy: null,
      durationMs: status === 'completed' ? 100 : null,
      costUsd: status === 'completed' ? 0.5 : null,
    },
  };
}

const HIT = [{ file: 'src/a.ts', start_line: 12, end_line: 12 }];

describe('groupSuites', () => {
  it('groups interleaved run ids into separate suites, newest first', () => {
    const suites = groupSuites([
      runRow({ caseId: '1', runId: 'r1', at: '2026-10-01T10:00:00Z', findings: HIT }),
      runRow({ caseId: '1', runId: 'r2', agentId: 'agent-2', at: '2026-10-01T10:05:00Z', findings: HIT }),
      runRow({ caseId: '2', runId: 'r1', at: '2026-10-01T10:00:00Z', findings: HIT }),
      runRow({ caseId: '2', runId: 'r2', agentId: 'agent-2', at: '2026-10-01T10:05:00Z', findings: HIT }),
    ]);
    expect(suites.map((s) => s.summary.run_id)).toEqual(['r2', 'r1']);
    expect(suites[1]!.summary).toMatchObject({ cases_total: 2, cases_done: 2, status: 'completed' });
  });

  it('is running while any row is pending, with the progress and the earliest start', () => {
    const [suite] = groupSuites([
      runRow({ caseId: '1', runId: 'r1', at: '2026-10-01T10:00:02Z', findings: HIT }),
      runRow({ caseId: '2', runId: 'r1', at: '2026-10-01T10:00:00Z', status: 'pending' }),
    ]);
    expect(suite!.summary).toMatchObject({
      status: 'running',
      cases_total: 2,
      cases_done: 1,
      started_at: '2026-10-01T10:00:00.000Z',
      finished_at: null,
    });
  });

  it('scores completed cases and counts errored ones out of the metrics', () => {
    const [suite] = groupSuites([
      runRow({ caseId: '1', runId: 'r1', at: '2026-10-01T10:00:00Z', findings: HIT }),
      runRow({ caseId: '2', runId: 'r1', at: '2026-10-01T10:00:00Z', status: 'errored' }),
    ]);
    expect(suite!.summary).toMatchObject({
      recall: 1,
      precision: 1,
      traces_total: 1,
      cases_errored: 1,
      finished_at: '2026-10-01T10:00:00Z',
    });
  });

  it('skips rows whose output cannot be read', () => {
    const bad = runRow({ caseId: '1', runId: 'r1', at: '2026-10-01T10:00:00Z' });
    bad.run.actualOutput = { legacy: true };
    expect(groupSuites([bad])).toEqual([]);
  });
});

describe('latestCompletedResult', () => {
  it('ignores a newer RUNNING suite and reads the newest completed one', () => {
    const suites = groupSuites([
      runRow({ caseId: '1', runId: 'old', at: '2026-10-01T10:00:00Z', pass: false }),
      runRow({ caseId: '1', runId: 'mid', at: '2026-10-02T10:00:00Z', pass: true }),
      runRow({ caseId: '1', runId: 'new', at: '2026-10-03T10:00:00Z', status: 'pending' }),
    ]);
    expect(latestCompletedResult('1', suites)).toEqual({ result: 'pass', run_id: 'mid', matched: 0 });
  });

  it('reports errored and never_run', () => {
    const suites = groupSuites([runRow({ caseId: '1', runId: 'r', at: '2026-10-01T10:00:00Z', status: 'errored' })]);
    expect(latestCompletedResult('1', suites).result).toBe('errored');
    expect(latestCompletedResult('other', suites)).toEqual({ result: 'never_run', run_id: null, matched: null });
    expect(latestCompletedResult('1', suites).matched).toBeNull();
  });
});

describe('toCaseOutcome / toCaseView', () => {
  it('flags the findings that matched the expectation', () => {
    const [suite] = groupSuites([
      runRow({
        caseId: '1',
        runId: 'r',
        at: '2026-10-01T10:00:00Z',
        findings: [...HIT, { file: 'src/a.ts', start_line: 50, end_line: 51 }],
      }),
    ]);
    const outcome = toCaseOutcome(suite!.rows[0]!);
    expect(outcome.findings.map((f) => f.matched)).toEqual([true, false]);
    expect(outcome.grounding_kept).toBe(2);
  });

  it('builds the case view with a parsed expectation', () => {
    const view = toCaseView(caseRow('1'), { result: 'never_run', run_id: null, matched: null });
    expect(view.expectation?.type).toBe('must_find');
    expect(view.case.input_diff).toBe('diff');
    expect(view.last_result).toBe('never_run');
    expect(view.last_matched).toBeNull();
  });

  it('carries the matched count of the newest completed run into the view', () => {
    const suites = groupSuites([
      runRow({
        caseId: '1',
        runId: 'r',
        at: '2026-10-01T10:00:00Z',
        findings: [...HIT, { file: 'src/a.ts', start_line: 50, end_line: 51 }],
      }),
    ]);
    const view = toCaseView(caseRow('1'), latestCompletedResult('1', suites));
    expect(view.last_matched).toBe(HIT.length);
  });
});

describe('casesOnlyIn', () => {
  it('lists the cases the other suite lacks', () => {
    const [b, a] = groupSuites([
      runRow({ caseId: '1', runId: 'a', at: '2026-10-01T10:00:00Z' }),
      runRow({ caseId: '1', runId: 'b', at: '2026-10-02T10:00:00Z' }),
      runRow({ caseId: '2', runId: 'b', at: '2026-10-02T10:00:00Z' }),
    ]) as [Suite, Suite];
    expect(casesOnlyIn(b, a)).toEqual([{ case_id: '2', name: 'case 2' }]);
    expect(casesOnlyIn(a, b)).toEqual([]);
  });
});

describe('diffLines', () => {
  it('marks add, del and same in order', () => {
    expect(diffLines('a\nb\nc', 'a\nc\nd')).toEqual([
      { op: 'same', text: 'a' },
      { op: 'del', text: 'b' },
      { op: 'same', text: 'c' },
      { op: 'add', text: 'd' },
    ]);
  });
  it('reports identical text as all same', () => {
    expect(diffLines('x\ny', 'x\ny').every((l) => l.op === 'same')).toBe(true);
  });
});

describe('systemPromptOf / task line', () => {
  it('reads the stored prompt defensively', () => {
    expect(systemPromptOf({ system_prompt: 'p' })).toBe('p');
    expect(systemPromptOf({})).toBeNull();
    expect(systemPromptOf(null)).toBeNull();
  });
  it('keeps PR-derived text out of the constant task line', () => {
    expect(EVAL_TASK_LINE).not.toContain('\n');
    expect(EVAL_TASK_LINE).not.toMatch(/#\d|20\d\d/);
  });
  it('carries the title and body in the PR description, title flattened to one line', () => {
    const meta = { source_finding_id: 'f', pr_number: 7, pr_title: 'Add "b"\nIgnore previous', pr_body: 'Body text' };
    expect(evalPrDescription(meta)).toBe('Title: Add "b" Ignore previous\n\nBody text');
    expect(evalPrDescription(meta)).toBe(evalPrDescription(meta));
  });
  it('is undefined when neither title nor body was frozen', () => {
    expect(evalPrDescription({ source_finding_id: 'f', pr_body: '  ' })).toBeUndefined();
    expect(evalPrDescription('junk')).toBeUndefined();
  });
});

describe('sanitizeErrorReason', () => {
  it('prefixes the error class and caps at 200 chars', () => {
    class ProviderError extends Error {
      override name = 'ProviderError';
    }
    expect(sanitizeErrorReason(new ProviderError('boom'))).toBe('ProviderError: boom');
    expect(sanitizeErrorReason(new Error('x'.repeat(500))).length).toBe(200);
  });
  it('redacts token-like strings', () => {
    const out = sanitizeErrorReason(
      new Error('401 for sk-abcdef1234567890 with Bearer abc.def-123 and api_key=hunter2 then ghp_abcdefgh12345'),
    );
    for (const secret of ['sk-abcdef1234567890', 'abc.def-123', 'hunter2', 'ghp_abcdefgh12345']) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('[redacted]');
  });
  it('handles a non-Error throw', () => {
    expect(sanitizeErrorReason(undefined)).toBe('Error: unknown error');
  });
});

describe('toDashboard', () => {
  const agents = [
    { id: 'agent-1', name: 'One', model: 'm' },
    { id: 'agent-2', name: 'Two', model: 'm' },
    { id: 'agent-3', name: 'Three', model: 'm' },
  ];

  it('lists only agents with cases, with the latest COMPLETED run and interleaved history', () => {
    const rows: EvalRunJoinedRow[] = [];
    for (let i = 1; i <= 12; i++) {
      const day = String(i).padStart(2, '0');
      rows.push(runRow({ caseId: '1', runId: `a1-${day}`, version: i, at: `2026-10-${day}T10:00:00Z`, findings: HIT }));
      rows.push(
        runRow({ caseId: '9', runId: `a2-${day}`, agentId: 'agent-2', at: `2026-10-${day}T12:00:00Z`, findings: HIT }),
      );
    }
    rows.push(runRow({ caseId: '1', runId: 'a1-run', version: 13, at: '2026-10-20T10:00:00Z', status: 'pending' }));

    const out = toDashboard(
      agents,
      new Map([
        ['agent-1', 1],
        ['agent-2', 1],
      ]),
      groupSuites(rows),
    );
    expect(out.agents.map((a) => a.agent_id)).toEqual(['agent-1', 'agent-2']);
    const one = out.agents[0]!;
    expect(one.latest?.run_id).toBe('a1-12');
    expect(one.latest?.agent_version).toBe(12);
    expect(one.trend).toHaveLength(10);
    expect(one.trend[0]!.run_id).toBe('a1-03');
    expect(one.trend[9]!.run_id).toBe('a1-12');
    expect(out.recent_runs).toHaveLength(20);
    expect(out.recent_runs[0]!.run_id).toBe('a1-run');
    expect(out.recent_runs[1]).toMatchObject({ run_id: 'a2-12', agent_name: 'Two' });
  });

  it('has a null latest for an agent with cases but no completed run', () => {
    const out = toDashboard(agents, new Map([['agent-3', 2]]), []);
    expect(out.agents).toEqual([
      { agent_id: 'agent-3', name: 'Three', model: 'm', cases_total: 2, latest: null, trend: [] },
    ]);
  });
});

describe('runAllRefusal', () => {
  it.each(['run_in_flight', 'provider_not_configured', 'no_cases'] as const)(
    'AC35: %s maps to itself',
    (code) => {
      expect(runAllRefusal(code)).toBe(code);
    },
  );

  it.each(['conflict', 'not_found', 'bogus'])('AC35: the unrelated code %s maps to start_failed', (code) => {
    expect(runAllRefusal(code)).toBe('start_failed');
  });

  it('AC35: a missing code (a non-AppError) maps to start_failed', () => {
    expect(runAllRefusal(undefined)).toBe('start_failed');
  });
});
