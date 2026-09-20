import { describe, it, expect } from 'vitest';
import {
  CHEAP_CHOICES,
  resolveUsableFeatureModel,
} from '../src/modules/_shared/feature-models.js';
import type { Container } from '../src/platform/container.js';

/**
 * Provider selection must never hand back a provider whose key is missing: the app boots
 * with no keys by design, so "configured" and "callable" are different questions. These are
 * hermetic — the settings read is stubbed, no Postgres.
 */

/** A container stub exposing only what `resolveUsableFeatureModel` touches. */
function stub(keys: Record<string, string>, override?: unknown): Container {
  const SECRET: Record<string, string> = {
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
  };
  return {
    // Mirrors the real `Container.canUseLlm`: a non-empty key from Settings OR the env.
    canUseLlm: async (p: string) => Boolean(keys[SECRET[p]!]),
    secrets: { get: async (k: string) => keys[k] },
    db: {
      select: () => ({
        from: () => ({
          where: async () =>
            override === undefined
              ? []
              : [{ key: 'feature_models', value: { conventions: override } }],
        }),
      }),
    },
  } as unknown as Container;
}

const WS = 'ws-1';

describe('resolveUsableFeatureModel', () => {
  it('prefers the cheapest configured provider when nothing is overridden', async () => {
    const choice = await resolveUsableFeatureModel(
      stub({ OPENROUTER_API_KEY: 'k', OPENAI_API_KEY: 'k' }),
      WS,
      'conventions',
    );
    expect(choice).toEqual(CHEAP_CHOICES[0]);
    expect(choice.provider).toBe('openrouter');
  });

  it('NEVER selects a provider whose key is absent, even as the registry default', async () => {
    // The regression this exists for: the `conventions` registry default is openai/gpt-5.4,
    // and a scan died with `OPENAI_API_KEY is not configured` on a machine holding only an
    // OpenRouter key.
    const choice = await resolveUsableFeatureModel(
      stub({ OPENROUTER_API_KEY: 'k' }),
      WS,
      'conventions',
    );
    expect(choice.provider).toBe('openrouter');
  });

  it('skips to the next fallback when the cheapest has no key', async () => {
    const choice = await resolveUsableFeatureModel(
      stub({ ANTHROPIC_API_KEY: 'k' }),
      WS,
      'conventions',
    );
    expect(choice.provider).toBe('anthropic');
  });

  it('treats an env var exactly like a key saved in Settings', async () => {
    // `secrets.get` is the single read path and already falls back to process.env, so a
    // provider configured only through the environment must be selectable.
    const choice = await resolveUsableFeatureModel(
      stub({ OPENAI_API_KEY: 'from-env' }),
      WS,
      'conventions',
    );
    expect(choice.provider).toBe('openai');
    expect(choice.model).toBe('gpt-4o-mini');
  });

  it("honours the workspace's explicit override when that provider IS configured", async () => {
    const choice = await resolveUsableFeatureModel(
      stub({ OPENAI_API_KEY: 'k', OPENROUTER_API_KEY: 'k' }, { provider: 'openai', model: 'gpt-5.4' }),
      WS,
      'conventions',
    );
    expect(choice).toEqual({ provider: 'openai', model: 'gpt-5.4' });
  });

  it('falls past an override whose provider has no key rather than dying on it', async () => {
    const choice = await resolveUsableFeatureModel(
      stub({ OPENROUTER_API_KEY: 'k' }, { provider: 'openai', model: 'gpt-5.4' }),
      WS,
      'conventions',
    );
    expect(choice.provider).toBe('openrouter');
  });

  it('throws naming every accepted key when no provider is configured at all', async () => {
    await expect(resolveUsableFeatureModel(stub({}), WS, 'conventions')).rejects.toThrow(
      /OPENROUTER_API_KEY.*ANTHROPIC_API_KEY.*OPENAI_API_KEY/s,
    );
  });

  it('does not let a malformed override crash selection', async () => {
    const choice = await resolveUsableFeatureModel(
      stub({ OPENROUTER_API_KEY: 'k' }, { provider: 'nope' }),
      WS,
      'conventions',
    );
    expect(choice.provider).toBe('openrouter');
  });
});
