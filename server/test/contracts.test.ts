import { describe, it, expect } from 'vitest';
import {
  Review,
  Finding,
  Intent,
  BlastRadius,
  BlastDegradedReason,
  BlastRadiusResponse,
  Risks,
  PrHistory,
  SmartDiff,
  SmartDiffRole,
  Conformance,
  Onboarding,
  EvalRun,
  MemoryItem,
  RunTrace,
  Settings,
  Repo,
  PrDetail,
  EvalExpectation,
  EvalCaseCreated,
  EvalRunActualOutput,
  EvalSuiteRun,
  EvalSuiteRunDetail,
  EvalCompare,
  EvalCompareQuery,
  EvalDashboardOverview,
  EvalRunAllInput,
  EvalRunAllResult,
  EvalCaseMeta,
  EvalCaseView,
  EvalCaseFields,
  EvalCaseFromFindingInput,
  EvalCaseDraft,
  EvalCaseDraftResponse,
  EvalDryRunResult,
} from '@devdigest/shared';

/**
 * Contract tests — parse/round-trip the fixtures from data.jsx/data2.jsx
 * so feature agents can rely on the schemas matching the prototype data.
 */
describe('AI contracts parse fixtures', () => {
  it('Review + Finding (data.jsx VERDICT/FINDINGS)', () => {
    const review = Review.parse({
      verdict: 'request_changes',
      summary: 'Two blockers before merge.',
      score: 61,
      findings: [
        {
          id: 'f1',
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded Stripe secret key in commit',
          file: 'src/config.ts',
          start_line: 12,
          end_line: 12,
          rationale: 'Line 12 contains a literal `sk_live_` Stripe key.',
          suggestion: 'Move to env and rotate.',
          confidence: 0.98,
          kind: 'secret_leak',
        },
      ],
    });
    expect(review.findings).toHaveLength(1);
    expect(review.score).toBe(61);
  });

  it('lethal-trifecta Finding variant', () => {
    const f = Finding.parse({
      id: 'f2',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Lethal trifecta',
      file: 'src/api/public/webhooks.ts',
      start_line: 61,
      end_line: 74,
      rationale: 'all three legs present',
      confidence: 0.79,
      kind: 'lethal_trifecta',
      trifecta_components: ['private_data_access', 'untrusted_input', 'exfil_path'],
      evidence: [{ component: 'untrusted_input', file: 'src/api/public/webhooks.ts', line: 61 }],
    });
    expect(f.trifecta_components).toContain('exfil_path');
  });

  it('Intent / BlastRadius / Risks / PrHistory', () => {
    expect(() =>
      Intent.parse({ intent: 'x', in_scope: ['a'], out_of_scope: ['b'] }),
    ).not.toThrow();
    expect(() =>
      BlastRadius.parse({
        changed_symbols: [{ name: 'rateLimit', file: 'a.ts', kind: 'function' }],
        downstream: [
          {
            symbol: 'rateLimit',
            callers: [{ name: 'publicRouter', file: 'b.ts', line: 23 }],
            endpoints_affected: ['GET /x'],
            crons_affected: ['c'],
          },
        ],
        summary: 's',
      }),
    ).not.toThrow();
    expect(() =>
      Risks.parse({
        risks: [{ kind: 'auth_surface', title: 't', explanation: 'e', severity: 'high', file_refs: [] }],
      }),
    ).not.toThrow();
    expect(() =>
      PrHistory.parse({
        history: [
          {
            pr_number: 401,
            title: 't',
            merged_at: '2026-03-18',
            author: 'a',
            files_overlap: [],
            notes: 'n',
          },
        ],
      }),
    ).not.toThrow();
  });

  it('SmartDiff (data.jsx DIFF)', () => {
    const d = SmartDiff.parse({
      groups: [
        {
          role: 'core',
          files: [{ path: 'a.ts', additions: 84, deletions: 0, finding_lines: [28, 52] }],
        },
      ],
      split_suggestion: { too_big: false, total_lines: 285, proposed_splits: [] },
    });
    expect(d.groups[0]!.role).toBe('core');
  });

  it('SmartDiffRole (T6) parses the new roles and rejects an unknown one', () => {
    expect(SmartDiffRole.parse('tests')).toBe('tests');
    expect(SmartDiffRole.parse('docs')).toBe('docs');
    expect(() => SmartDiffRole.parse('misc')).toThrow();
  });

  it('BlastRadius (T1) accepts legacy documents, accepts the new fields and rejects invalid ones', () => {
    // A legacy document with only the original keys (no depth/via/degraded/reason/limits) still parses.
    expect(() =>
      BlastRadius.parse({
        changed_symbols: [{ name: 'rateLimit', file: 'a.ts', kind: 'function' }],
        downstream: [
          {
            symbol: 'rateLimit',
            callers: [{ name: 'publicRouter', file: 'b.ts', line: 23 }],
            endpoints_affected: ['GET /x'],
            crons_affected: ['c'],
          },
        ],
        summary: 's',
      }),
    ).not.toThrow();

    expect(() =>
      BlastRadius.parse({
        changed_symbols: [],
        downstream: [
          {
            symbol: 'handle',
            callers: [{ name: 'route', file: 'c.ts', line: 30, depth: 2, via: 'handle' }],
            endpoints_affected: [],
            crons_affected: [],
          },
        ],
        summary: 's',
        degraded: true,
        reason: 'index_partial',
        limits: { max_callers_per_symbol: 20, bfs_depth: 2 },
      }),
    ).not.toThrow();

    expect(() => BlastRadius.parse({ changed_symbols: [], downstream: [], summary: 's', reason: 'bogus' })).toThrow();

    expect(() =>
      BlastRadius.parse({
        changed_symbols: [],
        downstream: [
          {
            symbol: 'h',
            callers: [{ name: 'r', file: 'c.ts', line: 1, depth: 3 }],
            endpoints_affected: [],
            crons_affected: [],
          },
        ],
        summary: 's',
      }),
    ).toThrow();

    expect(BlastDegradedReason.options).toEqual([
      'flag_off',
      'index_failed',
      'index_partial',
      'repo_too_large',
      'no_data',
    ]);

    expect(() =>
      BlastRadiusResponse.parse({
        changed_symbols: [{ name: 'rateLimit', file: 'a.ts', kind: 'function' }],
        downstream: [
          {
            symbol: 'rateLimit',
            callers: [{ name: 'publicRouter', file: 'b.ts', line: 23 }],
            endpoints_affected: ['GET /x'],
            crons_affected: ['c'],
          },
        ],
        summary: 's',
      }),
    ).not.toThrow();
  });

  it('BlastRadius.indexed_sha (T15) parses, nulls, defaults and rejects a non-string', () => {
    const base = {
      changed_symbols: [] as unknown[],
      downstream: [] as unknown[],
      summary: 's',
    };

    const withSha = BlastRadius.parse({ ...base, indexed_sha: 'c6af1e4' });
    expect(withSha.indexed_sha).toBe('c6af1e4');

    const withNull = BlastRadius.parse({ ...base, indexed_sha: null });
    expect(withNull.indexed_sha).toBeNull();

    const legacy = BlastRadius.parse(base);
    expect(legacy.indexed_sha).toBeUndefined();

    expect(() => BlastRadius.parse({ ...base, indexed_sha: 42 })).toThrow();

    const response = BlastRadiusResponse.parse({ ...base, indexed_sha: 'c6af1e4' });
    expect(response.indexed_sha).toBe('c6af1e4');
  });

  it('Conformance / Onboarding / EvalRun / MemoryItem', () => {
    expect(() =>
      Conformance.parse({
        spec_id: 's1',
        spec_title: 'Spec',
        items: [{ requirement: 'r', status: 'implemented' }],
        completeness_pct: 80,
      }),
    ).not.toThrow();
    expect(() =>
      Onboarding.parse({
        sections: [{ kind: 'architecture', title: 'T', body: 'b', links: [] }],
      }),
    ).not.toThrow();
    expect(() =>
      EvalRun.parse({
        recall: 0.82,
        precision: 0.91,
        citation_accuracy: 0.95,
        traces_passed: 17,
        traces_total: 20,
        duration_ms: 12000,
        cost_usd: 0.23,
        per_trace: [{ name: 't01', pass: true, expected: 'x', actual: 'x' }],
      }),
    ).not.toThrow();
    expect(() =>
      MemoryItem.parse({
        content: 'c',
        scope: 'team',
        kind: 'decision',
        confidence: 0.92,
        sources: [{ pr: 401, context: 'ctx' }],
      }),
    ).not.toThrow();
  });

  it('RunTrace (data2.jsx TRACE single-document)', () => {
    const trace = RunTrace.parse({
      config: { agent: 'Security Reviewer', version: 'v7', model: 'gpt-4.1', pr: 482, source: 'local' },
      stats: { duration_ms: 8200, tokens_in: 14820, tokens_out: 1240, cost_usd: 0.06, findings: 3, grounding: '3/3 passed' },
      prompt_assembly: { system: 's', user: 'u' },
      tool_calls: [{ tool: 'read_file', args: "'src/config.ts'", meta: '1,240 bytes', ms: 120 }],
      raw_output: '{}',
      memory_pulled: [{ pr: 288, text: 'verified via stripe-signature' }],
      specs_read: ['specs/security-baseline.md'],
      log: [{ t: '00.00', kind: 'info', msg: 'started' }],
    });
    expect(trace.tool_calls).toHaveLength(1);
  });
});

describe('platform DTOs', () => {
  it('Settings defaults + passthrough', () => {
    const s = Settings.parse({ extra_key: 'x' });
    expect(s.theme).toBe('dark');
    expect((s as Record<string, unknown>).extra_key).toBe('x');
  });

  it('Repo + PrDetail', () => {
    expect(() =>
      Repo.parse({
        id: 'r1',
        workspace_id: 'w1',
        owner: 'acme',
        name: 'payments-api',
        full_name: 'acme/payments-api',
        default_branch: 'main',
        clone_path: null,
        last_polled_at: null,
        created_by: null,
      }),
    ).not.toThrow();
    expect(() =>
      PrDetail.parse({
        number: 482,
        title: 't',
        author: 'a',
        branch: 'b',
        base: 'main',
        head_sha: 'sha',
        additions: 1,
        deletions: 0,
        files_count: 1,
        status: 'open',
        files: [],
        commits: [],
      }),
    ).not.toThrow();
  });
});

describe('eval pipeline contracts', () => {
  const expectation = {
    type: 'must_find',
    file: 'src/a.ts',
    start_line: 10,
    end_line: 12,
    severity: 'WARNING',
    category: 'bug',
    title: 'Off by one',
  };
  const run = {
    run_id: '11111111-1111-4111-8111-111111111111',
    agent_id: 'ag1',
    status: 'completed',
    agent_version: 2,
    started_at: '2026-10-11T10:00:00.000Z',
    finished_at: '2026-10-11T10:01:00.000Z',
    cases_total: 3,
    cases_done: 3,
    recall: 0.5,
    precision: null,
    citation_accuracy: 1,
    traces_passed: 1,
    traces_total: 3,
    cases_errored: 0,
    duration_ms: 1200,
    cost_usd: null,
  };

  it('EvalRunActualOutput parses a minimal pending document and a full completed one', () => {
    expect(() =>
      EvalRunActualOutput.parse({ run_id: 'r', agent_id: 'a', agent_version: 1, status: 'pending' }),
    ).not.toThrow();
    const full = EvalRunActualOutput.parse({
      run_id: 'r',
      agent_id: 'a',
      agent_version: 1,
      status: 'completed',
      findings: [
        {
          file: 'src/a.ts',
          start_line: 10,
          end_line: 11,
          severity: 'CRITICAL',
          category: 'security',
          title: 't',
        },
      ],
      grounding_kept: 1,
      grounding_dropped: 2,
      finished_at: '2026-10-11T10:01:00.000Z',
    });
    expect(full.grounding_dropped).toBe(2);
  });

  it('rev-6 case-editor contracts: nullish jsonb fields, required running, new shapes', () => {
    expect(EvalCaseMeta.safeParse({}).success).toBe(true);
    const out = EvalRunActualOutput.parse({
      run_id: 'r',
      agent_id: 'a',
      agent_version: 1,
      status: 'pending',
    });
    expect(out.one_case).toBeUndefined();
    expect(out.expectation).toBeUndefined();
    expect(EvalRunActualOutput.safeParse({ ...out, one_case: true, expectation }).success).toBe(true);
    const view = {
      case: { id: 'c1', owner_kind: 'agent', owner_id: 'ag1', name: 'n', input_diff: '', input_files: null, input_meta: null, expected_output: expectation },
      expectation,
      last_result: 'never_run',
    };
    expect(EvalCaseView.safeParse(view).success).toBe(false);
    expect(EvalCaseView.safeParse({ ...view, running: false }).success).toBe(true);
    const fields = { name: '', input_diff: '', expectation };
    expect(EvalCaseFields.safeParse(fields).success).toBe(true);
    const { type: _type, ...noType } = expectation;
    expect(EvalCaseFromFindingInput.safeParse({ name: 'n', expectation: noType }).success).toBe(true);
    expect(EvalCaseDraftResponse.safeParse({ agent_id: 'a', existing_case: null, draft: null }).success).toBe(true);
    const draft = { name: 'n', input_diff: 'd', input_files: [], pr_title: null, pr_body: null, expectation, notes: null };
    expect(EvalCaseDraft.safeParse(draft).success).toBe(true);
    expect(
      EvalDryRunResult.safeParse({
        pass: true,
        findings: [],
        grounding_kept: 0,
        grounding_dropped: 0,
        cost_usd: null,
        duration_ms: 1,
        agent_version: 1,
      }).success,
    ).toBe(true);
  });

  it('rev-6 T33: null source id, bogus type, missing expectation, omitted keys, draft response, dry-run matched', () => {
    expect(EvalCaseMeta.safeParse({ source_finding_id: null }).success).toBe(true);
    expect(EvalCaseFields.safeParse({ name: 'n', input_diff: 'd', expectation: { ...expectation, type: 'bogus' } }).success).toBe(false);
    expect(EvalCaseFields.safeParse({ name: 'n', input_diff: 'd' }).success).toBe(false);

    const { type: _t, ...noType } = expectation;
    const parsed = EvalCaseFromFindingInput.parse({ name: 'n', input_diff: 'd', expectation: { ...noType, type: 'must_find' } });
    expect(parsed).not.toHaveProperty('input_diff');
    expect(parsed.expectation).not.toHaveProperty('type');

    const existing = {
      id: 'c1',
      owner_kind: 'agent',
      owner_id: 'ag1',
      name: 'n',
      input_diff: 'd',
      input_files: null,
      input_meta: null,
      expected_output: expectation,
    };
    const draft = { name: 'n', input_diff: 'd', input_files: [], pr_title: null, pr_body: null, expectation, notes: null };
    expect(EvalCaseDraftResponse.safeParse({ agent_id: 'a', existing_case: null, draft }).success).toBe(true);
    expect(EvalCaseDraftResponse.safeParse({ agent_id: 'a', existing_case: existing, draft: null }).success).toBe(true);

    const finding = { file: 'src/a.ts', start_line: 1, end_line: 2, severity: 'CRITICAL', category: 'security', title: 't' };
    const dry = { pass: true, grounding_kept: 1, grounding_dropped: 0, cost_usd: null, duration_ms: 1, agent_version: 1 };
    expect(EvalDryRunResult.safeParse({ ...dry, findings: [{ ...finding, matched: true }] }).success).toBe(true);
    expect(EvalDryRunResult.safeParse({ ...dry, findings: [finding] }).success).toBe(false);
  });

  it('EvalExpectation rejects an unknown type; EvalCaseCreated requires created', () => {
    expect(EvalExpectation.safeParse({ ...expectation, type: 'bogus' }).success).toBe(false);
    expect(EvalExpectation.safeParse(expectation).success).toBe(true);
    const base = {
      id: 'c1',
      owner_kind: 'agent',
      owner_id: 'ag1',
      name: 'n',
      input_diff: 'd',
      input_files: ['src/a.ts'],
      input_meta: {},
      expected_output: expectation,
    };
    expect(EvalCaseCreated.safeParse(base).success).toBe(false);
    expect(EvalCaseCreated.safeParse({ ...base, created: true }).success).toBe(true);
  });

  it('EvalSuiteRun / EvalSuiteRunDetail parse, and metrics stay within 0..1', () => {
    expect(EvalSuiteRun.safeParse(run).success).toBe(true);
    expect(EvalSuiteRun.safeParse({ ...run, recall: 1.5 }).success).toBe(false);
    const detail = EvalSuiteRunDetail.parse({
      ...run,
      per_case: [
        {
          case_id: 'c1',
          name: 'n',
          expectation,
          status: 'completed',
          pass: true,
          findings: [
            {
              file: 'src/a.ts',
              start_line: 10,
              end_line: 12,
              severity: 'WARNING',
              category: 'bug',
              title: 't',
              matched: true,
            },
          ],
          grounding_kept: 1,
          grounding_dropped: 0,
          duration_ms: 10,
          cost_usd: 0.01,
        },
      ],
    });
    expect(detail.per_case[0]!.findings[0]!.matched).toBe(true);
  });

  it('EvalCompare parses prompt_diff ops and rejects an unknown op', () => {
    const compare = {
      a: run,
      b: { ...run, run_id: '22222222-2222-4222-8222-222222222222', agent_version: 3 },
      delta: { recall: 0.1, precision: null, citation_accuracy: 0, cost_usd: null },
      flips: [{ case_id: 'c1', name: 'n', a_pass: true, b_pass: false, direction: 'pass_to_fail' }],
      only_in_a: [],
      only_in_b: [{ case_id: 'c9', name: 'new' }],
      prompt_diff: [
        { op: 'same', text: 'x' },
        { op: 'add', text: 'y' },
        { op: 'del', text: 'z' },
      ],
      prompt_available: true,
    };
    expect(EvalCompare.safeParse(compare).success).toBe(true);
    expect(
      EvalCompare.safeParse({ ...compare, prompt_diff: [{ op: 'mod', text: 'x' }] }).success,
    ).toBe(false);
  });

  it('EvalDashboardOverview parses; EvalCompareQuery rejects a non-uuid', () => {
    expect(
      EvalDashboardOverview.safeParse({
        agents: [
          {
            agent_id: 'ag1',
            name: 'A',
            model: 'm',
            cases_total: 3,
            latest: run,
            trend: [{ run_id: 'r', started_at: '2026-10-11T10:00:00.000Z', recall: 1, precision: null }],
          },
        ],
        recent_runs: [{ ...run, agent_name: 'A' }],
      }).success,
    ).toBe(true);
    const id = '11111111-1111-4111-8111-111111111111';
    expect(EvalCompareQuery.safeParse({ a: id, b: id }).success).toBe(true);
    expect(EvalCompareQuery.safeParse({ a: 'nope', b: id }).success).toBe(false);
  });

  it('EvalRunAllInput requires confirm: true; EvalRunAllResult parses started and refused entries', () => {
    expect(EvalRunAllInput.safeParse({ confirm: true }).success).toBe(true);
    expect(EvalRunAllInput.safeParse({ confirm: false }).success).toBe(false);
    expect(EvalRunAllInput.safeParse({}).success).toBe(false);
    const id = '11111111-1111-4111-8111-111111111111';
    const started = { agent_id: 'ag1', agent_name: 'X', run_id: id, refused_reason: null };
    const refused = { agent_id: 'ag2', agent_name: 'Y', run_id: null, refused_reason: 'run_in_flight' };
    expect(EvalRunAllResult.safeParse({ started: [started, refused] }).success).toBe(true);
    expect(
      EvalRunAllResult.safeParse({ started: [{ ...refused, refused_reason: 'bogus' }] }).success,
    ).toBe(false);
    expect(EvalRunAllResult.safeParse({ started: [{ ...started, run_id: 'nope' }] }).success).toBe(false);
  });
});
