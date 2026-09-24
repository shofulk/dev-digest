import type { AgentLinkedSkill, Skill } from "@devdigest/shared";
import type { AgentSkillItem } from "@/lib/hooks/agent-skills";

/* Pure helpers for the Skills tab — no DOM, no React. The order of the linked list IS the
   order of the blocks in the assembled prompt, so every reorder goes through here. */

/** Links in prompt order (`order`, then name for a stable tie-break). Never mutates. */
export function sortByOrder(links: readonly AgentLinkedSkill[]): AgentLinkedSkill[] {
  return [...links].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/** `N of M enabled`: counts LINKS (`enabled` per agent), never workspace skills. */
export function countEnabled(links: readonly AgentLinkedSkill[]): { enabled: number; total: number } {
  return { enabled: links.filter((l) => l.enabled).length, total: links.length };
}

/** Case-insensitive filter over name + description. Empty query returns the list as is. */
export function filterLinks(links: readonly AgentLinkedSkill[], query: string): AgentLinkedSkill[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...links];
  return links.filter((l) => `${l.name} ${l.description}`.toLowerCase().includes(q));
}

/** Move the item at `from` to index `to` (the item takes the target's position). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from === to || from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
  const item = next.splice(from, 1)[0] as T;
  next.splice(to, 0, item);
  return next;
}

/** Drag-and-drop: the dragged skill takes the drop target's position. `null` = no change. */
export function reorderTo(
  links: readonly AgentLinkedSkill[],
  fromId: string,
  toId: string,
): AgentLinkedSkill[] | null {
  const from = links.findIndex((l) => l.skill_id === fromId);
  const to = links.findIndex((l) => l.skill_id === toId);
  if (from < 0 || to < 0 || from === to) return null;
  return moveItem(links, from, to);
}

/** Keyboard (`Alt+↑` = -1, `Alt+↓` = +1): one step. `null` at either end or for an unknown id. */
export function reorderBy(
  links: readonly AgentLinkedSkill[],
  skillId: string,
  delta: -1 | 1,
): AgentLinkedSkill[] | null {
  const from = links.findIndex((l) => l.skill_id === skillId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= links.length) return null;
  return moveItem(links, from, to);
}

/** The body `POST /agents/:id/skills` takes: the whole ordered set, each row's CURRENT
 *  `enabled` — a reorder must never re-enable a skill (server spec, criterion 22). */
export function toSetItems(links: readonly AgentLinkedSkill[]): AgentSkillItem[] {
  return links.map((l) => ({ skill_id: l.skill_id, enabled: l.enabled }));
}

/** Workspace skills that are not linked to this agent yet — the "Add skill" options. */
export function unlinkedSkills<T extends Pick<Skill, "id">>(
  all: readonly T[],
  links: readonly AgentLinkedSkill[],
): T[] {
  const linked = new Set(links.map((l) => l.skill_id));
  return all.filter((s) => !linked.has(s.id));
}
