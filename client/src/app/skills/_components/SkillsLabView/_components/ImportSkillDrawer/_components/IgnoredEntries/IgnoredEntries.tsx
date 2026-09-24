/* The archive entries the importer left out, each with its reason. Executable entries say
   plainly they were not read and not run. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { SkillImportPreview } from "@devdigest/shared";
import { s } from "./styles";

export function IgnoredEntries({ ignored }: { ignored: SkillImportPreview["ignored"] }) {
  const t = useTranslations("skills");
  if (ignored.length === 0) return null;
  return (
    <section style={s.wrap} aria-label={t("drawer.ignored.title", { count: ignored.length })}>
      <h3 style={s.title}>{t("drawer.ignored.title", { count: ignored.length })}</h3>
      <p style={s.hint}>{t("drawer.ignored.hint")}</p>
      <ul style={s.list}>
        {ignored.map((entry) => (
          <li key={`${entry.path}:${entry.reason}`} style={s.row}>
            <span className="mono" style={s.path}>
              {entry.path}
            </span>
            <span style={entry.reason === "executable" ? s.reasonExecutable : s.reason}>
              {t(`drawer.ignored.reason.${entry.reason}`)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
