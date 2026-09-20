import type { IconName } from "@devdigest/ui";
import type { SkillSource, SkillType } from "@devdigest/shared";

/** Badge colours per skill type (CSS tokens, so both themes work). */
export const TYPE_COLORS: Record<SkillType, { color: string; bg: string }> = {
  rubric: { color: "var(--accent-text)", bg: "var(--accent-bg)" },
  convention: { color: "var(--ok)", bg: "var(--ok-bg)" },
  security: { color: "var(--crit)", bg: "var(--crit-bg)" },
  custom: { color: "var(--warn)", bg: "var(--warn-bg)" },
};

/** Source icon; label comes from `skills.listItem.source.<source>`. */
export const SOURCE_ICONS: Record<SkillSource, IconName> = {
  manual: "Edit",
  extracted: "Sparkles",
  community: "Users",
  imported_url: "Link",
  imported_file: "Upload",
};
