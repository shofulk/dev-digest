/* hooks/context.ts — D11 React Query hooks for Project Context (client/.spec/project-context.spec.md).
   The old file-list query and reindex mutation moved here from hooks/core.ts (no behaviour
   change) so every Project Context hook lives in one file. The two save hooks (agent/skill
   `context_docs`) PUT the ordered path list, apply it optimistically to the matching detail
   cache and roll back + toast on error (D11). Types only from @devdigest/shared — a VALUE
   import from the barrel 500s the dev server (client/INSIGHTS.md, 2026-09-17). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { notify } from "../toast";
import { skillKeys } from "./skills";
import type { Agent, Skill, ContextDocList, ContextDocContent, ContextDocsUpdate, IndexStatus } from "@devdigest/shared";

/** `GET /repos/:id/context` — every `.md` document found under the search roots. */
export function useContextDocs(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["context", repoId],
    queryFn: () => api.get<ContextDocList>(`/repos/${repoId}/context`),
    enabled: !!repoId,
  });
}

/** `GET /repos/:id/context/file?path=` — one document's content, for the Preview action. */
export function useContextDoc(repoId: string | null | undefined, path: string | null | undefined) {
  return useQuery({
    queryKey: ["context-doc", repoId, path],
    queryFn: () =>
      api.get<ContextDocContent>(`/repos/${repoId}/context/file?path=${encodeURIComponent(path!)}`),
    enabled: !!repoId && !!path,
  });
}

export function useReindexContext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) => api.post<IndexStatus>(`/repos/${repoId}/context/reindex`),
    onSuccess: (_d, repoId) => qc.invalidateQueries({ queryKey: ["context", repoId] }),
  });
}

/**
 * `PUT /agents/:id/context-docs` — saves the ordered attached-document path list. Applied
 * optimistically to the cached agent detail; a failed save restores it and toasts the API
 * error message (AC-16).
 */
export function useSetAgentContextDocs(agentId: string | null | undefined) {
  const qc = useQueryClient();
  const key = ["agent", agentId];
  return useMutation({
    mutationFn: (contextDocs: string[]) =>
      api.put<ContextDocsUpdate>(`/agents/${agentId}/context-docs`, { context_docs: contextDocs }),
    onMutate: async (contextDocs) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Agent>(key);
      if (previous) qc.setQueryData<Agent>(key, { ...previous, context_docs: contextDocs });
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData<Agent>(key, ctx.previous);
      notify.toast(err instanceof Error ? err.message : String(err), "error");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
    },
  });
}

/**
 * `PUT /skills/:id/context-docs` — same contract as the agent save, applied to the cached
 * skill detail (AC-14, AC-16).
 */
export function useSetSkillContextDocs(skillId: string | null | undefined) {
  const qc = useQueryClient();
  const key = skillKeys.detail(skillId);
  return useMutation({
    mutationFn: (contextDocs: string[]) =>
      api.put<ContextDocsUpdate>(`/skills/${skillId}/context-docs`, { context_docs: contextDocs }),
    onMutate: async (contextDocs) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Skill>(key);
      if (previous) qc.setQueryData<Skill>(key, { ...previous, context_docs: contextDocs });
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData<Skill>(key, ctx.previous);
      notify.toast(err instanceof Error ? err.message : String(err), "error");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
    },
  });
}
