import { describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { makeFakeApi } from './helpers/fake-api.js';
import { connect } from './helpers/connect.js';

const repos = [{ id: 'r1', name: 'foo', full_name: 'acme/foo' }];

describe('get_conventions via MCP', () => {
  it('excludes pending and rejected conventions', async () => {
    const api = makeFakeApi({
      repos,
      conventions: {
        r1: [
          { id: 'c1', category: 'naming', rule: 'r1', evidence_path: 'a.ts', evidence_line: 5, status: 'accepted' },
          { id: 'c2', category: 'naming', rule: 'r2', evidence_path: 'b.ts', status: 'pending' },
          { id: 'c3', category: 'naming', rule: 'r3', evidence_path: 'c.ts', status: 'rejected' },
        ],
      },
    });
    const server = createServer({ api, config: loadConfig({}) });
    const client = await connect(server);
    const result = await client.callTool({ name: 'get_conventions', arguments: { repo: 'acme/foo' } });
    expect(result.structuredContent).toMatchObject({ total: 1 });
  });

  it('filters by category', async () => {
    const api = makeFakeApi({
      repos,
      conventions: {
        r1: [
          { id: 'c1', category: 'naming', rule: 'r1', evidence_path: 'a.ts', status: 'accepted' },
          { id: 'c2', category: 'testing', rule: 'r2', evidence_path: 'b.ts', status: 'accepted' },
        ],
      },
    });
    const server = createServer({ api, config: loadConfig({}) });
    const client = await connect(server);
    const result = await client.callTool({ name: 'get_conventions', arguments: { repo: 'acme/foo', category: 'testing' } });
    expect(result.structuredContent).toMatchObject({ total: 1, conventions: [{ category: 'testing', rule: 'r2', evidence: 'b.ts' }] });
  });

  it('formats evidence as path:line', async () => {
    const api = makeFakeApi({
      repos,
      conventions: { r1: [{ id: 'c1', category: 'naming', rule: 'r1', evidence_path: 'a.ts', evidence_line: 5, status: 'accepted' }] },
    });
    const server = createServer({ api, config: loadConfig({}) });
    const client = await connect(server);
    const result = await client.callTool({ name: 'get_conventions', arguments: { repo: 'acme/foo' } });
    expect(result.structuredContent).toMatchObject({ conventions: [{ evidence: 'a.ts:5' }] });
  });

  it('an empty list is a hint, not an error', async () => {
    const api = makeFakeApi({ repos, conventions: { r1: [] } });
    const server = createServer({ api, config: loadConfig({}) });
    const client = await connect(server);
    const result = await client.callTool({ name: 'get_conventions', arguments: { repo: 'acme/foo' } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toHaveProperty('hint');
  });

  it('resolves the repo to its uuid before calling listConventions', async () => {
    const api = makeFakeApi({ repos, conventions: { r1: [] } });
    const server = createServer({ api, config: loadConfig({}) });
    const client = await connect(server);
    await client.callTool({ name: 'get_conventions', arguments: { repo: 'acme/foo' } });
    const call = api.calls.find((c) => c.method === 'listConventions');
    expect(call?.args).toEqual(['r1']);
  });
});
