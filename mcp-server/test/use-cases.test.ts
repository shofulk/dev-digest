import { describe, expect, it } from 'vitest';
import { getConventions, getFindings, listAgents, runAgentOnPr } from '../src/app/use-cases.js';
import { AgentDisabled, NoRun, ReviewMissing, RunNotFound } from '../src/domain/errors.js';
import { makeFakeApi } from './helpers/fake-api.js';

function fakeClock(start = 0) {
  let t = start;
  return { now: () => t, sleep: async (ms: number) => { t += ms; } };
}

const repos = [{ id: 'r1', name: 'foo', full_name: 'acme/foo' }];
const pulls = { r1: [{ id: 'p1', number: 42, title: 't' }] };

describe('listAgents', () => {
  it('truncates long descriptions to textMax', async () => {
    const api = makeFakeApi({ agents: [{ id: 'a1', name: 'A', description: 'x'.repeat(600), model: 'm', enabled: true }] });
    const { agents } = await listAgents(api, { textMax: 500 });
    expect(agents[0]!.description).toHaveLength(500);
    expect(agents[0]!.description.endsWith('…')).toBe(true);
  });

  it('returns enabled and disabled agents', async () => {
    const api = makeFakeApi({
      agents: [
        { id: 'a1', name: 'A', description: '', model: 'm', enabled: true },
        { id: 'a2', name: 'B', description: '', model: 'm', enabled: false },
      ],
    });
    const { agents } = await listAgents(api, { textMax: 500 });
    expect(agents.map((a) => a.enabled)).toEqual([true, false]);
  });

  it('strips fields beyond the concise shape even when the API row carries more (regression: live smoke found a spread leak)', async () => {
    const api = makeFakeApi({
      agents: [
        {
          id: 'a1',
          name: 'A',
          description: 'd',
          model: 'm',
          enabled: true,
          // Fields the real GET /agents row also carries — must never reach the tool response.
          ...({ system_prompt: 'secret prompt text', output_schema: {}, version: 3, strategy: 'x', ci_fail_on: 'CRITICAL', repo_intel: true, provider: 'openrouter' } as Record<string, unknown>),
        } as never,
      ],
    });
    const { agents } = await listAgents(api, { textMax: 500 });
    expect(Object.keys(agents[0]!).sort()).toEqual(['description', 'enabled', 'id', 'model', 'name']);
  });
});

describe('runAgentOnPr', () => {
  it('refuses a disabled agent before POSTing', async () => {
    const api = makeFakeApi({
      repos,
      pulls,
      agents: [{ id: 'a1', name: 'Reviewer', description: '', model: 'm', enabled: false }],
    });
    const clock = fakeClock();
    await expect(
      runAgentOnPr(api, { repo: 'acme/foo', pr: 42, agent: 'Reviewer' }, { deadlineAt: 100_000, pollMs: 3000, limit: 20, format: 'concise', textMax: 500, ...clock }),
    ).rejects.toBeInstanceOf(AgentDisabled);
    expect(api.calls.some((c) => c.method === 'triggerReview')).toBe(false);
  });

  it('returns done with verdict/score/findings on a run that finishes in time', async () => {
    const api = makeFakeApi({
      repos,
      pulls,
      agents: [{ id: 'a1', name: 'Reviewer', description: '', model: 'm', enabled: true }],
      triggerRun: { pr_id: 'p1', runs: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'Reviewer' }] },
      runs: { p1: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'Reviewer', status: 'done', error: null, ran_at: null }] },
      reviews: { p1: [{ id: 'rv1', run_id: 'run1', kind: 'review', verdict: 'approve', score: 90, findings: [] }] },
    });
    const clock = fakeClock();
    const result = await runAgentOnPr(
      api,
      { repo: 'acme/foo', pr: 42, agent: 'Reviewer' },
      { deadlineAt: 100_000, pollMs: 3000, limit: 20, format: 'concise', textMax: 500, ...clock },
    );
    expect(result).toMatchObject({ status: 'done', run_id: 'run1', agent: 'Reviewer', verdict: 'approve', score: 90 });
  });
});

describe('getFindings', () => {
  it('selects the run by run_id', async () => {
    const api = makeFakeApi({
      repos,
      pulls,
      runs: {
        p1: [
          { run_id: 'run2', agent_id: 'a2', agent_name: 'B', status: 'done', error: null, ran_at: '2' },
          { run_id: 'run1', agent_id: 'a1', agent_name: 'A', status: 'done', error: null, ran_at: '1' },
        ],
      },
      reviews: { p1: [{ id: 'rv1', run_id: 'run1', kind: 'review', verdict: 'approve', score: 70, findings: [] }] },
    });
    const result = await getFindings(api, { repo: 'acme/foo', pr: 42, runId: 'run1' }, { limit: 20, format: 'concise', textMax: 500 });
    expect(result.run_id).toBe('run1');
    expect(result.score).toBe(70);
  });

  it('selects the latest run of an agent while a newer run of another agent exists', async () => {
    const api = makeFakeApi({
      repos,
      pulls,
      agents: [{ id: 'a1', name: 'Reviewer', description: '', model: 'm', enabled: true }],
      runs: {
        p1: [
          { run_id: 'run2', agent_id: 'a2', agent_name: 'Other', status: 'done', error: null, ran_at: '2' },
          { run_id: 'run1', agent_id: 'a1', agent_name: 'Reviewer', status: 'done', error: null, ran_at: '1' },
        ],
      },
      reviews: { p1: [{ id: 'rv1', run_id: 'run1', kind: 'review', verdict: 'approve', score: 70, findings: [] }] },
    });
    const result = await getFindings(api, { repo: 'acme/foo', pr: 42, agent: 'Reviewer' }, { limit: 20, format: 'concise', textMax: 500 });
    expect(result.run_id).toBe('run1');
  });

  it('falls back to the latest run on the PR', async () => {
    const api = makeFakeApi({
      repos,
      pulls,
      runs: { p1: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'A', status: 'done', error: null, ran_at: '1' }] },
      reviews: { p1: [{ id: 'rv1', run_id: 'run1', kind: 'review', verdict: 'approve', score: 70, findings: [] }] },
    });
    const result = await getFindings(api, { repo: 'acme/foo', pr: 42 }, { limit: 20, format: 'concise', textMax: 500 });
    expect(result.run_id).toBe('run1');
  });

  it('reports no run with "call run_agent_on_pr" domain error', async () => {
    const api = makeFakeApi({ repos, pulls, runs: { p1: [] } });
    await expect(getFindings(api, { repo: 'acme/foo', pr: 42 }, { limit: 20, format: 'concise', textMax: 500 })).rejects.toBeInstanceOf(NoRun);
  });

  it('an explicit run_id absent from the PR throws RunNotFound', async () => {
    const api = makeFakeApi({ repos, pulls, runs: { p1: [{ run_id: 'other', agent_id: 'a1', agent_name: 'A', status: 'done', error: null, ran_at: '1' }] } });
    await expect(
      getFindings(api, { repo: 'acme/foo', pr: 42, runId: 'missing' }, { limit: 20, format: 'concise', textMax: 500 }),
    ).rejects.toBeInstanceOf(RunNotFound);
  });

  it('a running run is reported without sleeping (never polls)', async () => {
    const api = makeFakeApi({ repos, pulls, runs: { p1: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'A', status: 'running', error: null, ran_at: '1' }] } });
    const result = await getFindings(api, { repo: 'acme/foo', pr: 42 }, { limit: 20, format: 'concise', textMax: 500 });
    expect(result.status).toBe('running');
    expect(api.calls.filter((c) => c.method === 'listRuns')).toHaveLength(1);
  });

  it('done without a matching review throws ReviewMissing', async () => {
    const api = makeFakeApi({
      repos,
      pulls,
      runs: { p1: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'A', status: 'done', error: null, ran_at: '1' }] },
      reviews: { p1: [] },
    });
    await expect(getFindings(api, { repo: 'acme/foo', pr: 42 }, { limit: 20, format: 'concise', textMax: 500 })).rejects.toBeInstanceOf(ReviewMissing);
  });
});

describe('getConventions', () => {
  it('returns only accepted conventions, filtered by category', async () => {
    const api = makeFakeApi({
      repos,
      conventions: {
        r1: [
          { id: 'c1', category: 'naming', rule: 'r1', evidence_path: 'a.ts', evidence_line: 5, status: 'accepted' },
          { id: 'c2', category: 'testing', rule: 'r2', evidence_path: 'b.ts', status: 'accepted' },
          { id: 'c3', category: 'naming', rule: 'r3', evidence_path: 'c.ts', status: 'pending' },
        ],
      },
    });
    const result = await getConventions(api, { repo: 'acme/foo', category: 'naming' }, { textMax: 500 });
    expect(result.conventions).toEqual([{ category: 'naming', rule: 'r1', evidence: 'a.ts:5' }]);
    expect(result.total).toBe(1);
  });

  it('evidence is path alone when no line is given', async () => {
    const api = makeFakeApi({
      repos,
      conventions: { r1: [{ id: 'c1', category: 'testing', rule: 'r', evidence_path: 'b.ts', status: 'accepted' }] },
    });
    const result = await getConventions(api, { repo: 'acme/foo' }, { textMax: 500 });
    expect(result.conventions[0]!.evidence).toBe('b.ts');
  });

  it('truncates rule and the path part of evidence to textMax, keeping :line', async () => {
    const api = makeFakeApi({
      repos,
      conventions: {
        r1: [
          {
            id: 'c1',
            category: 'testing',
            rule: 'x'.repeat(600),
            evidence_path: 'y'.repeat(600),
            evidence_line: 5,
            status: 'accepted',
          },
        ],
      },
    });
    const result = await getConventions(api, { repo: 'acme/foo' }, { textMax: 500 });
    const c = result.conventions[0]!;
    expect(c.rule).toHaveLength(500);
    expect(c.rule.endsWith('…')).toBe(true);
    const [path, line] = c.evidence.split(':');
    expect(path).toHaveLength(500);
    expect(line).toBe('5');
  });
});
