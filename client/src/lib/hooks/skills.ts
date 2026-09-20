/* hooks/skills.ts — React Query hooks for the Skills Lab (see client/.spec/skills.spec.md).
   The agent-side link hooks (useAgentSkills, useSetAgentSkills, useUpdateAgentSkill) live in
   ./agent-skills.ts. Types only from @devdigest/shared — a VALUE import from the barrel
   500s the dev server (client/INSIGHTS.md, 2026-09-17). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  Skill,
  SkillImportPreview,
  SkillListItem,
  SkillStats,
  SkillType,
  SkillVersionEntry,
} from "@devdigest/shared";

/* ---- query keys (exported so other hooks/components can invalidate) ---- */

export const skillKeys = {
  all: ["skills"] as const,
  list: (params?: SkillsParams) => ["skills", "list", params?.q ?? "", params?.type ?? ""] as const,
  detail: (id: string | null | undefined) => ["skill", id] as const,
  stats: (id: string | null | undefined) => ["skill", id, "stats"] as const,
  versions: (id: string | null | undefined) => ["skill", id, "versions"] as const,
  versionBody: (id: string | null | undefined, version: number | null | undefined) =>
    ["skill", id, "versions", version] as const,
};

export interface SkillsParams {
  q?: string;
  type?: SkillType;
}

/** GET /skills/:id/versions/:version — the body of one historical version. */
export interface SkillVersionBody {
  version: number;
  body: string;
  note?: string | null;
  created_at?: string;
}

function toQuery(params?: SkillsParams): string {
  const sp = new URLSearchParams();
  if (params?.q) sp.set("q", params.q);
  if (params?.type) sp.set("type", params.type);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

/* ---- reads ---- */

export function useSkills(params?: SkillsParams) {
  return useQuery({
    queryKey: skillKeys.list(params),
    queryFn: () => api.get<SkillListItem[]>(`/skills${toQuery(params)}`),
  });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: skillKeys.detail(id),
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

export function useSkillStats(id: string | null | undefined) {
  return useQuery({
    queryKey: skillKeys.stats(id),
    queryFn: () => api.get<SkillStats>(`/skills/${id}/stats`),
    enabled: !!id,
  });
}

export function useSkillVersions(id: string | null | undefined) {
  return useQuery({
    queryKey: skillKeys.versions(id),
    queryFn: () => api.get<SkillVersionEntry[]>(`/skills/${id}/versions`),
    enabled: !!id,
  });
}

export function useSkillVersionBody(
  id: string | null | undefined,
  version: number | null | undefined
) {
  return useQuery({
    queryKey: skillKeys.versionBody(id, version),
    queryFn: () => api.get<SkillVersionBody>(`/skills/${id}/versions/${version}`),
    enabled: !!id && version != null,
    // a version is immutable
    staleTime: Infinity,
  });
}

/* ---- writes ---- */

export interface CreateSkillInput {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  enabled?: boolean;
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) => api.post<Skill>("/skills", input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: skillKeys.all });
      qc.setQueryData(skillKeys.detail(data.id), data);
    },
  });
}

export interface UpdateSkillInput {
  id: string;
  patch: Partial<Pick<Skill, "name" | "description" | "type" | "body" | "enabled">> & {
    /** Change note stored with the snapshot when `body` changes. */
    note?: string;
  };
}

/** Drop every cached view of a skill that a body change / restore makes stale. */
function invalidateSkill(qc: ReturnType<typeof useQueryClient>, id: string) {
  qc.invalidateQueries({ queryKey: skillKeys.all });
  qc.invalidateQueries({ queryKey: skillKeys.versions(id) });
  qc.invalidateQueries({ queryKey: skillKeys.stats(id) });
}

/**
 * PUT /skills/:id. A patch carrying `enabled` is applied optimistically to every cached
 * skills list (and the detail) and rolled back on error — the card toggle uses it.
 */
export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSkillInput) => api.put<Skill>(`/skills/${id}`, patch),
    onMutate: async ({ id, patch }) => {
      if (patch.enabled === undefined) return undefined;
      await qc.cancelQueries({ queryKey: skillKeys.all });
      const lists = qc.getQueriesData<SkillListItem[]>({ queryKey: ["skills", "list"] });
      const detail = qc.getQueryData<Skill>(skillKeys.detail(id));
      for (const [key, rows] of lists) {
        if (!rows) continue;
        qc.setQueryData<SkillListItem[]>(
          key,
          rows.map((r) => (r.id === id ? { ...r, enabled: patch.enabled! } : r))
        );
      }
      if (detail) qc.setQueryData<Skill>(skillKeys.detail(id), { ...detail, enabled: patch.enabled });
      return { lists, detail };
    },
    onError: (_e, { id }, ctx) => {
      if (!ctx) return;
      for (const [key, rows] of ctx.lists) qc.setQueryData(key, rows);
      if (ctx.detail) qc.setQueryData(skillKeys.detail(id), ctx.detail);
    },
    onSuccess: (data, { id, patch }) => {
      qc.setQueryData(skillKeys.detail(id), data);
      if (patch.body !== undefined) invalidateSkill(qc, id);
      else qc.invalidateQueries({ queryKey: skillKeys.all });
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/skills/${id}`),
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: skillKeys.detail(id) });
      qc.invalidateQueries({ queryKey: skillKeys.all });
      // deleting a skill unlinks it from every agent
      qc.invalidateQueries({ queryKey: ["agent-skills"] });
    },
  });
}

export interface RestoreSkillInput {
  id: string;
  version: number;
}

export function useRestoreSkillVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: RestoreSkillInput) =>
      api.post<Skill>(`/skills/${id}/versions/${version}/restore`),
    onSuccess: (data, { id }) => {
      qc.setQueryData(skillKeys.detail(id), data);
      invalidateSkill(qc, id);
    },
  });
}

/** POST /skills/tokens — exact token count of an unsaved body; `tokens` is null on failure. Debounce in the consumer. */
export function useSkillTokens() {
  return useMutation({
    mutationFn: (body: string) => api.post<{ tokens: number | null }>("/skills/tokens", { body }),
  });
}

/* ---- import ---- */

export interface ImportPreviewInput {
  filename: string;
  content_base64: string;
}

/** POST /skills/import/preview — writes nothing. */
export function useImportPreview() {
  return useMutation({
    mutationFn: (input: ImportPreviewInput) =>
      api.post<SkillImportPreview>("/skills/import/preview", input),
  });
}

export interface ImportSkillInput {
  name: string;
  description: string;
  type: SkillType;
  body: string;
}

/** POST /skills/import — confirms a (possibly edited) preview; the skill arrives disabled. */
export function useImportSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportSkillInput) => api.post<Skill>("/skills/import", input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: skillKeys.all });
      qc.setQueryData(skillKeys.detail(data.id), data);
    },
  });
}
