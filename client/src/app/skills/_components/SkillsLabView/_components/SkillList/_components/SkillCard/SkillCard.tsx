/* SkillCard — one row of the Skills Lab list: mono name, enabled toggle, clamped
   description, type + source badges and the footer `N agents · X% pull · Y% accept`. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle } from "@devdigest/ui";
import type { SkillListItem } from "@devdigest/shared";
import {
  SkillSourceBadge,
  SkillTypeBadge,
  UntrustedBadge,
  isUntrusted,
  toPercent,
} from "@/components/skill-ui";
import { s } from "./styles";

export function SkillCard({
  skill,
  selected,
  onSelect,
  onToggle,
}: {
  skill: SkillListItem;
  selected: boolean;
  onSelect: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const t = useTranslations("skills");
  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onSelect();
        }
      }}
      style={s.card(selected, skill.enabled)}
    >
      <div style={s.headerRow}>
        <span className="mono" style={s.name}>
          {skill.name}
        </span>
        <div onClick={(e) => e.stopPropagation()} style={s.toggle}>
          <Toggle on={skill.enabled} onChange={onToggle} size={14} />
        </div>
      </div>
      <div style={s.description}>{skill.description}</div>
      <div style={s.badgeRow}>
        <SkillTypeBadge type={skill.type} />
        <SkillSourceBadge source={skill.source} />
        {isUntrusted(skill.source) && <UntrustedBadge />}
      </div>
      <div className="tnum" style={s.footer}>
        {t("card.footer", {
          count: skill.agent_count,
          pull: toPercent(skill.pull_rate),
          accept: toPercent(skill.accept_rate),
        })}
      </div>
    </div>
  );
}
