import { describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { makeFakeApi } from './helpers/fake-api.js';
import { connect } from './helpers/connect.js';

const repos = [{ id: 'r1', name: 'foo', full_name: 'acme/foo' }];
const pulls = { r1: [{ id: 'p1', number: 42, title: 't' }] };

describe('get_findings via MCP', () => {
  it('selects by run_id', async () => {
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
    const server = createServer({ api, config: loadConfig({}) });
    const client = await connect(server);
    const result = await client.callTool({ name: 'get_findings', arguments: { repo: 'acme/foo', pr: 42, run_id: 'run1' } });
    expect(result.structuredContent).toMatchObject({ run_id: 'run1', score: 70 });
  });

  it('selects by agent (latest of that agent) while a newer run of another agent exists', async () => {
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
    const server = createServer({ api, config: loadConfig({}) });
    const client = await connect(server);
    const result = await client.callTool({ name: 'get_findings', arguments: { repo: 'acme/foo', pr: 42, agent: 'Reviewer' } });
    expect(result.structuredContent).toMatchObject({ run_id: 'run1' });
  });

  it('falls back to the latest run on the PR', async () => {
    const api = makeFakeApi({
      repos,
      pulls,
      runs: { p1: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'A', status: 'done', error: null, ran_at: '1' }] },
      reviews: { p1: [{ id: 'rv1', run_id: 'run1', kind: 'review', verdict: 'approve', score: 70, findings: [] }] },
    });
    const server = createServer({ api, config: loadConfig({}) });
    const client = await connect(server);
    const result = await client.callTool({ name: 'get_findings', arguments: { repo: 'acme/foo', pr: 42 } });
    expect(result.structuredContent).toMatchObject({ run_id: 'run1' });
  });

  it('limit: 51 is rejected by the schema', async () => {
    const api = makeFakeApi({ repos, pulls });
    const server = createServer({ api, config: loadConfig({}) });
    const client = await connect(server);
    const result = await client.callTool({ name: 'get_findings', arguments: { repo: 'acme/foo', pr: 42, limit: 51 } });
    expect(result.isError).toBe(true);
  });

  it('no runs on the PR says to call run_agent_on_pr', async () => {
    const api = makeFakeApi({ repos, pulls, runs: { p1: [] } });
    const server = createServer({ api, config: loadConfig({}) });
    const client = await connect(server);
    const result = await client.callTool({ name: 'get_findings', arguments: { repo: 'acme/foo', pr: 42 } });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('run_agent_on_pr');
  });

  it('a running run is reported without sleeping', async () => {
    const api = makeFakeApi({ repos, pulls, runs: { p1: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'A', status: 'running', error: null, ran_at: '1' }] } });
    const server = createServer({ api, config: loadConfig({}) });
    const client = await connect(server);
    const start = Date.now();
    const result = await client.callTool({ name: 'get_findings', arguments: { repo: 'acme/foo', pr: 42 } });
    expect(Date.now() - start).toBeLessThan(1000);
    expect(result.structuredContent).toMatchObject({ status: 'running' });
  });

  it('has the same result shape as run_agent_on_pr for the same done run (T8, rev 4)', async () => {
    const finding = {
      id: 'f1',
      severity: 'WARNING' as const,
      category: 'style',
      title: 't',
      file: 'a.ts',
      start_line: 1,
      end_line: 1,
      rationale: 'because',
      suggestion: null,
      confidence: 0.9,
      dismissed_at: null,
    };
    const api = makeFakeApi({
      repos,
      pulls,
      agents: [{ id: 'a1', name: 'Reviewer', description: '', model: 'm', enabled: true }],
      triggerRun: { pr_id: 'p1', runs: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'Reviewer' }] },
      runs: { p1: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'Reviewer', status: 'done', error: null, ran_at: null }] },
      reviews: { p1: [{ id: 'rv1', run_id: 'run1', kind: 'review', verdict: 'approve', score: 90, findings: [finding] }] },
    });
    const clock = { now: () => 0, sleep: async () => {} };

    const viaRun = createServer({ api, config: loadConfig({}), clock });
    const runClient = await connect(viaRun);
    const runResult = await runClient.callTool({ name: 'run_agent_on_pr', arguments: { repo: 'acme/foo', pr: 42, agent: 'Reviewer' } });

    const viaFindings = createServer({ api, config: loadConfig({}) });
    const findingsClient = await connect(viaFindings);
    const findingsResult = await findingsClient.callTool({ name: 'get_findings', arguments: { repo: 'acme/foo', pr: 42 } });

    const runKeys = Object.keys(runResult.structuredContent as Record<string, unknown>).sort();
    const findingsKeys = Object.keys(findingsResult.structuredContent as Record<string, unknown>).sort();
    expect(runKeys).toEqual(findingsKeys);

    const runFinding = (runResult.structuredContent as { findings: Record<string, unknown>[] }).findings[0]!;
    const findingsFinding = (findingsResult.structuredContent as { findings: Record<string, unknown>[] }).findings[0]!;
    expect(Object.keys(runFinding).sort()).toEqual(Object.keys(findingsFinding).sort());
  });
});
