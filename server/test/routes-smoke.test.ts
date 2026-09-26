import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { MockAuthProvider, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';

/**
 * No-DB route smoke tests via app.inject(). `/health` and the validation/error
 * envelope don't touch the database (postgres-js connects lazily), so these run
 * without Docker. DB-backed routes are covered in integration.test.ts.
 */
const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

describe('routes (no DB)', () => {
  it('GET /health → ok', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('POST /settings/test-connection (github) returns structured ConnTestResult', async () => {
    const app = await buildApp({
      config,
      overrides: { github: new MockGitHubClient({ login: 'octocat' }) },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/settings/test-connection',
      payload: { provider: 'github' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.provider).toBe('github');
    expect(body.ok).toBe(true);
    expect(body.message).toContain('octocat');
    await app.close();
  });

  it('POST /settings/test-connection (openai) uses injected LLM listModels', async () => {
    const app = await buildApp({
      config,
      overrides: {
        llm: { openai: new MockLLMProvider('openai', { models: [{ id: 'gpt-4.1', provider: 'openai' }] }) },
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/settings/test-connection',
      payload: { provider: 'openai' },
    });
    expect(res.json().ok).toBe(true);
    await app.close();
  });

  it('GET /pulls/not-a-uuid/smart-diff → 422 (rejected by IdParams; the handler never runs)', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/smart-diff' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    await app.close();
  });

  it('returns 422 structured error on invalid body', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({
      method: 'POST',
      url: '/settings/test-connection',
      payload: { provider: 'not-a-provider' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    await app.close();
  });
});

describe('skills routes (no DB)', () => {
  /**
   * Every skills handler opens with `getContext`, and the real AuthProvider reads the
   * seeded user + workspace from the database — so without this override the handlers
   * that get past validation throw and the route answers 500. It passes on a dev box
   * only because Postgres happens to be up; CI has none in the unit job.
   */
  const noDb = { auth: new MockAuthProvider() };

  it('registers the skills routes: bad input is rejected at the edge, not 404', async () => {
    const app = await buildApp({ config, overrides: noDb });
    const cases: Array<{ method: 'GET' | 'POST' | 'PUT' | 'DELETE'; url: string; payload?: object }> = [
      { method: 'GET', url: '/skills/not-a-uuid' },
      { method: 'PUT', url: '/skills/not-a-uuid', payload: {} },
      { method: 'DELETE', url: '/skills/not-a-uuid' },
      { method: 'GET', url: '/skills/not-a-uuid/versions' },
      { method: 'GET', url: '/skills/not-a-uuid/versions/1' },
      { method: 'GET', url: '/skills/not-a-uuid/stats' },
      { method: 'POST', url: '/skills/not-a-uuid/versions/1/restore' },
      { method: 'POST', url: '/skills', payload: {} },
      { method: 'POST', url: '/skills/import', payload: {} },
      { method: 'POST', url: '/skills/import/preview', payload: {} },
    ];
    for (const c of cases) {
      const res = await app.inject(c);
      expect(res.statusCode, `${c.method} ${c.url}`).toBe(422);
      expect(res.json().error.code).toBe('validation_error');
    }
    await app.close();
  });

  it('POST /skills/tokens counts with the injected tokenizer, and null when it throws', async () => {
    const counting = await buildApp({
      config,
      overrides: { ...noDb, tokenizer: { count: (t) => t.length } },
    });
    const ok = await counting.inject({ method: 'POST', url: '/skills/tokens', payload: { body: 'abcd' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ tokens: 4 });
    await counting.close();

    const broken = await buildApp({
      config,
      overrides: {
        ...noDb,
        tokenizer: {
          count: () => {
            throw new Error('bpe unavailable');
          },
        },
      },
    });
    const res = await broken.inject({ method: 'POST', url: '/skills/tokens', payload: { body: 'x' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tokens: null });
    await broken.close();
  });

  it('POST /skills/import/preview turns a refusal into a 400 with a readable message', async () => {
    const app = await buildApp({ config, overrides: noDb });
    const res = await app.inject({
      method: 'POST',
      url: '/skills/import/preview',
      payload: { filename: 'notes.txt', content_base64: Buffer.from('hi').toString('base64') },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/\.md/);
    await app.close();
  });

  it('POST /skills/import/preview parses markdown without a database', async () => {
    const app = await buildApp({ config, overrides: noDb });
    const res = await app.inject({
      method: 'POST',
      url: '/skills/import/preview',
      payload: {
        filename: 'rules.md',
        content_base64: Buffer.from('# Rules\n\nBe kind.').toString('base64'),
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'Rules', description: 'Be kind.', source: 'imported_file' });
    await app.close();
  });
});
