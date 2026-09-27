import { describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { makeFakeApi } from './helpers/fake-api.js';
import { connect } from './helpers/connect.js';

describe('list_agents', () => {
  it('returns enabled and disabled agents with exact keys, and structuredContent mirrors the text block', async () => {
    const api = makeFakeApi({
      agents: [
        { id: 'a1', name: 'A', description: 'd', model: 'gpt', enabled: true },
        { id: 'a2', name: 'B', description: 'd', model: 'gpt', enabled: false },
      ],
    });
    const server = createServer({ api, config: loadConfig({}) });
    const client = await connect(server);
    const result = await client.callTool({ name: 'list_agents', arguments: {} });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      agents: [
        { id: 'a1', name: 'A', description: 'd', model: 'gpt', enabled: true },
        { id: 'a2', name: 'B', description: 'd', model: 'gpt', enabled: false },
      ],
    });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toBe(JSON.stringify(result.structuredContent));
    expect(typeof result.structuredContent).toBe('object');
  });

  it('truncates a long agent description', async () => {
    const api = makeFakeApi({ agents: [{ id: 'a1', name: 'A', description: 'y'.repeat(600), model: 'gpt', enabled: true }] });
    const server = createServer({ api, config: loadConfig({}) });
    const client = await connect(server);
    const result = await client.callTool({ name: 'list_agents', arguments: {} });
    const agents = (result.structuredContent as { agents: { description: string }[] }).agents;
    expect(agents[0]!.description.length).toBe(500);
  });
});
