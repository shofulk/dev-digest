/* hooks/intent.ts — PR intent (AC10): plain TanStack Query, no EventSource/effect
   (client/INSIGHTS.md, 2026-09-20 — keeps the lint warning baseline at 0/13). */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { api } from "../api";
import { notify } from "../toast";
import type { PrIntentRecord, PrIntentResponse } from "@devdigest/shared";

/** The derived intent for a PR, or `null` when never derived. No LLM call. */
export function usePrIntent(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-intent", prId],
    queryFn: () => api.get<PrIntentResponse>(`/pulls/${prId}/intent`).then((r) => r.intent),
    enabled: !!prId,
  });
}

/** Derive (or re-derive) the PR's intent — one classifier call. */
export function useDeriveIntent(prId: string | null | undefined) {
  const qc = useQueryClient();
  const t = useTranslations("prReview");
  return useMutation({
    mutationFn: () => api.post<PrIntentRecord>(`/pulls/${prId}/intent/derive`),
    onSuccess: (record) => qc.setQueryData(["pr-intent", prId], record),
    onError: (err) => notify.error(err instanceof Error ? err.message : t("intent.deriveFailed")),
  });
}
