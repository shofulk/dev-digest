import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/platform/config.js';

/**
 * F15 (fix round 3) — blank `PROJECT_CONTEXT_BUDGET_TOKENS` /
 * `PROJECT_CONTEXT_MAX_DOC_BYTES` (as shipped empty in `.env`/`.env.example`)
 * must fall through to the default, not coerce to 0; negatives/zero must be
 * rejected rather than silently accepted.
 */
describe('loadConfig — PROJECT_CONTEXT_BUDGET_TOKENS / PROJECT_CONTEXT_MAX_DOC_BYTES', () => {
  it('blank env values fall through to the defaults (8000 / 262144)', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      PROJECT_CONTEXT_BUDGET_TOKENS: '',
      PROJECT_CONTEXT_MAX_DOC_BYTES: '',
    } as NodeJS.ProcessEnv);
    expect(config.projectContext.budgetTokens).toBe(8000);
    expect(config.projectContext.maxDocBytes).toBe(262144);
  });

  it('negative or zero values are rejected', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'test',
        PROJECT_CONTEXT_BUDGET_TOKENS: '-1',
      } as NodeJS.ProcessEnv),
    ).toThrow();
    expect(() =>
      loadConfig({
        NODE_ENV: 'test',
        PROJECT_CONTEXT_MAX_DOC_BYTES: '0',
      } as NodeJS.ProcessEnv),
    ).toThrow();
  });

  it('a positive value still overrides the default', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      PROJECT_CONTEXT_BUDGET_TOKENS: '4000',
      PROJECT_CONTEXT_MAX_DOC_BYTES: '1024',
    } as NodeJS.ProcessEnv);
    expect(config.projectContext.budgetTokens).toBe(4000);
    expect(config.projectContext.maxDocBytes).toBe(1024);
  });
});
