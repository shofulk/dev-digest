import { DEFAULT_SKILL_TAB, SKILL_TABS, type SkillTab } from "./constants";

export function isSkillTab(value: string | null | undefined): value is SkillTab {
  return !!value && (SKILL_TABS as readonly string[]).includes(value);
}

/** Resolve a raw `?tab=` value; anything unknown falls back to Config. */
export function resolveSkillTab(value: string | null | undefined): SkillTab {
  return isSkillTab(value) ? value : DEFAULT_SKILL_TAB;
}
