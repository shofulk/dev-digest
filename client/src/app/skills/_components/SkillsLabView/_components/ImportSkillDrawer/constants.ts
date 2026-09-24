import { SkillType } from "@devdigest/shared/contracts/knowledge";

/** Width (px) of the import drawer. */
export const DRAWER_WIDTH = 560;
/** File extensions the picker offers; the server decides what it actually accepts. */
export const ACCEPT = ".md,.markdown,.zip";
/** Bytes per base64 chunk — a multiple of 3, so every chunk encodes without `=` padding. */
export const BASE64_CHUNK_BYTES = 3 * 8192;
/** Visible height (px) of the read-only body before it scrolls. */
export const BODY_MAX_HEIGHT = 280;
/** The four skill types, from the contract (value import from the contract file, never the barrel). */
export const TYPE_VALUES: readonly SkillType[] = SkillType.options;
