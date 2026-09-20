/* PreviewTab — the body as the reviewing agent receives it. A dirty body from ConfigTab
   previews the edited text, so the tab answers "what am I about to save". */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { previewBody } from "./helpers";
import { s } from "./styles";

export interface PreviewTabProps {
  skill: Skill;
  /** The unsaved body being edited in ConfigTab, or `null` when there is none — preview it when set. */
  draftBody: string | null;
}

export function PreviewTab({ skill, draftBody }: PreviewTabProps) {
  const t = useTranslations("skills");
  const body = previewBody(skill.body, draftBody);
  return (
    <div style={s.wrap}>
      <h3 style={s.heading}>{t("preview.heading")}</h3>
      <p style={s.caption}>{t("preview.caption")}</p>
      <div style={s.panel} data-testid="skill-preview">
        {body.trim() ? <Markdown>{body}</Markdown> : <p style={s.empty}>{t("preview.emptyBody")}</p>}
      </div>
    </div>
  );
}
