import { describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { makeFakeApi } from './helpers/fake-api.js';
import { connect } from './helpers/connect.js';

const repos = [{ id: 'r1', name: 'foo', full_name: 'acme/foo' }];
const pulls = { r1: [{ id: 'p1', number: 42, title: 'x' }] };

describe('get_blast_radius via MCP (T11)', () => {
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

  it('unknown repo -> isError with "not found. Known repos"', async () => {
    const api = makeFakeApi({ repos });
    const server = createServer({ api, config: loadConfig({}) });
    const client = await connect(server);
    const result = await client.callTool({ name: 'get_blast_radius', arguments: { repo: 'nope/nope', pr: 1 } });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toMatch(/not found\. Known repos/);
  });

  it('a known repo with an unknown PR -> isError with "is not imported in DevDigest"', async () => {
    const api = makeFakeApi({ repos, pulls });
    const server = createServer({ api, config: loadConfig({}) });
    const client = await connect(server);
    const result = await client.callTool({ name: 'get_blast_radius', arguments: { repo: 'acme/foo', pr: 999 } });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toMatch(/is not imported in DevDigest/);
  });

  it('happy path -> structuredContent deep-equals the mapped fields, extra fields stripped at every level', async () => {
    const api = makeFakeApi({
      repos,
      pulls,
      blast: {
        p1: {
          changed_symbols: [
            // extra field planted -> must not survive mapping
            { name: 'rateLimit', file: 'src/mw.ts', kind: 'function', ...( { internal: 'x' } as object) },
          ],
          downstream: [
            {
              symbol: 'rateLimit',
              callers: [
                {
                  name: 'handle',
                  file: 'src/api.ts',
                  line: 10,
                  depth: 1,
                  via: null,
                  ...({ secret: 'leak' } as object),
                },
                { name: 'route', file: 'src/routes.ts', line: 8, depth: 2, via: 'handle' },
              ],
              endpoints_affected: ['GET /x'],
              crons_affected: ['job:a'],
            },
          ],
          summary: 's',
          degraded: false,
          reason: null,
          // extra field planted on limits -> must not survive mapping
          limits: { max_callers_per_symbol: 20, bfs_depth: 2, ...({ internal: 'leak' } as object) },
          // top-level extra field -> must not survive
          internal: 'top-secret',
        } as never,
      },
    });
    const server = createServer({ api, config: loadConfig({}) });
    const client = await connect(server);
    const result = await client.callTool({ name: 'get_blast_radius', arguments: { repo: 'acme/foo', pr: 42 } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      repo: 'acme/foo',
      pr: 42,
      summary: 's',
      degraded: false,
      reason: null,
      limits: { max_callers_per_symbol: 20, bfs_depth: 2 },
      changed_symbols: [{ name: 'rateLimit', file: 'src/mw.ts', kind: 'function' }],
      downstream: [
        {
          symbol: 'rateLimit',
          callers: [
            { name: 'handle', file: 'src/api.ts', line: 10, depth: 1, via: null },
            { name: 'route', file: 'src/routes.ts', line: 8, depth: 2, via: 'handle' },
          ],
          endpoints_affected: ['GET /x'],
          crons_affected: ['job:a'],
        },
      ],
    });
    expect(Object.keys(result.structuredContent as object).sort()).toEqual(
      ['changed_symbols', 'degraded', 'downstream', 'limits', 'pr', 'reason', 'repo', 'summary'].sort(),
    );
    const caller = (result.structuredContent as { downstream: { callers: object[] }[] }).downstream[0]!.callers[0]!;
    expect(Object.keys(caller).sort()).toEqual(['depth', 'file', 'line', 'name', 'via'].sort());
    const limits = (result.structuredContent as { limits: object }).limits;
    expect(Object.keys(limits).sort()).toEqual(['bfs_depth', 'max_callers_per_symbol'].sort());

    expect(api.calls.map((c) => c.method)).toEqual(['listRepos', 'listPulls', 'getBlastRadius']);
  });

  it('degraded: true, reason: index_partial passes through', async () => {
    const api = makeFakeApi({
      repos,
      pulls,
      blast: {
        p1: {
          changed_symbols: [],
          downstream: [],
          summary: 'partial',
          degraded: true,
          reason: 'index_partial',
        },
      },
    });
    const server = createServer({ api, config: loadConfig({}) });
    const client = await connect(server);
    const result = await client.callTool({ name: 'get_blast_radius', arguments: { repo: 'acme/foo', pr: 42 } });
    expect(result.structuredContent).toMatchObject({ degraded: true, reason: 'index_partial' });
  });

  it('a 500-symbol downstream stays within the response budget, with the budgetBlast hint', async () => {
    const downstream = Array.from({ length: 500 }, (_, i) => ({
      symbol: `sym${i}`,
      callers: [{ name: `caller${i}`, file: `src/file${i}.ts`, line: i + 1 }],
      endpoints_affected: [],
      crons_affected: [],
    }));
    const api = makeFakeApi({
      repos,
      pulls,
      blast: { p1: { changed_symbols: [], downstream, summary: 's' } },
    });
    const config = loadConfig({});
    const server = createServer({ api, config });
    const client = await connect(server);
    const result = await client.callTool({ name: 'get_blast_radius', arguments: { repo: 'acme/foo', pr: 42 } });
    expect(JSON.stringify(result.structuredContent).length).toBeLessThanOrEqual(config.responseMaxChars);
    expect((result.structuredContent as { hint?: string }).hint).toMatch(/omitted to fit the response size budget/);
  });
});
