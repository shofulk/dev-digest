import { describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { makeFakeApi } from './helpers/fake-api.js';
import { connect } from './helpers/connect.js';

const EXPECTED_ORDER = ['list_agents', 'run_agent_on_pr', 'get_findings', 'get_conventions', 'get_blast_radius'];

async function listTools() {
  const server = createServer({ api: makeFakeApi(), config: loadConfig({}) });
  const client = await connect(server);
  const { tools } = await client.listTools();
  return tools;
}

describe('tools/list', () => {
  it('returns exactly the five tools, in the fixed order', async () => {
    const tools = await listTools();
    expect(tools.map((t) => t.name)).toEqual(EXPECTED_ORDER);
  });

  it('carries the spec annotations', async () => {
    const tools = await listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.list_agents?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(byName.run_agent_on_pr?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
    expect(byName.get_findings?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(byName.get_conventions?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(byName.get_blast_radius?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
  });

  it('has no object- or array-typed input properties', async () => {
    const tools = await listTools();
    for (const tool of tools) {
      const props = (tool.inputSchema as { properties?: Record<string, { type?: string }> }).properties ?? {};
      for (const [key, schema] of Object.entries(props)) {
        expect(['object', 'array']).not.toContain(schema.type);
        void key;
      }
    }
  });

  it('only min_severity, response_format and category are enums', async () => {
    const tools = await listTools();
    const enumProps: string[] = [];
    for (const tool of tools) {
      const props = (tool.inputSchema as { properties?: Record<string, { enum?: unknown }> }).properties ?? {};
      for (const [key, schema] of Object.entries(props)) {
        if (schema.enum) enumProps.push(key);
      }
    }
    expect(new Set(enumProps)).toEqual(new Set(['min_severity', 'response_format', 'category']));
  });

  it('has no outputSchema', async () => {
    const tools = await listTools();
    for (const tool of tools) {
      expect(tool.outputSchema).toBeUndefined();
    }
  });

  it('the instructions name get_blast_radius', async () => {
    const server = createServer({ api: makeFakeApi(), config: loadConfig({}) });
    const client = await connect(server);
    expect(client.getInstructions() ?? '').toContain('get_blast_radius');
  });

  it('stays within the description/argument budget (C4)', async () => {
    const server = createServer({ api: makeFakeApi(), config: loadConfig({}) });
    const client = await connect(server);
    expect((client.getInstructions() ?? '').length).toBeLessThanOrEqual(500);
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect((tool.description ?? '').length).toBeLessThanOrEqual(400);
      const props = (tool.inputSchema as { properties?: Record<string, { description?: string }> }).properties ?? {};
      for (const schema of Object.values(props)) {
        expect((schema.description ?? '').length).toBeLessThanOrEqual(120);
      }
    }
  });

  it("run_agent_on_pr's input schema is exactly {repo, pr, agent} (rev 4, O7)", async () => {
    const tools = await listTools();
    const tool = tools.find((t) => t.name === 'run_agent_on_pr');
    const props = (tool?.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    expect(Object.keys(props).sort()).toEqual(['agent', 'pr', 'repo']);
  });

  it('the instructions and the run_agent_on_pr/get_findings/get_conventions descriptions call out untrusted text (rev 4, C4)', async () => {
    const server = createServer({ api: makeFakeApi(), config: loadConfig({}) });
    const client = await connect(server);
    expect(client.getInstructions() ?? '').toContain('untrusted');
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.run_agent_on_pr?.description ?? '').toContain('untrusted');
    expect(byName.get_findings?.description ?? '').toContain('untrusted');
    expect(byName.get_conventions?.description ?? '').toContain('untrusted');
    expect(byName.get_blast_radius?.description ?? '').toContain('untrusted');
  });
});
