"use client";

import { useEffect, useState } from "react";
import { useSkillTokens } from "@/lib/hooks/skills";
import { TOKEN_DEBOUNCE_MS } from "./constants";

/** The last saved body and the server's exact count for it, when it has one. */
export interface SavedTokens {
  body: string;
  tokens: number | null | undefined;
}

/**
 * Exact token count of `body`. The count for the saved body is used as-is (no request);
 * any other body is counted with a debounced `POST /skills/tokens`. While a request is in
 * flight the previous count stays; on failure the result is `null` — never `NaN`.
 */
export function useBodyTokens(
  body: string,
  saved?: SavedTokens,
  delay: number = TOKEN_DEBOUNCE_MS,
): number | null {
  const { mutate } = useSkillTokens();
  const known = saved && saved.tokens != null && saved.body === body ? saved.tokens : null;
  const [counted, setCounted] = useState<number | null>(known);
  // Landing on the saved body re-seeds the count, so a later edit keeps showing it (not an older
  // fetched value) until the new one arrives. Adjusted during render, not in an effect.
  const [prevKnown, setPrevKnown] = useState(known);
  if (known !== prevKnown) {
    setPrevKnown(known);
    if (known !== null) setCounted(known);
  }

  useEffect(() => {
    if (known !== null) return;
    const timer = setTimeout(() => {
      mutate(body, {
        onSuccess: (r) => setCounted(typeof r.tokens === "number" && Number.isFinite(r.tokens) ? r.tokens : null),
        onError: () => setCounted(null),
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [body, known, delay, mutate]);

  return known ?? counted;
}
