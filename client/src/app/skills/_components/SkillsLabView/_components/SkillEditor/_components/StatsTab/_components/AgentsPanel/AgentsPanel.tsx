/* AgentsPanel — the agents currently linking the skill, each with an Open link to that agent's
   Skills tab. No agents renders an empty state, not an error. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { SkillStats } from "@devdigest/shared";
import { Card, EmptyState, Icon, SectionLabel } from "@devdigest/ui";
import { s } from "./styles";

export function AgentsPanel({ agents }: { agents: SkillStats["agents"] }) {
  const t = useTranslations("skills");
  return (
    <Card>
      <SectionLabel icon="Users">{t("stats.agents.title")}</SectionLabel>
      {agents.length === 0 ? (
        <EmptyState title={t("stats.agents.empty.title")} body={t("stats.agents.empty.body")} />
      ) : (
        <ul style={s.list}>
          {agents.map((a, i) => (
            <li key={a.id} style={s.row(i === agents.length - 1)}>
              <span className="mono" style={s.name}>
                {a.name}
              </span>
              <Link
                href={`/agents/${a.id}?tab=skills`}
                style={s.open}
                aria-label={t("stats.agents.openLabel", { name: a.name })}
              >
                {t("stats.agents.open")}
                <Icon.ArrowRight size={13} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
