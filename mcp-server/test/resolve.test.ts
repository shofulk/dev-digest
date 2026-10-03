import { describe, expect, it } from 'vitest';
import { resolveAgent, resolvePr, resolveRepo } from '../src/app/resolve.js';
import { AgentAmbiguous, AgentNotFound, PrNotImported, RepoAmbiguous, RepoNotFound } from '../src/domain/errors.js';
import { makeFakeApi } from './helpers/fake-api.js';

describe('resolveRepo', () => {
  it('matches full_name case-insensitively', async () => {
    const api = makeFakeApi({ repos: [{ id: 'r1', name: 'foo', full_name: 'Acme/Foo' }] });
    const repo = await resolveRepo(api, 'acme/foo');
    expect(repo.id).toBe('r1');
  });

  it('resolves a unique bare name', async () => {
    const api = makeFakeApi({ repos: [{ id: 'r1', name: 'Foo', full_name: 'acme/Foo' }] });
    const repo = await resolveRepo(api, 'foo');
    expect(repo.id).toBe('r1');
  });

  it('reports ambiguity when several repos share a bare name', async () => {
    const api = makeFakeApi({
      repos: [
        { id: 'r1', name: 'foo', full_name: 'acme/foo' },
        { id: 'r2', name: 'foo', full_name: 'other/foo' },
      ],
    });
    await expect(resolveRepo(api, 'foo')).rejects.toBeInstanceOf(RepoAmbiguous);
  });

  it('lists known repos when nothing matches', async () => {
    const api = makeFakeApi({ repos: [{ id: 'r1', name: 'foo', full_name: 'acme/foo' }] });
    const err = await resolveRepo(api, 'nope').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RepoNotFound);
    expect((err as RepoNotFound).known).toEqual(['acme/foo']);
  });
});

describe('resolvePr', () => {
  it('matches by number', async () => {
    const api = makeFakeApi({ pulls: { r1: [{ id: 'p1', number: 42, title: 't' }] } });
    const pr = await resolvePr(api, 'r1', 'acme/foo', 42);
    expect(pr.id).toBe('p1');
  });

  it('treats a missing PR as not imported', async () => {
    const api = makeFakeApi({ pulls: { r1: [] } });
    await expect(resolvePr(api, 'r1', 'acme/foo', 42)).rejects.toBeInstanceOf(PrNotImported);
  });

  it('treats a PR with id:null as not imported', async () => {
    const api = makeFakeApi({ pulls: { r1: [{ id: null, number: 42, title: 't' }] } });
    await expect(resolvePr(api, 'r1', 'acme/foo', 42)).rejects.toBeInstanceOf(PrNotImported);
  });
});

describe('resolveAgent', () => {
  it('resolves by exact id', async () => {
    const api = makeFakeApi({ agents: [{ id: 'a1', name: 'Reviewer', description: '', model: 'x', enabled: true }] });
    const agent = await resolveAgent(api, 'a1');
    expect(agent.id).toBe('a1');
  });

  it('resolves by case-insensitive name', async () => {
    const api = makeFakeApi({ agents: [{ id: 'a1', name: 'Reviewer', description: '', model: 'x', enabled: true }] });
    const agent = await resolveAgent(api, 'reviewer');
    expect(agent.id).toBe('a1');
  });

  it('reports ambiguity on a duplicate name', async () => {
    const api = makeFakeApi({
      agents: [
        { id: 'a1', name: 'Reviewer', description: '', model: 'x', enabled: true },
        { id: 'a2', name: 'Reviewer', description: '', model: 'x', enabled: true },
      ],
    });
    await expect(resolveAgent(api, 'reviewer')).rejects.toBeInstanceOf(AgentAmbiguous);
  });

  it('points to list_agents on an unknown agent', async () => {
    const api = makeFakeApi({ agents: [] });
    await expect(resolveAgent(api, 'nope')).rejects.toBeInstanceOf(AgentNotFound);
  });
});
