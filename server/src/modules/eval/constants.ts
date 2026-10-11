/**
 * Eval pipeline constants (ring 1, pure — no imports).
 */

/** A frozen case stores one file's patch; anything larger is refused rather than truncated. */
export const MAX_FROZEN_DIFF_BYTES = 200 * 1024;

/** A row still `pending` this long after its run started is reconciled to `errored`. */
export const EVAL_PENDING_TIMEOUT_MS = 15 * 60 * 1000;

/** Each suite run is a paid model call per case, so the start route is tightly limited. */
export const EVAL_RUN_RATE_LIMIT_MAX = 5;
export const EVAL_RUN_RATE_LIMIT_WINDOW = '1 minute';

/** Dashboard: runs kept per agent for the sparkline, and runs in the cross-agent table. */
export const DASHBOARD_HISTORY_RUNS = 10;
export const DASHBOARD_RECENT_RUNS = 20;

/** Longest title slug in a generated case name. */
export const CASE_NAME_SLUG_MAX = 60;
