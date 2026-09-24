/* SkillList — left pane of the Skills Lab: heading, `Add Skill` dropdown, search and
   the card list (loading / error / empty / no-match states). The card's enabled toggle
   writes optimistically and never changes the selection. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Dropdown, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { useSkills, useUpdateSkill } from "@/lib/hooks/skills";
import { notify } from "@/lib/toast";
import { SkillCard } from "./_components/SkillCard";
import { SKELETON_COUNT, SKELETON_HEIGHT } from "./constants";
import { filterSkills } from "./helpers";
import { s } from "./styles";

export function SkillList({
  selectedId,
  onSelect,
  onCreate,
  onImport,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onImport: () => void;
}) {
  const t = useTranslations("skills");
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const update = useUpdateSkill();
  const [search, setSearch] = React.useState("");

  const list = filterSkills(skills ?? [], search);
  const workspaceEmpty = !isLoading && !isError && (skills?.length ?? 0) === 0;
  const noMatch = !isLoading && !isError && !workspaceEmpty && list.length === 0;

  return (
    <div style={s.column}>
      <div style={s.head}>
        <div style={s.titleRow}>
          <h1 style={s.h1}>{t("page.heading")}</h1>
          <Dropdown
            width={210}
            align="right"
            trigger={
              <Button kind="primary" size="sm" icon="Plus" iconRight="ChevronDown">
                {t("page.addSkill")}
              </Button>
            }
            items={[
              { label: t("page.menu.create"), icon: "Edit", onClick: onCreate },
              { label: t("page.menu.fromFile"), icon: "Upload", onClick: onImport },
            ]}
          />
        </div>
        <div style={s.search}>
          <Icon.Search size={13} style={s.searchIcon} />
          <input
            type="search"
            aria-label={t("page.searchLabel")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("page.searchPlaceholder")}
            style={s.searchInput}
          />
        </div>
      </div>

      <div style={s.scroll}>
        {isLoading && (
          <div style={s.skeletons} data-testid="skill-list-skeleton">
            {Array.from({ length: SKELETON_COUNT }, (_, i) => (
              <Skeleton key={i} height={SKELETON_HEIGHT} />
            ))}
          </div>
        )}
        {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}
        {workspaceEmpty && (
          <EmptyState
            icon="Sparkles"
            title={t("page.empty.title")}
            body={t("page.empty.bodyCreate")}
            cta={t("page.empty.ctaCreate")}
            onCta={onCreate}
          />
        )}
        {noMatch && <EmptyState icon="Search" title={t("page.noMatch.title")} body={t("page.noMatch.body")} />}
        {list.map((sk) => (
          <SkillCard
            key={sk.id}
            skill={sk}
            selected={sk.id === selectedId}
            onSelect={() => onSelect(sk.id)}
            onToggle={(enabled) =>
              update.mutate({ id: sk.id, patch: { enabled } }, { onError: () => notify.error(t("card.toggleError")) })
            }
          />
        ))}
      </div>
    </div>
  );
}
