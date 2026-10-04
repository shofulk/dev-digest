// RING 1 — pure application constants. No imports.

/** NFR-2 — total model-input token budget for one generation. */
export const BRIEF_INPUT_TOKEN_BUDGET = 8000;
/** NFR-4 — the share of `BRIEF_INPUT_TOKEN_BUDGET` reserved for documents. */
export const BRIEF_DOC_TOKEN_BUDGET = 3000;
/** NFR-3 — cuts applied after grounding (D7). */
export const BRIEF_SUMMARY_MAX_CHARS = 400;
export const BRIEF_MAX_RISKS = 6;
export const BRIEF_MAX_FOCUS = 5;
/** NFR-5 — the one model call has a hard wall-clock timeout, no job retries. */
export const BRIEF_MODEL_TIMEOUT_MS = 90_000;
/** Schema-repair reprompts the LLM adapter is allowed inside the single call. */
export const BRIEF_MAX_SCHEMA_REPAIRS = 1;
/** `completeStructured({ schemaName })` — identifies the tool/json_schema. */
export const BRIEF_SCHEMA_NAME = 'PrBriefDraft';

// ---- D8 — fixed job error codes/messages. Raw error text is never sent or logged. ----
export const BRIEF_ERROR_MODEL_TIMEOUT = 'model_timeout';
export const BRIEF_ERROR_MODEL_TIMEOUT_MESSAGE = 'The model did not answer within 90 seconds.';
export const BRIEF_ERROR_MODEL_FAILED = 'model_failed';
export const BRIEF_ERROR_MODEL_FAILED_MESSAGE = 'The model request failed or returned invalid output.';
export const BRIEF_ERROR_BRIEF_FAILED = 'brief_failed';
export const BRIEF_ERROR_BRIEF_FAILED_MESSAGE = 'The brief could not be generated.';
