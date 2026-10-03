// T17: every free-text field is truncated to TEXT_FIELD_MAX, proved through MCP (rev 4);
// rev 5 extends this to text *echoed into errors and hints* — an ApiFailure detail, a long
// tool argument reflected into a "not found" message, and the repo/agent echoed into
// run_agent_on_pr's "still running" hint.
import { describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { ApiFailure } from '../src/domain/errors.js';
import { makeFakeApi } from './helpers/fake-api.js';
import { connect } from './helpers/connect.js';

const repos = [{ id: 'r1', name: 'foo', full_name: 'acme/foo' }];
const pulls = { r1: [{ id: 'p1', number: 42, title: 't' }] };
const config = loadConfig({});

describe('free-text truncation through MCP (T17)', () => {
  it('get_findings detailed truncates title, rationale, suggestion and the file part of location', async () => {
    const api = makeFakeApi({
      repos,
      pulls,
      runs: { p1: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'A', status: 'done', error: null, ran_at: '1' }] },
      reviews: {
        p1: [
          {
            id: 'rv1',
            run_id: 'run1',
            kind: 'review',
            verdict: 'approve',
            score: 90,
            findings: [
              {
                id: 'f1',
                severity: 'WARNING',
                category: 'style',
                title: 'T'.repeat(600),
                file: 'F'.repeat(600),
                start_line: 1,
                end_line: 1,
                rationale: 'R'.repeat(600),
                suggestion: 'S'.repeat(600),
                confidence: 0.9,
                dismissed_at: null,
              },
            ],
          },
        ],
      },
    });
    const server = createServer({ api, config });
    const client = await connect(server);
    const result = await client.callTool({ name: 'get_findings', arguments: { repo: 'acme/foo', pr: 42, response_format: 'detailed' } });
    const finding = (result.structuredContent as { findings: { title: string; location: string; rationale: string; suggestion: string }[] })
      .findings[0]!;
    expect(finding.title.length).toBeLessThanOrEqual(config.textFieldMax);
    expect(finding.title.endsWith('…')).toBe(true);
    expect(finding.rationale.length).toBeLessThanOrEqual(config.textFieldMax);
    expect(finding.rationale.endsWith('…')).toBe(true);
    expect(finding.suggestion.length).toBeLessThanOrEqual(config.textFieldMax);
    expect(finding.suggestion.endsWith('…')).toBe(true);
    const filePart = finding.location.split(':')[0]!;
    expect(filePart.length).toBeLessThanOrEqual(config.textFieldMax);
  });

  it('get_findings on a failed run truncates a long error', async () => {
    const api = makeFakeApi({
      repos,
      pulls,
      runs: { p1: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'A', status: 'failed', error: 'E'.repeat(5000), ran_at: '1' }] },
    });
    const server = createServer({ api, config });
    const client = await connect(server);
    const result = await client.callTool({ name: 'get_findings', arguments: { repo: 'acme/foo', pr: 42 } });
    const { error } = result.structuredContent as { error: string };
    expect(error.length).toBeLessThanOrEqual(config.textFieldMax);
    expect(error.endsWith('…')).toBe(true);
  });

  it('get_conventions truncates rule and the path part of evidence, keeping :line', async () => {
    const api = makeFakeApi({
      repos,
      conventions: {
        r1: [
          {
            id: 'c1',
            category: 'naming',
            rule: 'R'.repeat(600),
            evidence_path: 'P'.repeat(600),
            evidence_line: 7,
            status: 'accepted',
          },
        ],
      },
    });
    const server = createServer({ api, config });
    const client = await connect(server);
    const result = await client.callTool({ name: 'get_conventions', arguments: { repo: 'acme/foo' } });
    const convention = (result.structuredContent as { conventions: { rule: string; evidence: string }[] }).conventions[0]!;
    expect(convention.rule.length).toBeLessThanOrEqual(config.textFieldMax);
    expect(convention.rule.endsWith('…')).toBe(true);
    const [path, line] = convention.evidence.split(':');
    expect(path!.length).toBeLessThanOrEqual(config.textFieldMax);
    expect(line).toBe('7');
  });

  it('list_agents truncates description (also covered by T2; asserted here for completeness)', async () => {
    const api = makeFakeApi({ agents: [{ id: 'a1', name: 'A', description: 'D'.repeat(600), model: 'm', enabled: true }] });
    const server = createServer({ api, config });
    const client = await connect(server);
    const result = await client.callTool({ name: 'list_agents', arguments: {} });
    const agent = (result.structuredContent as { agents: { description: string }[] }).agents[0]!;
    expect(agent.description.length).toBeLessThanOrEqual(config.textFieldMax);
    expect(agent.description.endsWith('…')).toBe(true);
  });

  // rev 5 — echoed text in errors and hints (R14).
  it('an ApiFailure detail echoed into an error text is clipped, not raw', async () => {
    const api = makeFakeApi({});
    api.listAgents = async () => {
      throw new ApiFailure(500, 'http://api.test/agents', 'd'.repeat(5000));
    };
    const server = createServer({ api, config });
    const client = await connect(server);
    const result = await client.callTool({ name: 'list_agents', arguments: {} });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).not.toContain('d'.repeat(config.textFieldMax + 1));
    expect(text).toContain('…');
  });

  it('get_findings with a 5,000-char repo argument does not echo it raw in RepoNotFound', async () => {
    const api = makeFakeApi({ repos });
    const server = createServer({ api, config });
    const client = await connect(server);
    const bigRepo = 'r'.repeat(5000);
    const result = await client.callTool({ name: 'get_findings', arguments: { repo: bigRepo, pr: 42 } });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).not.toContain('r'.repeat(config.textFieldMax + 1));
  });

  it('run_agent_on_pr past the deadline echoes a long repo/agent into the running hint, clipped', async () => {
    const bigRepoName = 'x'.repeat(5000);
    const bigAgentName = 'y'.repeat(5000);
    const bigRepos = [{ id: 'r1', name: 'foo', full_name: bigRepoName }];
    const bigPulls = { r1: [{ id: 'p1', number: 42, title: 't' }] };
    const api = makeFakeApi({
      repos: bigRepos,
      pulls: bigPulls,
      agents: [{ id: 'a1', name: bigAgentName, description: '', model: 'm', enabled: true }],
      triggerRun: { pr_id: 'p1', runs: [{ run_id: 'run1', agent_id: 'a1', agent_name: bigAgentName }] },
      runs: { p1: [{ run_id: 'run1', agent_id: 'a1', agent_name: bigAgentName, status: 'running', error: null, ran_at: null }] },
    });
    const deadlineConfig = { ...config, runWaitMs: 0 };
    let now = 0;
    const clock = { now: () => now, sleep: async (ms: number) => { now += ms; } };
    const server = createServer({ api, config: deadlineConfig, clock });
    const client = await connect(server);
    const result = await client.callTool({
      name: 'run_agent_on_pr',
      arguments: { repo: bigRepoName, pr: 42, agent: bigAgentName },
    });
    expect(result.isError).toBeFalsy();
    const { status, hint } = result.structuredContent as { status: string; hint?: string };
    expect(status).toBe('running');
    expect(hint).toContain('get_findings');
    expect(hint).not.toContain('x'.repeat(config.textFieldMax + 1));
    expect(hint).not.toContain('y'.repeat(config.textFieldMax + 1));
  });
});
