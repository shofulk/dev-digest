/* hooks/blast.ts — plain TanStack Query, no effect (D6: blast depends on the
   index and PR files, not on review runs, so it is never invalidated on
   run settle). */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { BlastRadiusResponse } from "@devdigest/shared";

/** Blast-radius data for a PR's Overview tab (AC1, AC5). Index-only, no LLM
 *  call server-side. */
export function useBlastRadius(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["blast", prId],
    queryFn: () => api.get<BlastRadiusResponse>(`/pulls/${prId}/blast`),
    enabled: !!prId,
  });
}
