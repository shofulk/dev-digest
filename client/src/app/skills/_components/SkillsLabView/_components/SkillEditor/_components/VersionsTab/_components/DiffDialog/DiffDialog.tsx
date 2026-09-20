/* DiffDialog — a line diff of one historical version against the CURRENT body. Both texts are
   already client-side (the old one via useSkillVersionBody, the current one from the skill),
   so the diff is computed here; the server ships no diff. Additions and deletions are marked
   by a +/− symbol and by colour, never colour alone. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, ErrorState, Modal, Skeleton } from "@devdigest/ui";
import { useSkillVersionBody } from "@/lib/hooks/skills";
import { DIFF_DIALOG_WIDTH, DIFF_SYMBOL } from "../../constants";
import { diffLines, diffStats } from "../../helpers";
import { s } from "./styles";

export function DiffDialog({
  skillId,
  version,
  currentVersion,
  currentBody,
  onClose,
}: {
  skillId: string;
  /** The older version being compared. */
  version: number;
  currentVersion: number;
  currentBody: string;
  onClose: () => void;
}) {
  const t = useTranslations("skills");
  const { data, isLoading, isError, refetch } = useSkillVersionBody(skillId, version);
  const lines = React.useMemo(() => (data ? diffLines(data.body, currentBody) : null), [data, currentBody]);
  const stats = lines ? diffStats(lines) : null;

  return (
    <Modal
      width={DIFF_DIALOG_WIDTH}
      title={t("diff.title", { version, current: currentVersion })}
      subtitle={t("diff.subtitle", { version })}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("diff.close")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        {isError ? (
          <ErrorState body={t("diff.loadError")} onRetry={() => refetch()} />
        ) : isLoading || !lines || !stats ? (
          <div style={s.state} aria-busy="true">
            <Skeleton height={16} />
            <Skeleton height={16} width="80%" />
            <Skeleton height={16} width="60%" />
          </div>
        ) : stats.added === 0 && stats.removed === 0 ? (
          <div style={s.identical}>{t("diff.identical")}</div>
        ) : (
          <>
            <div style={s.summary}>
              <span style={s.added}>{t("diff.added", { count: stats.added })}</span>
              <span style={s.removed}>{t("diff.removed", { count: stats.removed })}</span>
            </div>
            <div className="mono" style={s.code} role="table" aria-label={t("diff.title", { version, current: currentVersion })}>
              {lines.map((l, i) => (
                <div key={i} role="row" data-kind={l.kind} style={s.line(l.kind)}>
                  <span role="cell" style={s.no}>
                    {l.oldNo ?? ""}
                  </span>
                  <span role="cell" style={s.no}>
                    {l.newNo ?? ""}
                  </span>
                  <span role="cell" aria-label={t(`diff.kind.${l.kind}`)} style={s.symbol}>
                    {DIFF_SYMBOL[l.kind]}
                  </span>
                  <span role="cell" style={s.text}>
                    {l.text}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
