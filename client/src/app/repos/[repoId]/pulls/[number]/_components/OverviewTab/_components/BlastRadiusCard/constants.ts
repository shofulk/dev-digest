/* Pure constants for BlastRadiusCard — no hooks, no React. */
import type { IconName } from "@devdigest/ui";
import type { BlastDegradedReason } from "@devdigest/shared";

export const STAT_ICONS: readonly { key: "symbols" | "callers" | "endpoints" | "crons"; icon: IconName }[] = [
  { key: "symbols", icon: "Code" },
  { key: "callers", icon: "CornerDownRight" },
  { key: "endpoints", icon: "Globe" },
  { key: "crons", icon: "Clock" },
] as const;

/** `BlastDegradedReason` -> the `blast.json` key that translates it. */
export const REASON_KEYS: Record<BlastDegradedReason, string> = {
  flag_off: "reason.flag_off",
  index_failed: "reason.index_failed",
  index_partial: "reason.index_partial",
  repo_too_large: "reason.repo_too_large",
  no_data: "reason.no_data",
};
