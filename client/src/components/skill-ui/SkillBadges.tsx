/* Type / source / untrusted badges shared by the Skills Lab card, the editor header and
   the agent Skills tab. Labels come from the `skills` message namespace. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { SkillSource, SkillType } from "@devdigest/shared";
import { SOURCE_ICONS, TYPE_COLORS } from "./constants";

export function SkillTypeBadge({ type }: { type: SkillType }) {
  const t = useTranslations("skills");
  const c = TYPE_COLORS[type];
  return (
    <Badge color={c.color} bg={c.bg}>
      {t(`listItem.type.${type}`)}
    </Badge>
  );
}

export function SkillSourceBadge({ source }: { source: SkillSource }) {
  const t = useTranslations("skills");
  return (
    <Badge icon={SOURCE_ICONS[source]} color="var(--text-secondary)">
      {t(`listItem.source.${source}`)}
    </Badge>
  );
}

/** "needs vetting" — rendered by callers only when `isUntrusted(source)`. */
export function UntrustedBadge() {
  const t = useTranslations("skills");
  return (
    <span title={t("listItem.vettingTitle")}>
      <Badge icon="AlertTriangle" color="var(--warn)" bg="var(--warn-bg)">
        {t("listItem.needsVetting")}
      </Badge>
    </span>
  );
}
