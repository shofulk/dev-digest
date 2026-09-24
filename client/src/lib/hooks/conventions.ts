/* hooks/conventions.ts — React Query hooks for the Conventions Extractor.
   A candidate is a PROPOSED house-rule whose evidence the server already verified against
   the checked-out file: the user accepts, rejects or edits each one, and the accepted set
   becomes a skill. Types only from @devdigest/shared — a VALUE import from the barrel 500s
   the dev server (client/INSIGHTS.md, 2026-09-17). */
"use client";

import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE, api } from "../api";
import { notify } from "../toast";
import type {
  ConventionCandidate,
  ConventionExtractResult,
  ConventionSkillDraft,
  ConventionStatus,
  RunEvent,
} from "@devdigest/shared";

/* ---- query keys ---- */

export const conventionKeys = {
  all: ["conventions"] as const,
  list: (repoId: string | null | undefined) => ["conventions", repoId] as const,
};

/** SSE event kinds the scan stream emits as the `event:` name (server sets `event: e.kind`). */
const SCAN_EVENT_KINDS = ["info", "tool", "result", "error"] as const;

/** Payload of the terminal `result` event: `stage: "done"` carries the whole board. */
interface ScanEventData {
  stage?: string;
  result?: ConventionExtractResult;
}

/* ---- reads ---- */

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: conventionKeys.list(repoId),
    queryFn: () => api.get<ConventionCandidate[]>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

/* ---- writes ---- */

export interface ConventionPatch {
  rule?: string;
  rationale?: string | null;
  status?: ConventionStatus;
}

export interface UpdateConventionInput {
  repoId: string;
  id: string;
  patch: ConventionPatch;
}

/**
 * PATCH /conventions/:id — accept / reject / edit. Applied optimistically to every cached
 * board and rolled back on error: triage is a rapid click-through, so a round-trip before
 * the card moves would make the whole page feel broken.
 */
export function useUpdateConvention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateConventionInput) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: conventionKeys.all });
      const lists = qc.getQueriesData<ConventionCandidate[]>({ queryKey: conventionKeys.all });
      for (const [key, rows] of lists) {
        if (!rows) continue;
        qc.setQueryData<ConventionCandidate[]>(
          key,
          rows.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        );
      }
      return { lists };
    },
    onError: (_e, _vars, ctx) => {
      if (!ctx) return;
      for (const [key, rows] of ctx.lists) qc.setQueryData(key, rows);
    },
    // The server row is authoritative (it may normalise the rule or stamp a timestamp).
    onSuccess: (updated) => {
      const lists = qc.getQueriesData<ConventionCandidate[]>({ queryKey: conventionKeys.all });
      for (const [key, rows] of lists) {
        if (!rows) continue;
        qc.setQueryData<ConventionCandidate[]>(
          key,
          rows.map((c) => (c.id === updated.id ? updated : c)),
        );
      }
    },
  });
}

export function useDeleteConvention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { repoId: string; id: string }) =>
      api.del<{ ok: boolean }>(`/conventions/${id}`),
    onSuccess: (_d, { id }) => {
      const lists = qc.getQueriesData<ConventionCandidate[]>({ queryKey: conventionKeys.all });
      for (const [key, rows] of lists) {
        if (!rows) continue;
        qc.setQueryData<ConventionCandidate[]>(
          key,
          rows.filter((c) => c.id !== id),
        );
      }
    },
  });
}

/**
 * Start a scan. Costs a model call, so it is a mutation, never a query — it must not re-run
 * on a refocus. It answers with the scan id only; the candidates arrive over SSE
 * (`useConventionScan`).
 */
export function useScanConventions() {
  return useMutation({
    mutationFn: (repoId: string) =>
      api.post<{ scan_id: string }>(`/repos/${repoId}/conventions/scan`, {}),
  });
}

export interface ConventionScanState {
  /** Live log lines, in arrival order. */
  events: RunEvent[];
  /** True from subscription until the stream ends (done, error or unmount). */
  running: boolean;
  /** The counters strip: what the model proposed vs what the evidence gate let through. */
  result: ConventionExtractResult | null;
}

/**
 * Subscribe to ONE scan's SSE stream. The server sets `event: <kind>`, which means a named
 * listener — not `onmessage` — is what fires in a spec-compliant browser; other clients
 * deliver the same frames as default messages, so both paths are wired and deduped by seq.
 *
 * The recovery rule: the RunBus buffer is process memory, so an API restart mid-scan leaves
 * a stream that yields nothing and never ends. Both `onerror` and the cleanup path therefore
 * invalidate the board — the refetch is what gets the user back to a truthful list. (No
 * `Last-Event-ID`: there is nothing to replay from once the buffer is gone.)
 */
export function useConventionScan(
  scanId: string | null | undefined,
  repoId: string | null | undefined,
): ConventionScanState {
  const qc = useQueryClient();
  const [events, setEvents] = React.useState<RunEvent[]>([]);
  const [result, setResult] = React.useState<ConventionExtractResult | null>(null);
  const [ended, setEnded] = React.useState(false);
  const [shownScanId, setShownScanId] = React.useState(scanId);

  // Reset DURING RENDER, not in the effect. A new scan id makes the previous scan's log and
  // counters stale immediately; resetting in an effect would paint one frame of the old
  // scan's state under the new id first. Same pattern as `useBodyTokens` re-seeding from the
  // saved token count. (It also keeps `react-hooks/set-state-in-effect` quiet honestly,
  // rather than by suppression.)
  if (scanId !== shownScanId) {
    setShownScanId(scanId);
    setEvents([]);
    setResult(null);
    setEnded(false);
  }

  // Derived, never stored: a stream we never opened is not "running", and the only things
  // that stop one are its terminal event, an error, or a missing EventSource.
  const running =
    Boolean(scanId && repoId) && !ended && typeof EventSource !== "undefined";

  React.useEffect(() => {
    if (!scanId || !repoId) return;
    if (typeof EventSource === "undefined") return;
    const key = conventionKeys.list(repoId);

    const es = new EventSource(`${API_BASE}/conventions/scans/${scanId}/events`);
    const seen = new Set<string>();

    const onMsg = (ev: MessageEvent) => {
      let parsed: RunEvent;
      try {
        parsed = JSON.parse(ev.data) as RunEvent;
      } catch {
        return; // keepalive frame / dataless native error event
      }
      const dedupe = `${parsed.kind}:${parsed.seq}`;
      if (seen.has(dedupe)) return;
      seen.add(dedupe);
      setEvents((prev) => [...prev, parsed]);
      if (parsed.kind === "error" && parsed.msg) notify.error(parsed.msg);

      const data = parsed.data as ScanEventData | undefined;
      if (parsed.kind === "result" && data?.stage === "done" && data.result) {
        setResult(data.result);
        qc.setQueryData<ConventionCandidate[]>(key, data.result.candidates);
        setEnded(true);
        es.close();
      }
    };

    es.onmessage = onMsg;
    for (const kind of SCAN_EVENT_KINDS) es.addEventListener(kind, onMsg as EventListener);
    es.onerror = () => {
      es.close();
      setEnded(true);
      qc.invalidateQueries({ queryKey: key });
    };

    // Cleanup does NOT touch `ended` — on a scan-id change the render-time reset has already
    // cleared it, and setting it here would re-end the scan that is just starting.
    return () => {
      es.close();
      qc.invalidateQueries({ queryKey: key });
    };
  }, [scanId, repoId, qc]);

  return { events, running, result };
}

export interface SkillDraftInput {
  repoId: string;
  /** Omitted means "every accepted candidate"; a subset splits one board into several skills. */
  conventionIds?: string[];
}

/**
 * Assemble candidates into a skill draft. Persists NOTHING — the modal edits the draft and
 * `useCreateExtractedSkill` saves it, the same preview-then-confirm flow skill import uses.
 */
export function useSkillDraft() {
  return useMutation({
    mutationFn: ({ repoId, conventionIds }: SkillDraftInput) =>
      api.post<ConventionSkillDraft>(`/repos/${repoId}/conventions/skill`, {
        ...(conventionIds ? { convention_ids: conventionIds } : {}),
      }),
  });
}
