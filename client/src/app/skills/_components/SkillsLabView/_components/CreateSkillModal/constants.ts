import { SkillType } from "@devdigest/shared/contracts/knowledge";

export const MODAL_WIDTH = 640;
export const BODY_ROWS = 10;
export const DEFAULT_TYPE: SkillType = "rubric";
/** The four skill types, from the contract (value import from the contract file, never the barrel). */
export const TYPE_VALUES: readonly SkillType[] = SkillType.options;
