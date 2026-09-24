import type { SkillType } from "@devdigest/shared";

/** Type-badge palette per skill type (colour is never the only cue — the badge carries the label). */
export const TYPE_COLORS: Record<SkillType, { color: string; bg: string }> = {
  rubric: { color: "var(--accent-text)", bg: "var(--accent-bg)" },
  convention: { color: "var(--ok)", bg: "var(--ok-bg)" },
  security: { color: "var(--crit)", bg: "var(--crit-bg)" },
  custom: { color: "var(--text-secondary)", bg: "var(--bg-hover)" },
};

/** Where the "disabled globally" caption and the empty state send the user. */
export const SKILLS_LAB_HREF = "/skills";
export const skillHref = (skillId: string) => `${SKILLS_LAB_HREF}?skill=${encodeURIComponent(skillId)}`;

/** MIME type used to carry the dragged skill id (HTML5 drag needs one to start in Firefox). */
export const DRAG_MIME = "text/plain";
