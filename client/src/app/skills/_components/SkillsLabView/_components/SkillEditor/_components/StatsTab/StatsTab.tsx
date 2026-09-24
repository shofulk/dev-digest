/* StatsTab — how a skill is used and what came of it: four tiles, the agents that use it and
   a findings-by-category donut. Every number is attributed per RUN over 30 days (a finding is
   counted for each skill that was in its run's prompt) — the captions say so, and nothing
   here claims one skill caused a finding. A never-used skill is all zeros and two empty
   panels ("no data yet"), not an error. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { Skill } from "@devdigest/shared";
import { CircularScore, ErrorState, Skeleton } from "@devdigest/ui";
import { toPercent } from "@/components/skill-ui";
import { useSkillStats } from "@/lib/hooks/skills";
import { AgentsPanel } from "./_components/AgentsPanel";
import { CategoryPanel } from "./_components/CategoryPanel";
import { StatTile } from "./_components/StatTile";
import { s } from "./styles";

export interface StatsTabProps {
  skill: Skill;
}

export function StatsTab({ skill }: StatsTabProps) {
  const t = useTranslations("skills");
  const { data: stats, isLoading, isError, refetch } = useSkillStats(skill.id);

  if (isError) {
    return <ErrorState body={t("stats.loadError")} onRetry={() => refetch()} />;
  }
  if (isLoading || !stats) {
    return (
      <div style={s.wrap} aria-busy="true">
        <div style={s.tiles}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={104} />
          ))}
        </div>
        <div style={s.panels}>
          <Skeleton height={220} />
          <Skeleton height={220} />
        </div>
      </div>
    );
  }

  const pull = toPercent(stats.pull_rate);
  const accept = toPercent(stats.accept_rate);

  return (
    <div style={s.wrap}>
      <div style={s.tiles}>
        <StatTile
          label={t("stats.tiles.usedBy.label")}
          value={t("stats.tiles.usedBy.value", { count: stats.agent_count })}
          caption={t("stats.tiles.usedBy.caption")}
        />
        <StatTile
          label={t("stats.tiles.pull.label")}
          value={`${pull}%`}
          caption={t("stats.tiles.pull.caption")}
        />
        <StatTile
          label={t("stats.tiles.accept.label")}
          value={`${accept}%`}
          caption={t("stats.tiles.accept.caption")}
          aside={<CircularScore score={accept} size={44} />}
        />
        <StatTile
          label={t("stats.tiles.findings.label")}
          value={String(stats.findings_30d)}
          caption={t("stats.tiles.findings.caption")}
        />
      </div>
      <div style={s.panels}>
        <AgentsPanel agents={stats.agents} />
        <CategoryPanel byCategory={stats.by_category} />
      </div>
    </div>
  );
}
