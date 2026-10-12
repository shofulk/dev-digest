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

/** Run-all fans out to every agent at once, so its limit is tighter still. */
export const EVAL_RUN_ALL_RATE_LIMIT_MAX = 2;
export const EVAL_RUN_ALL_RATE_LIMIT_WINDOW = '1 minute';

/** Dashboard: runs kept per agent for the sparkline, and runs in the cross-agent table. */
export const DASHBOARD_HISTORY_RUNS = 10;
export const DASHBOARD_RECENT_RUNS = 20;

/** Longest title slug in a generated case name. */
export const CASE_NAME_SLUG_MAX = 60;

/** Longest case name accepted from a form. */
export const CASE_NAME_MAX = 120;

/** Length caps of a case's free-text fields — the same numbers as `EvalCaseFields` in eval-ci.ts. */
export const CASE_NOTES_MAX = 4096;
export const CASE_PR_TITLE_MAX = 300;
export const CASE_PR_BODY_MAX = 65536;

/** A dry run gives up (and releases its lock) after this long. */
export const EVAL_DRY_RUN_TIMEOUT_MS = 120_000;

/** Rate-limit group shared by the routes that start a model call for a single case. */
export const EVAL_RUN_RATE_LIMIT_GROUP = 'eval-run-starts';

/** Body limit of the case create/update/dry-run routes (a frozen diff plus PR text). */
export const EVAL_CASE_BODY_LIMIT_BYTES = 4 * 1024 * 1024;
