/** Pure helpers for the conventions CreateSkillModal. */

import { SKILLS_LAB_PATH, SKILL_CONFIG_TAB } from "./constants";

/** A skill needs a name and a body before it can be saved. */
export function canCreate(name: string, body: string): boolean {
  return name.trim().length > 0 && body.trim().length > 0;
}

/**
 * Where to land after saving. The Skills Lab is ONE route that carries its selection in
 * `?skill=&tab=` — there is no `/skills/:id` page — so the deep link is built here rather
 * than reaching into the Lab's own URL helper.
 */
export function skillLabHref(skillId: string): string {
  return `${SKILLS_LAB_PATH}?skill=${encodeURIComponent(skillId)}&tab=${SKILL_CONFIG_TAB}`;
}
