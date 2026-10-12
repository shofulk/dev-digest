import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { toGitHubError, readResultFromZip } from '../src/adapters/github/octokit.js';
import { GitHubAccessError } from '../src/platform/errors.js';

const CAP = 1_048_576;

describe('toGitHubError', () => {
  it('AC-13: maps 403 and 404 to GitHubAccessError', () => {
    expect(toGitHubError(Object.assign(new Error('Forbidden'), { status: 403 }))).toBeInstanceOf(
      GitHubAccessError,
    );
    expect(toGitHubError(Object.assign(new Error('Not Found'), { status: 404 }))).toBeInstanceOf(
      GitHubAccessError,
    );
  });

  it('AC-13: passes any other error through unchanged', () => {
    const e500 = Object.assign(new Error('boom'), { status: 500 });
    expect(toGitHubError(e500)).toBe(e500);
    const plain = new Error('network');
    expect(toGitHubError(plain)).toBe(plain);
    expect(toGitHubError('x')).toBe('x');
  });
});

describe('readResultFromZip', () => {
  const entry = 'devdigest-result.json';

  it('AC-18: returns the entry text', () => {
    const zip = zipSync({ [entry]: strToU8('{"a":1}') });
    expect(readResultFromZip(zip, entry, CAP)).toEqual({ status: 'ok', text: '{"a":1}' });
  });

  it('AC-18: a missing entry is invalid', () => {
    const zip = zipSync({ 'other.json': strToU8('{}') });
    expect(readResultFromZip(zip, entry, CAP)).toEqual({ status: 'invalid' });
  });

  it('NFR-1: bytes over the cap are too_large', () => {
    const zip = zipSync({ [entry]: strToU8('x'.repeat(2000)) });
    expect(readResultFromZip(new Uint8Array(CAP + 1), entry, CAP)).toEqual({ status: 'too_large' });
    // an entry whose declared size is above the cap is never inflated
    expect(readResultFromZip(zip, entry, 1000)).toEqual({ status: 'invalid' });
  });

  it('NFR-1: garbage bytes are invalid, not a throw', () => {
    expect(readResultFromZip(new Uint8Array([1, 2, 3]), entry, CAP)).toEqual({ status: 'invalid' });
  });
});
