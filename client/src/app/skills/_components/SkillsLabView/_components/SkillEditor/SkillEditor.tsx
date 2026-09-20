/* SkillEditor — right pane of the Skills Lab: header (name, type, version chip, untrusted
   notice, delete) plus the four tabs. The tab bodies come from TAB_COMPONENTS; the unsaved
   body is lifted here so Config can report it and Preview can render it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Icon, Skeleton, Tabs } from "@devdigest/ui";
import { SkillTypeBadge, isUntrusted } from "@/components/skill-ui";
import { ApiError } from "@/lib/api";
import { useDeleteSkill, useSkill } from "@/lib/hooks/skills";
import { DeleteSkillDialog } from "./_components/DeleteSkillDialog";
import { TAB_COMPONENTS, TAB_DEFS, type SkillTab } from "./constants";
import { s } from "./styles";

export function SkillEditor({
  skillId,
  tab,
  onTab,
  onDeleted,
}: {
  skillId: string;
  tab: SkillTab;
  onTab: (tab: SkillTab) => void;
  onDeleted: () => void;
}) {
  const t = useTranslations("skills");
  const { data: skill, isLoading, isError, error, refetch } = useSkill(skillId);
  const del = useDeleteSkill();
  const [confirming, setConfirming] = React.useState(false);
  // Unsaved body + the skill it belongs to: a draft never leaks onto another skill.
  const [draft, setDraft] = React.useState<{ skillId: string; body: string } | null>(null);
  const draftBody = draft && draft.skillId === skillId ? draft.body : null;

  const onDraftBodyChange = React.useCallback(
    (body: string | null) => setDraft(body === null ? null : { skillId, body }),
    [skillId],
  );
  const onRestored = React.useCallback(() => {
    setDraft(null);
    onTab("config");
  }, [onTab]);

  if (isError) {
    const notFound = error instanceof ApiError && error.status === 404;
    return notFound ? (
      <ErrorState title={t("detail.notFound.title")} body={t("detail.notFound.body")} />
    ) : (
      <ErrorState body={t("detail.loadError")} onRetry={() => refetch()} />
    );
  }
  if (isLoading || !skill) {
    return (
      <div style={s.center}>
        <Skeleton height={24} width={240} />
        <Skeleton height={200} />
      </div>
    );
  }

  const tabs = TAB_DEFS.map((d) => ({ key: d.key, label: t(d.labelKey), icon: d.icon }));
  const Body = TAB_COMPONENTS[tab];
  const Config = TAB_COMPONENTS.config;
  const tabProps = { skill, draftBody, onDraftBodyChange, onRestored };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 className="mono" style={s.name}>
          {skill.name}
        </h2>
        <SkillTypeBadge type={skill.type} />
        <Badge mono>{t("preview.version", { version: skill.version })}</Badge>
        <div style={s.spacer}>
          <Button kind="ghost" size="sm" icon="Trash" onClick={() => setConfirming(true)}>
            {t("editor.delete")}
          </Button>
        </div>
      </div>
      {isUntrusted(skill.source) && (
        <div role="note" style={s.notice}>
          <Icon.AlertTriangle size={15} style={s.noticeIcon} />
          <span>{t("preview.untrustedNotice")}</span>
        </div>
      )}
      <Tabs tabs={tabs} value={tab} onChange={(k) => onTab(k as SkillTab)} pad="0 24px" />
      <div style={s.body}>
        {/* Config stays mounted while another tab shows, so edits to name / description /
            type survive a trip to Preview and back; only the body is lifted (for Preview). */}
        <div style={{ display: tab === "config" ? "contents" : "none" }}>
          <Config {...tabProps} />
        </div>
        {tab !== "config" && <Body {...tabProps} />}
      </div>
      {confirming && (
        <DeleteSkillDialog
          name={skill.name}
          pending={del.isPending}
          failed={del.isError}
          onCancel={() => setConfirming(false)}
          onConfirm={() =>
            del.mutate(skill.id, {
              onSuccess: () => {
                setConfirming(false);
                onDeleted();
              },
            })
          }
        />
      )}
    </div>
  );
}
