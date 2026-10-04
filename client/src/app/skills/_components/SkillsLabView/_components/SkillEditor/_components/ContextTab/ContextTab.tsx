/* ContextTab — skill Context tab (D11/S26). "Project context to use": the documents
   attached here are inherited by every agent that includes this skill. Shares the agent
   tab's picker and strings (the "context" namespace); adds the title, inheritance note and
   the "Serializes as" preview that is this tab's own (AC-18, AC-19). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { Skill } from "@devdigest/shared";
import { ContextDocPicker, attachedTokens, buildAttachRows, serializeAs } from "@/components/context-docs";
import { useContextDocs, useSetSkillContextDocs } from "@/lib/hooks/context";
import { useActiveRepo } from "@/lib/repo-context";
import { s } from "./styles";

export interface ContextTabProps {
  skill: Skill;
}

export function ContextTab({ skill }: ContextTabProps) {
  const t = useTranslations("skills");
  const { repoId } = useActiveRepo();
  const attached = skill.context_docs ?? [];
  const setDocs = useSetSkillContextDocs(skill.id);
  const docs = useContextDocs(repoId);
  const files = docs.data?.files ?? [];
  const rows = buildAttachRows(files, attached);
  const tokens = attachedTokens(rows);

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("context.title")}</h2>
        <span style={s.count}>{t("context.attachedCount", { count: attached.length })}</span>
      </div>
      <p style={s.hint}>{t("context.inheritNote")}</p>

      <ContextDocPicker repoId={repoId} attached={attached} onChange={(next) => setDocs.mutate(next)} />

      <div style={s.serializeWrap}>
        <h3 style={s.h3}>{t("context.serializesAs")}</h3>
        <pre className="mono" style={s.serializePre}>
          {serializeAs(attached)}
        </pre>
        <span style={s.tokensNote}>{t("context.tokens", { tokens })}</span>
      </div>
    </div>
  );
}
