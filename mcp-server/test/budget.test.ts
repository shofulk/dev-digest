// T15 (rev 4): proves the C4 budget through the MCP client — not by calling the domain
// helper directly — over fixtures deliberately oversized past RESPONSE_MAX_CHARS.
import { describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { makeFakeApi } from './helpers/fake-api.js';
import { connect } from './helpers/connect.js';
import type { Agent, ConventionCandidate, FindingRecord } from '../src/domain/contracts.js';

const repos = [{ id: 'r1', name: 'foo', full_name: 'acme/foo' }];
const pulls = { r1: [{ id: 'p1', number: 42, title: 't' }] };
const config = loadConfig({});

function bigFinding(i: number): FindingRecord {
  return {
    id: `f${i}`,
    severity: 'WARNING',
    category: 'style',
    title: 'T'.repeat(5000),
    file: 'F'.repeat(5000),
    start_line: 1,
    end_line: 1,
    rationale: 'R'.repeat(5000),
    suggestion: 'S'.repeat(5000),
    confidence: 0.9,
    dismissed_at: null,
  };
}

async function assertBudgeted(result: { content: unknown[]; structuredContent?: unknown }) {
  const text = (result.content[0] as { text: string }).text;
  expect(text.length).toBeLessThanOrEqual(config.responseMaxChars);
  expect(text).toBe(JSON.stringify(result.structuredContent));
  expect((result.structuredContent as { hint?: string }).hint).toBeTruthy();
}

describe('response budget through the MCP client (T15)', () => {
  it('get_findings detailed with 50 oversized findings stays under the budget', async () => {
    const findings = Array.from({ length: 50 }, (_, i) => bigFinding(i));
    const api = makeFakeApi({
      repos,
      pulls,
      runs: { p1: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'A', status: 'done', error: null, ran_at: '1' }] },
      reviews: { p1: [{ id: 'rv1', run_id: 'run1', kind: 'review', verdict: 'approve', score: 90, findings }] },
    });
    const server = createServer({ api, config });
    const client = await connect(server);
    const result = await client.callTool({
      name: 'get_findings',
      arguments: { repo: 'acme/foo', pr: 42, limit: 50, response_format: 'detailed' },
    });
    await assertBudgeted(result);
  });

  it('run_agent_on_pr (done) with 20 oversized concise findings stays under the budget', async () => {
    const findings = Array.from({ length: 20 }, (_, i) => bigFinding(i));
    const api = makeFakeApi({
      repos,
      pulls,
      agents: [{ id: 'a1', name: 'Reviewer', description: '', model: 'm', enabled: true }],
      triggerRun: { pr_id: 'p1', runs: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'Reviewer' }] },
      runs: { p1: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'Reviewer', status: 'done', error: null, ran_at: null }] },
      reviews: { p1: [{ id: 'rv1', run_id: 'run1', kind: 'review', verdict: 'approve', score: 90, findings }] },
    });
    const clock = { now: () => 0, sleep: async () => {} };
    const server = createServer({ api, config, clock });
    const client = await connect(server);
    const result = await client.callTool({ name: 'run_agent_on_pr', arguments: { repo: 'acme/foo', pr: 42, agent: 'Reviewer' } });
    await assertBudgeted(result);
  });

  it('list_agents with 60 oversized agents stays under the budget', async () => {
    const agents: Agent[] = Array.from({ length: 60 }, (_, i) => ({
      id: `a${i}`,
      name: `Agent ${i}`,
      description: 'D'.repeat(5000),
      model: 'm',
      enabled: true,
    }));
    const api = makeFakeApi({ agents });
    const server = createServer({ api, config });
    const client = await connect(server);
    const result = await client.callTool({ name: 'list_agents', arguments: {} });
    await assertBudgeted(result);
  });

  it('get_conventions with 60 oversized accepted conventions stays under the budget', async () => {
    const conventions: ConventionCandidate[] = Array.from({ length: 60 }, (_, i) => ({
      id: `c${i}`,
      category: 'naming',
      rule: 'R'.repeat(5000),
      evidence_path: 'P'.repeat(5000),
      evidence_line: 1,
      status: 'accepted',
    }));
    const api = makeFakeApi({ repos, conventions: { r1: conventions } });
    const server = createServer({ api, config });
    const client = await connect(server);
    const result = await client.callTool({ name: 'get_conventions', arguments: { repo: 'acme/foo' } });
    await assertBudgeted(result);
  });
});
