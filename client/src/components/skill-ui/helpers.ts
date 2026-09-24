import type { SkillSource } from "@devdigest/shared";

/** Only a hand-written skill is trusted; every other source is untrusted data. */
export function isUntrusted(source: SkillSource): boolean {
  return source !== "manual";
}

/**
 * A rate from the API (a 0..1 ratio) as a whole percent, clamped to 0..100.
 * Non-finite input reads as 0 — never `NaN%`.
 */
export function toPercent(rate: number): number {
  if (!Number.isFinite(rate)) return 0;
  return Math.min(100, Math.max(0, Math.round(rate * 100)));
}
