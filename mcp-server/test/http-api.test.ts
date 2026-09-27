import { describe, expect, it, vi } from 'vitest';
import { createHttpApi } from '../src/adapters/http-api.js';
import { ApiFailure, ApiUnreachable, DomainError, RateLimited } from '../src/domain/errors.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createHttpApi', () => {
  it('reads bare JSON with no envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([{ id: '1', name: 'x', full_name: 'a/x' }]));
    const api = createHttpApi({ baseUrl: 'http://api.test', timeoutMs: 1000, fetch: fetchMock });
    const repos = await api.listRepos();
    expect(repos).toEqual([{ id: '1', name: 'x', full_name: 'a/x' }]);
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/repos', expect.any(Object));
  });

  it('POSTs {agentId} as the review trigger body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ pr_id: 'p1', runs: [] }));
    const api = createHttpApi({ baseUrl: 'http://api.test', timeoutMs: 1000, fetch: fetchMock });
    await api.triggerReview('p1', 'a1');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ agentId: 'a1' });
  });

  it('normalises a trailing slash on the configured base URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    const api = createHttpApi({ baseUrl: 'http://api.test/', timeoutMs: 1000, fetch: fetchMock });
    await api.listAgents();
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/agents', expect.any(Object));
  });

  it('URL-encodes path segments (ids)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    const api = createHttpApi({ baseUrl: 'http://api.test', timeoutMs: 1000, fetch: fetchMock });
    await api.listPulls('repo/with space');
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/repos/repo%2Fwith%20space/pulls', expect.any(Object));
  });

  it('maps a 429 to RateLimited by status alone, ignoring its internal_error code', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: 'internal_error', message: 'rate limit' } }, 429),
    );
    const api = createHttpApi({ baseUrl: 'http://api.test', timeoutMs: 1000, fetch: fetchMock });
    await expect(api.listAgents()).rejects.toBeInstanceOf(RateLimited);
  });

  it('maps a connection refusal to ApiUnreachable naming the URL', async () => {
    const fetchMock = vi.fn().mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
    const api = createHttpApi({ baseUrl: 'http://api.test', timeoutMs: 1000, fetch: fetchMock });
    const err = await api.listAgents().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiUnreachable);
    expect((err as ApiUnreachable).url).toBe('http://api.test/agents');
  });

  it('maps an abort (timeout) to ApiUnreachable', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('The operation was aborted', 'TimeoutError'));
    const api = createHttpApi({ baseUrl: 'http://api.test', timeoutMs: 1000, fetch: fetchMock });
    await expect(api.listAgents()).rejects.toBeInstanceOf(ApiUnreachable);
  });

  it('maps a non-2xx (404) to ApiFailure carrying the body error.message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'not found' } }, 404));
    const api = createHttpApi({ baseUrl: 'http://api.test', timeoutMs: 1000, fetch: fetchMock });
    const err = await api.listAgents().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFailure);
    expect((err as ApiFailure).status).toBe(404);
    expect((err as ApiFailure).detail).toBe('not found');
  });

  it('never throws anything but a DomainError', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const api = createHttpApi({ baseUrl: 'http://api.test', timeoutMs: 1000, fetch: fetchMock });
    const err = await api.listAgents().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
  });
});
