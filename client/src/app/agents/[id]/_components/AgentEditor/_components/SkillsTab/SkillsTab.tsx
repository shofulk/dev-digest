"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Icon, SearchableSelect, Skeleton } from "@devdigest/ui";
import type { AgentLinkedSkill } from "@devdigest/shared";
import { useAgentSkills, useSetAgentSkills, useUpdateAgentSkill } from "@/lib/hooks/agent-skills";
import { useSkills } from "@/lib/hooks/skills";
import { SKILLS_LAB_HREF } from "./constants";
import { countEnabled, filterLinks, reorderBy, reorderTo, sortByOrder, toSetItems, unlinkedSkills } from "./helpers";
import { SkillRow } from "./_components/SkillRow";
import { s } from "./styles";

/** Skills tab — links, enables and orders the skills of one agent (order = prompt order). */
export function SkillsTab({ agentId }: { agentId: string }) {
  const t = useTranslations("agents");
  const router = useRouter();
  const linked = useAgentSkills(agentId);
  const workspace = useSkills();
  const setSkills = useSetAgentSkills(agentId);
  const updateSkill = useUpdateAgentSkill(agentId);

  const [filter, setFilter] = React.useState("");
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overId, setOverId] = React.useState<string | null>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const focusAfter = React.useRef<string | null>(null);

  const links = sortByOrder(linked.data ?? []);
  const visible = filterLinks(links, filter);
  const { enabled, total } = countEnabled(links);
  // A reorder inside a filtered view would be relative to a partial list — pause it.
  const canReorder = filter.trim() === "";
  const addable = unlinkedSkills(workspace.data ?? [], links);

  // A moved row is re-inserted by the browser and loses focus; hand it back after the reorder.
  React.useEffect(() => {
    const id = focusAfter.current;
    if (!id) return;
    focusAfter.current = null;
    listRef.current?.querySelector<HTMLElement>(`[data-skill-id="${id}"]`)?.focus();
  }, [linked.data]);

  const commit = (next: AgentLinkedSkill[] | null) => {
    if (next) setSkills.mutate(toSetItems(next));
  };
  const endDrag = () => {
    setDragId(null);
    setOverId(null);
  };

  if (linked.isLoading) {
    return (
      <div style={s.wrap}>
        <div style={s.skeletons}>
          <Skeleton height={40} />
          <Skeleton height={40} />
          <Skeleton height={40} />
        </div>
      </div>
    );
  }
  if (linked.isError) {
    return (
      <div style={s.wrap}>
        <ErrorState body={t("skills.loadError")} onRetry={() => linked.refetch()} />
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("skills.title")}</h2>
        <span style={s.count}>{t("skills.enabledCount", { linked: enabled, total })}</span>
        <div style={s.addWrap}>
          {workspace.data && workspace.data.length > 0 && addable.length === 0 ? (
            <span style={s.count}>{t("skills.allLinked")}</span>
          ) : (
            <SearchableSelect
              value=""
              options={addable.map((sk) => ({ value: sk.id, label: sk.name }))}
              placeholder={t("skills.addPlaceholder")}
              onChange={(skillId) => setSkills.mutate([...toSetItems(links), { skill_id: skillId, enabled: true }])}
            />
          )}
        </div>
      </div>
      <p style={s.hint}>{t("skills.orderHint")}</p>

      {links.length === 0 ? (
        <EmptyState
          icon="Sparkles"
          title={t("skills.emptyTitle")}
          body={t("skills.emptyBody")}
          cta={t("skills.emptyCta")}
          onCta={() => router.push(SKILLS_LAB_HREF)}
        />
      ) : (
        <>
          <div style={s.filterWrap}>
            <Icon.Search size={13} style={s.filterIcon} />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("skills.filterPlaceholder")}
              aria-label={t("skills.filterPlaceholder")}
              style={s.filterInput}
            />
          </div>
          {visible.length === 0 ? (
            <div style={s.noMatches}>{t("skills.noMatches")}</div>
          ) : (
            <ul ref={listRef} style={s.list} aria-label={t("skills.title")}>
              {visible.map((link) => (
                <SkillRow
                  key={link.skill_id}
                  link={link}
                  canReorder={canReorder}
                  dragging={dragId === link.skill_id}
                  dropTarget={overId === link.skill_id && dragId !== link.skill_id}
                  onToggle={(next) => updateSkill.mutate({ skillId: link.skill_id, enabled: next })}
                  onUnlink={() => commit(links.filter((l) => l.skill_id !== link.skill_id))}
                  onMove={(delta) => {
                    const next = reorderBy(links, link.skill_id, delta);
                    if (next) focusAfter.current = link.skill_id;
                    commit(next);
                  }}
                  onDragStart={() => setDragId(link.skill_id)}
                  onDragEnter={() => dragId && setOverId(link.skill_id)}
                  onDrop={() => {
                    if (dragId) commit(reorderTo(links, dragId, link.skill_id));
                    endDrag();
                  }}
                  onDragEnd={endDrag}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
