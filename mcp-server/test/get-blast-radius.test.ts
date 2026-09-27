import { describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { makeFakeApi } from './helpers/fake-api.js';
import { connect } from './helpers/connect.js';

describe('get_blast_radius via MCP', () => {
  it('schema is exactly repo (string) + pr (integer)', async () => {
    const server = createServer({ api: makeFakeApi(), config: loadConfig({}) });
    const client = await connect(server);
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'get_blast_radius')!;
    const props = (tool.inputSchema as { properties?: Record<string, { type?: string }>; required?: string[] }).properties ?? {};
    expect(Object.keys(props).sort()).toEqual(['pr', 'repo']);
    expect(props.repo?.type).toBe('string');
    expect(props.pr?.type).toBe('integer');
  });

  it('always returns isError with "not implemented" and "do not retry", making zero API calls', async () => {
    const api = makeFakeApi();
    const server = createServer({ api, config: loadConfig({}) });
    const client = await connect(server);
    const result = await client.callTool({ name: 'get_blast_radius', arguments: { repo: 'acme/foo', pr: 42 } });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toMatch(/not implemented/);
    expect(text).toMatch(/do not retry/);
    expect(api.calls).toHaveLength(0);
  });
});
