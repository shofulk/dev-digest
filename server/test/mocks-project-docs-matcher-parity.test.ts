import { describe, it, expect } from 'vitest';
import picomatch from 'picomatch';
import { MockProjectDocsSource } from '../src/adapters/mocks.js';

/**
 * CI-1 fix — `MockProjectDocsSource.matchesRoots` no longer imports
 * `picomatch` (that import broke the `reviewer-core` CI job, which runs the
 * tests that pull in `mocks.ts` with no `server/node_modules` installed).
 * Instead it reimplements the `{ dot: false }` glob semantics locally. This
 * test is the parity check: it runs the same (pattern, path) table through
 * both the real `picomatch({ dot: false })` and the mock's hand-rolled
 * matcher and asserts identical results, so the two can never silently
 * drift apart.
 */
describe('MockProjectDocsSource.matchesRoots — picomatch parity', () => {
  const patterns = [
    '**/{specs,docs,insights}/**/*.md',
    '**/*.md',
    'docs/*.md',
    'docs/?.md',
    '**',
  ];

  const paths = [
    'docs/a.md',
    'a/docs/b/c.md',
    'myspecs/a.md',
    '.github/docs/a.md',
    'docs/.hidden.md',
    'docs/a.txt',
    'specs/x.spec.md',
    'insights/INSIGHTS.md',
    'docs',
    'x/docs/y.md',
    'a/.b/c.md',
    '.docs/a.md',
    'docs/.a.md',
    'docs/a.md',
    'docs/ab.md',
  ];

  const source = new MockProjectDocsSource();

  it('matches picomatch({ dot: false }) for every (pattern, path) pair', () => {
    for (const pattern of patterns) {
      const real = picomatch(pattern, { dot: false });
      for (const path of paths) {
        const expected = real(path);
        const actual = source.matchesRoots(path, [pattern]);
        expect(actual, `pattern=${pattern} path=${path}`).toBe(expected);
      }
    }
  });

});
