// RING 1 — pure application constants. No imports.

/** `summary` text when the PR has no changed files (the index read is skipped entirely). */
export const NO_FILES_SUMMARY = 'No changed files found for this pull request.';

/** `summary` text when the changed files declare no symbols the index tracks. */
export const NO_SYMBOLS_SUMMARY = 'No symbols changed in this pull request.';

/** `summary` text when the index isn't ready to answer (degraded, no data yet). */
export const INDEX_NOT_READY_SUMMARY = "The repository index isn't ready yet.";
