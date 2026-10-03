import { describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { makeFakeApi } from './helpers/fake-api.js';
import { connect } from './helpers/connect.js';

const repos = [{ id: 'r1', name: 'foo', full_name: 'acme/foo' }];
const pulls = { r1: [{ id: 'p1', number: 42, title: 't' }] };

function fakeClock(start = 0) {
  let t = start;
  return { now: () => t, sleep: async (ms: number) => { t += ms; } };
}

describe('run_agent_on_pr via MCP', () => {
  it('happy path: done with verdict/score/findings', async () => {
    const api = makeFakeApi({
      repos,
      pulls,
      agents: [{ id: 'a1', name: 'Reviewer', description: '', model: 'm', enabled: true }],
      triggerRun: { pr_id: 'p1', runs: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'Reviewer' }] },
      runs: { p1: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'Reviewer', status: 'done', error: null, ran_at: null }] },
      reviews: { p1: [{ id: 'rv1', run_id: 'run1', kind: 'review', verdict: 'approve', score: 90, findings: [] }] },
    });
    const server = createServer({ api, config: loadConfig({}), clock: fakeClock() });
    const client = await connect(server);
    const result = await client.callTool({ name: 'run_agent_on_pr', arguments: { repo: 'acme/foo', pr: 42, agent: 'Reviewer' } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ status: 'done', verdict: 'approve', score: 90 });
  });

  it('the timeout hint names get_findings', async () => {
    const api = makeFakeApi({
      repos,
      pulls,
      agents: [{ id: 'a1', name: 'Reviewer', description: '', model: 'm', enabled: true }],
      triggerRun: { pr_id: 'p1', runs: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'Reviewer' }] },
      runs: { p1: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'Reviewer', status: 'running', error: null, ran_at: null }] },
    });
    const config = { ...loadConfig({}), runWaitMs: 0 };
    const server = createServer({ api, config, clock: fakeClock() });
    const client = await connect(server);
    const result = await client.callTool({ name: 'run_agent_on_pr', arguments: { repo: 'acme/foo', pr: 42, agent: 'Reviewer' } });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as { status: string; hint?: string };
    expect(structured.status).toBe('running');
    expect(structured.hint).toContain('get_findings');
  });

  it('a disabled agent is refused before any POST', async () => {
    const api = makeFakeApi({
      repos,
      pulls,
      agents: [{ id: 'a1', name: 'Reviewer', description: '', model: 'm', enabled: false }],
    });
    const server = createServer({ api, config: loadConfig({}), clock: fakeClock() });
    const client = await connect(server);
    const result = await client.callTool({ name: 'run_agent_on_pr', arguments: { repo: 'acme/foo', pr: 42, agent: 'Reviewer' } });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('enable');
    expect(api.calls.some((c) => c.method === 'triggerReview')).toBe(false);
  });

  it('a 429 says to retry in a minute', async () => {
    const api = makeFakeApi({ repos, pulls, unreachableAt: undefined });
    api.listAgents = async () => {
      throw new (await import('../src/domain/errors.js')).RateLimited('http://api.test/agents');
    };
    const server = createServer({ api, config: loadConfig({}), clock: fakeClock() });
    const client = await connect(server);
    const result = await client.callTool({ name: 'run_agent_on_pr', arguments: { repo: 'acme/foo', pr: 42, agent: 'Reviewer' } });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/retry in a minute/);
  });

  it('an unreachable API names the URL and ./scripts/dev.sh', async () => {
    const api = makeFakeApi({ unreachableAt: 'http://api.test/agents' });
    const server = createServer({ api, config: loadConfig({}), clock: fakeClock() });
    const client = await connect(server);
    const result = await client.callTool({ name: 'run_agent_on_pr', arguments: { repo: 'acme/foo', pr: 42, agent: 'Reviewer' } });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('http://api.test/agents');
    expect(text).toContain('./scripts/dev.sh');
  });

  it('unknown repo/pr/agent give their forward-leading texts', async () => {
    // rev 4: the unknown-repo case needs >= 2 repos so the forward text's "known repos"
    // list is actually asserted, not merely present.
    const twoRepos = [
      { id: 'r1', name: 'foo', full_name: 'acme/foo' },
      { id: 'r2', name: 'bar', full_name: 'acme/bar' },
    ];
    const server = createServer({ api: makeFakeApi({ repos: twoRepos, agents: [] }), config: loadConfig({}), clock: fakeClock() });
    const client = await connect(server);

    const badRepo = await client.callTool({ name: 'run_agent_on_pr', arguments: { repo: 'nope/nope', pr: 1, agent: 'x' } });
    const badRepoText = (badRepo.content[0] as { text: string }).text;
    expect(badRepoText).toMatch(/not found/);
    expect(badRepoText).toContain('acme/foo');
    expect(badRepoText).toContain('acme/bar');

    const server2 = createServer({ api: makeFakeApi({ repos, pulls: { r1: [] }, agents: [] }), config: loadConfig({}), clock: fakeClock() });
    const client2 = await connect(server2);
    const badPr = await client2.callTool({ name: 'run_agent_on_pr', arguments: { repo: 'acme/foo', pr: 999, agent: 'x' } });
    expect((badPr.content[0] as { text: string }).text).toMatch(/not imported/);

    const server3 = createServer({ api: makeFakeApi({ repos, pulls, agents: [] }), config: loadConfig({}), clock: fakeClock() });
    const client3 = await connect(server3);
    const badAgent = await client3.callTool({ name: 'run_agent_on_pr', arguments: { repo: 'acme/foo', pr: 42, agent: 'nope' } });
    expect((badAgent.content[0] as { text: string }).text).toMatch(/list_agents/);
  });

  it('the deadline counts from handler start (C6): a slow listPulls cannot buy extra time', async () => {
    let t = 0;
    const clock = { now: () => t, sleep: async (ms: number) => { t += ms; } };
    const config = { ...loadConfig({}), runWaitMs: 100_000, pollMs: 3_000 };
    const api = makeFakeApi({
      repos,
      pulls,
      agents: [{ id: 'a1', name: 'Reviewer', description: '', model: 'm', enabled: true }],
      triggerRun: { pr_id: 'p1', runs: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'Reviewer' }] },
      runs: { p1: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'Reviewer', status: 'running', error: null, ran_at: null }] },
    });
    const originalListPulls = api.listPulls.bind(api);
    // Simulates a slow GET /repos/:id/pulls GitHub sync that eats the entire deadline —
    // the deadline must already be fixed before this call, not reset after it.
    api.listPulls = async (repoId: string) => {
      t += config.runWaitMs;
      return originalListPulls(repoId);
    };
    const server = createServer({ api, config, clock });
    const client = await connect(server);
    const result = await client.callTool({ name: 'run_agent_on_pr', arguments: { repo: 'acme/foo', pr: 42, agent: 'Reviewer' } });
    const structured = result.structuredContent as { status: string; run_id: string; hint?: string };
    expect(structured.status).toBe('running');
    expect(structured.run_id).toBe('run1');
    expect(structured.hint).toContain('get_findings');
    expect(api.calls.filter((c) => c.method === 'triggerReview')).toHaveLength(1);
    expect(api.calls.filter((c) => c.method === 'listRuns')).toHaveLength(0);
  });
});
