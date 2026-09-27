/* hooks/smart-diff.ts — plain TanStack Query, no EventSource/effect
   (client/INSIGHTS.md, 2026-09-20 — keeps the lint warning baseline at 0/13). */
"use client";

import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { SmartDiffResponse } from "@devdigest/shared";

/** Role-grouped Files-changed data for a PR (AC1, AC5). Deterministic, no LLM
 *  call server-side; findings/dots are overlaid client-side from `usePrReviews`. */
export function useSmartDiff(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["smart-diff", prId],
    queryFn: () => api.get<SmartDiffResponse>(`/pulls/${prId}/smart-diff`),
    enabled: !!prId,
  });
}

/**
 * D6 — on a `running: true -> false` transition, refresh the review data
 * Smart Diff overlays and the grouping/finding-lines it reads, independent of
 * which tab is open (`FindingsTab.onRunDone` only fires while it is mounted).
 * State-free: the previous value is tracked in a ref, and the effect only
 * ever calls `invalidateQueries` (client/INSIGHTS.md, 2026-09-20 — a state
 * reset inside the effect trips `react-hooks/set-state-in-effect`).
 */
export function useInvalidateOnRunSettle(prId: string | null | undefined, running: boolean) {
  const qc = useQueryClient();
  const wasRunningRef = React.useRef(running);
  React.useEffect(() => {
    if (wasRunningRef.current && !running && prId) {
      qc.invalidateQueries({ queryKey: ["reviews", prId] });
      qc.invalidateQueries({ queryKey: ["pr-runs", prId] });
      qc.invalidateQueries({ queryKey: ["smart-diff", prId] });
    }
    wasRunningRef.current = running;
  }, [running, prId, qc]);
}
