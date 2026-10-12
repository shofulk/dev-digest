import { describe, it, expect } from 'vitest';
import { wrapUntrusted } from '@devdigest/reviewer-core';
import { ARCHITECTURE_MD, ARCHITECTURE_MD_SPECS_BLOCK } from '../src/db/seed-project-context.js';

/**
 * CI-2 fix — `seed-project-context.ts` must not import `@devdigest/reviewer-core`
 * at runtime (`db:seed` runs in the `e2e-web` CI job before reviewer-core's
 * deps are installed), so its `prompt_assembly.specs` demo text is a fixed
 * string literal instead of a `wrapUntrusted(...)` call. This hermetic test
 * is what keeps that literal from drifting: it imports the real
 * `wrapUntrusted` (vitest resolves the `@devdigest/reviewer-core` alias;
 * `db:seed` does not run under vitest) and asserts byte-for-byte equality.
 */
describe('seed-project-context — ARCHITECTURE_MD_SPECS_BLOCK literal', () => {
  it('equals wrapUntrusted("docs/architecture.md", ARCHITECTURE_MD)', () => {
    expect(ARCHITECTURE_MD_SPECS_BLOCK).toBe(wrapUntrusted('docs/architecture.md', ARCHITECTURE_MD));
  });
});
