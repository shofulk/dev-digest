/* hooks/ci.ts — Export-to-CI hooks: the agent's CI data, the wizard preview and export,
   the CI Runs list, and the on-demand refresh. Types only from @devdigest/shared. */
"use client";

import React from "react";
import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { api } from "../api";
import type {
  CiAgentCi,
  CiExport,
  CiExportInputBody,
  CiPreview,
  CiPreviewInput,
  CiRefreshResult,
  CiRunsList,
} from "@devdigest/shared";

export const ciKeys = {
  agent: (id: string | null | undefined) => ["ci", "agent", id] as const,
  runs: ["ci", "runs"] as const,
  preview: (id: string | null | undefined, input: CiPreviewInput | null) =>
    ["ci", "preview", id, input?.repo_id, input?.triggers, input?.post_as] as const,
};

/** The agent's installations (with their newest run) and its last runs. */
export function useCiAgent(id: string | null | undefined) {
  return useQuery({
    queryKey: ciKeys.agent(id),
    queryFn: () => api.get<CiAgentCi>(`/agents/${id}/ci`),
    enabled: !!id,
  });
}

/** The bundle files for a repository + options; no model call, nothing written. */
export function useCiPreview(id: string | null | undefined, input: CiPreviewInput | null) {
  return useQuery({
    queryKey: ciKeys.preview(id, input),
    queryFn: () => api.post<CiPreview>(`/agents/${id}/ci/preview`, input),
    enabled: !!id && !!input,
  });
}

export function useExportCi(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CiExportInputBody) => api.post<CiExport>(`/agents/${id}/export-ci`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ciKeys.agent(id) });
      qc.invalidateQueries({ queryKey: ciKeys.runs });
    },
  });
}

/** The workspace's latest CI runs. */
export function useCiRuns() {
  return useQuery({
    queryKey: ciKeys.runs,
    queryFn: () => api.get<CiRunsList>("/ci/runs"),
  });
}

/** Pulls finished CI results on mount (and on `refresh()`), then reloads `invalidate`
 *  even when the refresh fails — the stored data is still shown. */
export function useCiRefresh(invalidate: QueryKey[]) {
  const qc = useQueryClient();
  const keys = React.useRef(invalidate);
  keys.current = invalidate;
  const mutation = useMutation({
    mutationFn: () => api.post<CiRefreshResult>("/ci/refresh"),
    onSettled: () => {
      for (const queryKey of keys.current) qc.invalidateQueries({ queryKey });
    },
  });
  const { mutate } = mutation;
  const started = React.useRef(false);
  React.useEffect(() => {
    if (started.current) return;
    started.current = true;
    mutate();
  }, [mutate]);
  const refresh = React.useCallback(() => mutate(), [mutate]);
  return { refresh, result: mutation.data ?? null, isRefreshing: mutation.isPending };
}
