import { describe, it, expect } from 'vitest';
import { MockProjectDocsSource } from '../src/adapters/mocks.js';

/**
 * F18 (fix round 3) — `MockProjectDocsSource.matchesRoots` now delegates to
 * `picomatch(pattern, { dot: false })`, the same matcher the real adapter
 * uses, instead of a hand-rolled `globToRegExp`. `dot: false` means a `**`
 * segment never matches a dotfile or dot-directory.
 */
describe('MockProjectDocsSource.matchesRoots', () => {
  const roots = ['**/{specs,docs,insights}/**/*.md'];

  it('rejects paths that only match through a dot-segment', () => {
    const source = new MockProjectDocsSource();
    expect(source.matchesRoots('.github/docs/a.md', roots)).toBe(false);
    expect(source.matchesRoots('myspecs/a.md', roots)).toBe(false);
    expect(source.matchesRoots('docs/.hidden.md', roots)).toBe(false);
  });

  it('still accepts an ordinary matching path', () => {
    const source = new MockProjectDocsSource();
    expect(source.matchesRoots('docs/architecture.md', roots)).toBe(true);
  });
});
