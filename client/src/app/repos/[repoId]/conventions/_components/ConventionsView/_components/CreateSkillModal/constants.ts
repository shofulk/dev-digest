import { SkillType } from "@devdigest/shared/contracts/knowledge";

/** Value import from the CONTRACT FILE, never the barrel — the barrel 500s `next dev`
 *  (client/INSIGHTS.md, 2026-09-17). */
export const TYPE_VALUES: readonly SkillType[] = SkillType.options;

/** A skill merged from conventions is a `convention` skill unless the user says otherwise. */
export const DEFAULT_TYPE: SkillType = "convention";

export const MODAL_WIDTH = 880;
export const DRAFT_SKELETON_HEIGHT = 320;

/** Where the saved skill opens: the Skills Lab keeps its selection in the query string. */
export const SKILLS_LAB_PATH = "/skills";
export const SKILL_CONFIG_TAB = "config";

/** "no agent" — the default of the link select. */
export const NO_AGENT = "";
