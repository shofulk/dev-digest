/* hooks/agent-skills.ts — the agent side of the skill link (client/.spec/skills.spec.md, G).
   `GET /agents/:id/skills` returns everything the tab renders in one request; the three
   writes are optimistic and roll back on error. Types only from @devdigest/shared — a VALUE
   import from the barrel 500s the dev server (client/INSIGHTS.md, 2026-09-17). */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { AgentLinkedSkill } from "@devdigest/shared";

export const agentSkillsKey = (agentId: string | null | undefined) =>
  ["agent-skills", agentId] as const;

/** One entry of the whole ordered set `POST /agents/:id/skills` replaces the links with. */
export interface AgentSkillItem {
  skill_id: string;
  enabled: boolean;
}

/** Body of `PUT /agents/:id/skills/:skillId`. */
export interface AgentSkillPatch {
  skillId: string;
  enabled?: boolean;
  order?: number;
}

/** Linked skills of an agent, ordered by `order`. Also feeds the card's `skillCount`. */
export function useAgentSkills(agentId: string | null | undefined) {
  return useQuery({
    queryKey: agentSkillsKey(agentId),
    queryFn: () => api.get<AgentLinkedSkill[]>(`/agents/${agentId}/skills`),
    enabled: !!agentId,
  });
}

/** Re-shape the cached rows to the posted set: array index becomes `order`; ids that are
 *  not in the set are dropped (unlink); ids the cache has never seen (a fresh link) cannot
 *  be rendered without their name, so they wait for the server's response. */
function applyItems(prev: AgentLinkedSkill[], items: AgentSkillItem[]): AgentLinkedSkill[] {
  const byId = new Map(prev.map((r) => [r.skill_id, r]));
  const next: AgentLinkedSkill[] = [];
  items.forEach((it, order) => {
    const row = byId.get(it.skill_id);
    if (row) next.push({ ...row, order, enabled: it.enabled });
  });
  return next;
}

/** Shared key so the three writes can tell whether another one is still in flight. */
const writeKey = (agentId: string) => ["agent-skills-write", agentId] as const;

/** Both writes answer with the whole updated, ordered `AgentLinkedSkill[]`. Adopt it as the
 *  cache — unless a later write is still in flight, whose optimistic state it would clobber
 *  (that write's own response is newer and lands after). */
function useAdoptResponse(agentId: string) {
  const qc = useQueryClient();
  const key = agentSkillsKey(agentId);
  return {
    onSuccess: (data: AgentLinkedSkill[]) => {
      if (qc.isMutating({ mutationKey: writeKey(agentId) }) <= 1) qc.setQueryData(key, data);
    },
    onError: (_e: unknown, _v: unknown, ctx: { previous?: AgentLinkedSkill[] } | undefined) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    // On failure the rollback above is a guess (another write may have landed): re-read.
    onSettled: (_d: unknown, error: unknown) => {
      if (error) qc.invalidateQueries({ queryKey: key });
    },
  };
}

/**
 * Replace the whole ordered set (reorder, link, unlink). The caller must send each row's
 * CURRENT `enabled` — the server preserves it for a link still present, but a client that
 * sends `true` for everything would re-enable skills.
 */
export function useSetAgentSkills(agentId: string) {
  const qc = useQueryClient();
  const key = agentSkillsKey(agentId);
  return useMutation({
    mutationKey: writeKey(agentId),
    mutationFn: (items: AgentSkillItem[]) =>
      api.post<AgentLinkedSkill[]>(`/agents/${agentId}/skills`, { items }),
    onMutate: async (items) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<AgentLinkedSkill[]>(key);
      if (previous) qc.setQueryData<AgentLinkedSkill[]>(key, applyItems(previous, items));
      return { previous };
    },
    ...useAdoptResponse(agentId),
  });
}

/** Patch one link — the checkbox. */
export function useUpdateAgentSkill(agentId: string) {
  const qc = useQueryClient();
  const key = agentSkillsKey(agentId);
  return useMutation({
    mutationKey: writeKey(agentId),
    mutationFn: ({ skillId, ...patch }: AgentSkillPatch) =>
      api.put<AgentLinkedSkill[]>(`/agents/${agentId}/skills/${skillId}`, patch),
    onMutate: async ({ skillId, ...patch }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<AgentLinkedSkill[]>(key);
      if (previous) {
        qc.setQueryData<AgentLinkedSkill[]>(
          key,
          previous
            .map((r) =>
              r.skill_id === skillId
                ? {
                    ...r,
                    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
                    ...(patch.order !== undefined ? { order: patch.order } : {}),
                  }
                : r,
            )
            .sort((a, b) => a.order - b.order),
        );
      }
      return { previous };
    },
    ...useAdoptResponse(agentId),
  });
}

/**
 * Link ONE skill to an agent, appended at the end. Additive on purpose: `useSetAgentSkills`
 * REPLACES the whole ordered set, so using it here would silently unlink everything the
 * agent already had. The server answers with the full new ordered set.
 */
export function useLinkAgentSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, skillId }: { agentId: string; skillId: string }) =>
      api.post<AgentLinkedSkill[]>(`/agents/${agentId}/skills`, { skill_id: skillId }),
    onSuccess: (links, { agentId }) => {
      qc.setQueryData(agentSkillsKey(agentId), links);
      // the skill's `agent_count` in the Skills Lab just changed
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}
