/* hooks/brief.ts — PR Brief (AC-26, AC-30, AC-33): the stored brief is a plain
   TanStack Query (no model call, ever); a generation is a mutation that starts
   a background job; `useBriefJob` subscribes to that job's SSE stream.
   `useBriefJob` resets its state during render (keyed on `(jobId, attempt)` —
   `attempt` from `useGenerateBrief`, needed because the server can reuse a
   running job's id verbatim on Retry/Generate, F22), never in an effect
   (client/INSIGHTS.md, 2026-09-20 — `useConventionScan` precedent), and its
   effect cleanup never flips `done`/`failed` back. Types only from
   @devdigest/shared; a runtime value (e.g. `BriefPhase`) would be imported from
   its contract file directly, never the barrel (client/INSIGHTS.md, 2026-09-17) —
   this file needs none. */
"use client";

import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE, api } from "../api";
import type {
  BriefJobEvent,
  BriefPhase,
  GenerateBriefResponse,
  PrBriefResponse,
} from "@devdigest/shared";

export const briefKeys = {
  brief: (prId: string | null | undefined) => ["pr-brief", prId] as const,
};

export interface UseBriefJobResult {
  phase: BriefPhase | null;
  done: boolean;
  failed: { code: string; message: string } | null;
  running: boolean;
}

/** The stored brief for a PR, its current head SHA, outdated flag, and any
 *  running generation job — or `null`/`null`. No model call (AC-26). */
export function usePrBrief(prId: string | null | undefined) {
  return useQuery<PrBriefResponse>({
    queryKey: briefKeys.brief(prId),
    queryFn: () => api.get<PrBriefResponse>(`/pulls/${prId}/brief`),
    enabled: !!prId,
  });
}

/** Generate (or regenerate, with `force`) the brief for a PR (AC-30, AC-44).
 *
 *  Also returns `attempt`, a counter bumped on every successful resolution of
 *  the generate mutation — including when the server reuses an already-running
 *  job and returns the SAME `job_id` text (F22,
 *  server/src/modules/brief/service.ts:108-109, `GenerateBriefAccepted.reused`).
 *  `jobId` alone cannot signal "subscribe again" in that case, since nothing
 *  about its text changed; `attempt` is the subscription-attempt signal that
 *  `useBriefJob` keys its reset/resubscribe on instead. */
export function useGenerateBrief(prId: string | null | undefined) {
  const qc = useQueryClient();
  const [attempt, setAttempt] = React.useState(0);
  const mutation = useMutation<GenerateBriefResponse, Error, { force?: boolean }>({
    mutationFn: (vars) =>
      api.post<GenerateBriefResponse>(`/pulls/${prId}/brief/generate`, { force: vars.force }),
    onSuccess: (result) => {
      setAttempt((n) => n + 1);
      if ("brief" in result) {
        qc.setQueryData<PrBriefResponse | undefined>(briefKeys.brief(prId), (prev) => ({
          brief: result.brief,
          current_head_sha: prev?.current_head_sha ?? result.brief.head_sha,
          outdated: false,
          job: null,
        }));
      }
    },
  });
  return { ...mutation, attempt };
}

const BRIEF_JOB_EVENT_TYPES = ["phase", "done", "failed"] as const;

/** Subscribe to one generation job's SSE stream (AC-33, AC-35, AC-44).
 *
 *  `attempt` (default 0) is the subscription-attempt signal from
 *  `useGenerateBrief` (F22): the server may return the SAME `job_id` text for
 *  a Retry/Generate issued while a job is already running
 *  (`GenerateBriefAccepted.reused`), so `jobId` text alone cannot be relied on
 *  to signal "open a new subscription". The reset/resubscribe key is the pair
 *  `(jobId, attempt)`, not `jobId` alone. */
export function useBriefJob(
  prId: string | null | undefined,
  jobId: string | null | undefined,
  attempt = 0,
): UseBriefJobResult {
  const qc = useQueryClient();
  const subscriptionKey = jobId ? `${jobId}:${attempt}` : null;
  const [shownKey, setShownKey] = React.useState(subscriptionKey);
  const [phase, setPhase] = React.useState<BriefPhase | null>(null);
  const [done, setDone] = React.useState(false);
  const [failed, setFailed] = React.useState<{ code: string; message: string } | null>(null);

  // Reset DURING RENDER, keyed on (jobId, attempt) — see useConventionScan
  // (client/INSIGHTS.md, 2026-09-20). A new job id, OR a new attempt against
  // the SAME job id (F22, the server's `reused: true` path), makes the
  // previous subscription's phase/done/failed stale immediately.
  if (subscriptionKey !== shownKey) {
    setShownKey(subscriptionKey);
    setPhase(null);
    setDone(false);
    setFailed(null);
  }

  // Derived, never stored: a stream we never opened is not "running".
  const running = Boolean(jobId) && !done && !failed && typeof EventSource !== "undefined";

  React.useEffect(() => {
    if (!prId || !jobId) return;
    if (typeof EventSource === "undefined") return;
    const key = briefKeys.brief(prId);
    const es = new EventSource(`${API_BASE}/pulls/${prId}/brief/jobs/${jobId}/events`);
    const seen = new Set<string>();

    const handle = (raw: string) => {
      if (seen.has(raw)) return;
      seen.add(raw);
      let data: BriefJobEvent;
      try {
        data = JSON.parse(raw) as BriefJobEvent;
      } catch {
        return; // keepalive frame / dataless native error event
      }
      if (data.type === "phase") {
        setPhase(data.phase);
      } else if (data.type === "done") {
        setDone(true);
        es.close();
        qc.invalidateQueries({ queryKey: key });
      } else if (data.type === "failed") {
        setFailed({ code: data.code, message: data.message });
        es.close();
        qc.invalidateQueries({ queryKey: key });
      }
    };

    const onMsg = (ev: MessageEvent) => handle(ev.data as string);
    es.onmessage = onMsg;
    for (const type of BRIEF_JOB_EVENT_TYPES) es.addEventListener(type, onMsg as EventListener);
    // A native `onerror` fires when the stream itself drops (API restart, an
    // evicted job) — never followed by a `done`/`failed` event on the same
    // connection. Without a terminal state here, derived `running` would stay
    // `true` forever and every banner action (Generate/Regenerate/Retry) would
    // stay disabled (AC-33, AC-43). Reach a terminal `failed` state and
    // invalidate the brief query so the server's job/brief state takes over —
    // same shape as `useConventionScan`'s `onerror` (client/INSIGHTS.md). This
    // hook carries no user-facing copy (client/AGENTS.md "User-facing strings
    // live in messages/<locale>/*.json") — `code` alone; the consumer maps it
    // to `banner.streamError` (see BriefBanner.tsx, F19).
    es.onerror = () => {
      es.close();
      setFailed({ code: "stream_error", message: "" });
      qc.invalidateQueries({ queryKey: key });
    };

    // Cleanup does NOT touch `done`/`failed` — on a job-id change the
    // render-time reset has already cleared them.
    return () => {
      for (const type of BRIEF_JOB_EVENT_TYPES) es.removeEventListener(type, onMsg as EventListener);
      es.close();
    };
    // `attempt` is in the deps so a same-text `job_id` reuse (F22) still tears
    // down the old EventSource and opens a new one.
  }, [prId, jobId, attempt, qc]);

  return { phase, done, failed, running };
}
