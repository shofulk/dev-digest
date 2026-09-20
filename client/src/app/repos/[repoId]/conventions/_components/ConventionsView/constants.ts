import type { ConventionStatus } from "@devdigest/shared";

/** Triage filters, in the order the chips appear. `all` is the widened view. */
export const FILTERS = ["pending", "accepted", "rejected", "all"] as const;
export type ConventionFilter = (typeof FILTERS)[number];

/** Filter → the statuses it shows. `all` shows everything. */
export const FILTER_STATUSES: Record<ConventionFilter, ConventionStatus[] | null> = {
  pending: ["pending"],
  accepted: ["accepted"],
  rejected: ["rejected"],
  all: null,
};

/** Query param carrying the candidate under inline edit, so a reload keeps the editor open. */
export const CANDIDATE_PARAM = "candidate";

export const SKELETON_CARDS = 3;
export const SKELETON_HEIGHT = 170;

/** How many live-log lines of a running scan stay on screen. */
export const LOG_TAIL = 4;
