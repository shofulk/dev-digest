// RING 1 — pure constants. Caps for the intent classifier (D1/D5/D6). No I/O.

/** Prompt-section caps (D5 "Classifier user prompt"). */
export const MAX_TITLE_CHARS = 300;
export const MAX_BODY_CHARS = 6000;
export const MAX_ISSUES = 3;
export const MAX_ISSUE_CHARS = 4000;
export const MAX_DOCS = 3;
export const MAX_DOC_CHARS = 8000;
export const MAX_FILES_LISTED = 200;
export const MAX_HEADER_LINES_PER_FILE = 3;
export const MAX_HEADER_LINE_CHARS = 120;

/** Total untrusted-char budget across every section (~6k tokens). Truncation
 *  order when over: docs, then issues, then the file-list tail. Title/body
 *  are cut last. */
export const MAX_TOTAL_UNTRUSTED_CHARS = 24_000;

/** AC3 — a body this short (or empty) contributes nothing extra by itself. */
export const MIN_BODY_CHARS_FOR_SUBSTANCE = 30;

/** AC6 — SSRF / cost caps on the whole source-gathering phase. */
export const MAX_FETCHED_SOURCES = 8;
export const MAX_FILE_BYTES = 64 * 1024;
export const MAX_SOURCE_PROMPT_CHARS = 8000;
export const FETCH_TIMEOUT_MS = 5000;
export const TOTAL_SOURCE_PHASE_BUDGET_MS = 15_000;

/** D1 `changed_spec` — auto-included changed doc files (Q6, max 2). */
export const MAX_CHANGED_SPECS = 2;

/** D1 `doc_link`/`repo_doc` — only these extensions are treated as text docs. */
export const ALLOWED_DOC_EXTENSIONS = ['.md', '.mdx', '.txt', '.rst', '.adoc'] as const;

/** D1 `ticket` — Jira-shaped keys, minus common false positives that share the
 *  `[A-Z]+-\d+` shape (unit/spec/version tokens, not ticket keys). */
export const JIRA_KEY_DENYLIST = new Set([
  'UTF',
  'SHA',
  'ISO',
  'RFC',
  'CVE',
  'HTTP',
  'TLS',
  'AES',
  'RSA',
  'ES',
]);

/** D2 — the classifier LLM call itself. */
export const CLASSIFIER_MAX_TOKENS = 800;
export const CLASSIFIER_TIMEOUT_MS = 30_000;
export const CLASSIFIER_MAX_RETRIES = 1;
export const CLASSIFIER_TEMPERATURE = 0;
