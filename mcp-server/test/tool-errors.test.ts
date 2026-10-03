import { describe, expect, it } from 'vitest';
import { toForwardText } from '../src/tools/errors.js';
import {
  AgentAmbiguous,
  AgentDisabled,
  AgentNotFound,
  ApiFailure,
  ApiUnreachable,
  NoRun,
  PrNotImported,
  RateLimited,
  RepoAmbiguous,
  RepoNotFound,
  ReviewMissing,
  RunNotFound,
  RunNotStarted,
  type KnownDomainError,
} from '../src/domain/errors.js';

const TEXT_MAX = 500;

const cases: KnownDomainError[] = [
  new ApiUnreachable('http://api.test'),
  new RateLimited('http://api.test'),
  new ApiFailure(500, 'http://api.test', 'boom'),
  new RepoNotFound('foo', ['acme/foo']),
  new RepoAmbiguous('foo', ['acme/foo', 'other/foo']),
  new PrNotImported('acme/foo', 42),
  new AgentNotFound('nope'),
  new AgentAmbiguous('reviewer', ['a1', 'a2']),
  new AgentDisabled('Reviewer'),
  new NoRun('acme/foo', 42, null),
  new RunNotFound('run1', 'acme/foo', 42),
  new RunNotStarted(),
  new ReviewMissing('run1'),
];

describe('toForwardText', () => {
  it('maps every DomainError subclass to non-empty forward-leading text', () => {
    for (const err of cases) {
      const text = toForwardText(err, TEXT_MAX);
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it('ApiUnreachable names the URL and ./scripts/dev.sh', () => {
    const text = toForwardText(new ApiUnreachable('http://api.test'), TEXT_MAX);
    expect(text).toContain('http://api.test');
    expect(text).toContain('./scripts/dev.sh');
  });

  it('AgentNotFound names list_agents', () => {
    expect(toForwardText(new AgentNotFound('nope'), TEXT_MAX)).toContain('list_agents');
  });

  it('NoRun names run_agent_on_pr', () => {
    expect(toForwardText(new NoRun('acme/foo', 42, null), TEXT_MAX)).toContain('run_agent_on_pr');
  });

  it('RateLimited says to retry in a minute', () => {
    expect(toForwardText(new RateLimited('http://api.test'), TEXT_MAX)).toMatch(/retry in a minute/);
  });

  it('AgentDisabled says to enable it in DevDigest', () => {
    expect(toForwardText(new AgentDisabled('Reviewer'), TEXT_MAX)).toMatch(/enable it in DevDigest/);
  });
});
