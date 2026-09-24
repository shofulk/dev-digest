import { SKILLS_PATH, SKILL_PARAM, TAB_PARAM } from "./constants";

/**
 * Next `/skills` URL from the current query string: `skill` / `tab` are set (or removed
 * with `null`) and every other param is kept. Passing only one leaves the other as-is,
 * which is what makes switching skills keep the active tab.
 */
export function buildSkillsUrl(current: string, next: { skill?: string | null; tab?: string | null }): string {
  const sp = new URLSearchParams(current);
  if (next.skill !== undefined) {
    if (next.skill === null) sp.delete(SKILL_PARAM);
    else sp.set(SKILL_PARAM, next.skill);
  }
  if (next.tab !== undefined) {
    if (next.tab === null) sp.delete(TAB_PARAM);
    else sp.set(TAB_PARAM, next.tab);
  }
  const qs = sp.toString();
  return qs ? `${SKILLS_PATH}?${qs}` : SKILLS_PATH;
}
