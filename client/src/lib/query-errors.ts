/* query-errors.ts — which failed queries raise the global error toast. Plain module,
   used by the QueryCache.onError in providers.tsx (SPEC-04). */

import { ApiError } from "./api";

/** True when a failed query should toast: not when `meta.silentError` is set, else only on a
    network failure or 5xx (the rule providers.tsx applied inline before). */
export function shouldToastQueryError(err: unknown, meta: Record<string, unknown> | undefined): boolean {
  if (meta?.silentError === true) return false;
  const status = err instanceof ApiError ? err.status : 500;
  return status === 0 || status >= 500;
}
