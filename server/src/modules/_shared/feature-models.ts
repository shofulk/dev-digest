import { eq } from 'drizzle-orm';
import {
  FEATURE_MODELS,
  FeatureModelChoice,
  type FeatureModelId,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { ConfigError } from '../../platform/errors.js';
import * as t from '../../db/schema.js';
import { rowsToSettings } from '../settings/helpers.js';

/**
 * Per-feature model configuration.
 *
 * System LLM features (onboarding, intent, risk brief, conformance, conventions)
 * read their provider/model from the workspace's Settings instead of a hardcoded
 * module constant. When the workspace hasn't chosen one, we fall back to the
 * registry default in `FEATURE_MODELS` — which mirrors each module's old
 * constant, so behaviour is unchanged until a model is explicitly picked.
 */

const DEFAULTS = Object.fromEntries(
  FEATURE_MODELS.map((f) => [f.id, { provider: f.defaultProvider, model: f.defaultModel }]),
) as Record<FeatureModelId, FeatureModelChoice>;

/** The registry default (provider+model) for a feature — no DB read. */
export function defaultFeatureModel(id: FeatureModelId): FeatureModelChoice {
  return DEFAULTS[id];
}

/**
 * The workspace's override for `id`, or `undefined` when unset/invalid. Callers
 * that keep their own dynamic default (e.g. conventions) use this directly so
 * that default is preserved; callers with a static default use
 * `resolveFeatureModel` instead.
 */
export async function getFeatureModelOverride(
  container: Container,
  workspaceId: string,
  id: FeatureModelId,
): Promise<FeatureModelChoice | undefined> {
  const rows = await container.db
    .select({ key: t.settings.key, value: t.settings.value })
    .from(t.settings)
    .where(eq(t.settings.workspaceId, workspaceId));
  const fm = (rowsToSettings(rows) as { feature_models?: Record<string, unknown> }).feature_models;
  const parsed = FeatureModelChoice.safeParse(fm?.[id]);
  return parsed.success ? parsed.data : undefined;
}

/** Resolve `id` to a concrete provider+model: workspace override, else registry default. */
export async function resolveFeatureModel(
  container: Container,
  workspaceId: string,
  id: FeatureModelId,
): Promise<FeatureModelChoice> {
  return (await getFeatureModelOverride(container, workspaceId, id)) ?? DEFAULTS[id];
}

// ---------------------------------------------------------------- availability

/** Named only for the error message; availability itself is `container.canUseLlm`. */
const PROVIDER_KEY: Record<FeatureModelChoice['provider'], string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

/**
 * Cheap-first fallback order for a feature with no workspace override.
 *
 * OpenRouter leads because this is the order of cost, not preference: a repo scan
 * is a ~90k-character prompt whose job is classification, and the flagship tiers
 * buy nothing for it. Measured on a live scan, `deepseek-v4-flash` cost ~$0.001.
 */
export const CHEAP_CHOICES: readonly FeatureModelChoice[] = [
  { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' },
  { provider: 'anthropic', model: 'claude-haiku-4-5' },
  { provider: 'openai', model: 'gpt-4o-mini' },
];

/**
 * Resolve a feature to a provider that is ACTUALLY CONFIGURED.
 *
 * `resolveFeatureModel` answers "what is configured?" and will happily hand back a
 * provider whose key does not exist — the caller then dies inside `container.llm()`
 * with `OPENAI_API_KEY is not configured`, which reads as a bug in the feature rather
 * than a gap in the setup. This answers "what can we actually call right now?":
 * the workspace's explicit choice first, then `fallbacks` in cheap-first order, and a
 * provider that cannot be called is never selected. Availability is asked of the container
 * (`canUseLlm`), so an env var counts exactly as much as a key saved in Settings, and an
 * injected mock counts in tests.
 *
 * Throws `ConfigError` naming every accepted key when nothing is configured — the app
 * boots with no keys by design, so this is a normal state to report, not a crash.
 */
export async function resolveUsableFeatureModel(
  container: Container,
  workspaceId: string,
  id: FeatureModelId,
  fallbacks: readonly FeatureModelChoice[] = CHEAP_CHOICES,
): Promise<FeatureModelChoice> {
  const override = await getFeatureModelOverride(container, workspaceId, id);
  const candidates = override ? [override, ...fallbacks] : [...fallbacks];

  for (const choice of candidates) {
    if (await container.canUseLlm(choice.provider)) return choice;
  }

  const names = [...new Set(candidates.map((c) => PROVIDER_KEY[c.provider]))];
  throw new ConfigError(
    `No LLM provider is configured. Set one of ${names.join(', ')} in Settings or the environment.`,
  );
}
