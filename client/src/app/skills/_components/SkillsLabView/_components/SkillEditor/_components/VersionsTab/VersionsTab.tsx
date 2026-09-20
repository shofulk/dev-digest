/* VersionsTab — the skill's version history. Every save snapshots the body; each older row
   offers a client-side Diff against the current body and a confirmed Restore (which creates a
   NEW version, never rewriting history). The current row is badged and has no actions. */
"use client";

import React from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { Skill, SkillVersionEntry } from "@devdigest/shared";
import { Badge, Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { useRestoreSkillVersion, useSkillVersions } from "@/lib/hooks/skills";
import { DiffDialog } from "./_components/DiffDialog";
import { RestoreDialog } from "./_components/RestoreDialog";
import { localTimeZone } from "./helpers";
import { s } from "./styles";

export interface VersionsTabProps {
  skill: Skill;
  /** Called after a restore succeeds; SkillEditor lands the user back on Config. */
  onRestored: () => void;
}

export function VersionsTab({ skill, onRestored }: VersionsTabProps) {
  const t = useTranslations("skills");
  const format = useFormatter();
  const timeZone = React.useMemo(() => localTimeZone(), []);
  const { data: versions, isLoading, isError, refetch } = useSkillVersions(skill.id);
  const restore = useRestoreSkillVersion();
  const [diffing, setDiffing] = React.useState<SkillVersionEntry | null>(null);
  const [restoring, setRestoring] = React.useState<SkillVersionEntry | null>(null);

  if (isError) {
    return <ErrorState body={t("versions.loadError")} onRetry={() => refetch()} />;
  }

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <h3 style={s.title}>{t("versions.title")}</h3>
        {versions && <Badge mono>{t("versions.count", { count: versions.length })}</Badge>}
      </div>
      <p style={s.intro}>{t("versions.intro")}</p>

      {isLoading || !versions ? (
        <div style={s.skeletons} aria-busy="true">
          <Skeleton height={44} />
          <Skeleton height={44} />
          <Skeleton height={44} />
        </div>
      ) : versions.length === 0 ? (
        <EmptyState title={t("versions.empty.title")} body={t("versions.empty.body")} />
      ) : (
        <ul style={s.list} aria-label={t("versions.title")}>
          {versions.map((v, i) => (
            <li key={v.version} style={s.row(i === versions.length - 1)}>
              <Badge mono>{t("versions.chip", { version: v.version })}</Badge>
              <span style={s.note} title={v.note ?? undefined}>
                {v.note ? v.note : <span style={s.noNote}>{t("versions.noNote")}</span>}
              </span>
              <time style={s.date} dateTime={v.created_at}>
                {format.dateTime(new Date(v.created_at), { dateStyle: "medium", timeStyle: "short", timeZone })}
              </time>
              {v.is_current ? (
                <Badge color="var(--ok)" bg="var(--ok-bg)">
                  {t("versions.current")}
                </Badge>
              ) : (
                <div style={s.actions}>
                  <Button
                    kind="ghost"
                    size="sm"
                    icon="Eye"
                    aria-label={t("versions.diffLabel", { version: v.version })}
                    onClick={() => setDiffing(v)}
                  >
                    {t("versions.diff")}
                  </Button>
                  <Button
                    kind="ghost"
                    size="sm"
                    icon="History"
                    aria-label={t("versions.restoreLabel", { version: v.version })}
                    onClick={() => setRestoring(v)}
                  >
                    {t("versions.restore")}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {diffing && (
        <DiffDialog
          skillId={skill.id}
          version={diffing.version}
          currentVersion={skill.version}
          currentBody={skill.body}
          onClose={() => setDiffing(null)}
        />
      )}
      {restoring && (
        <RestoreDialog
          version={restoring.version}
          nextVersion={skill.version + 1}
          pending={restore.isPending}
          failed={restore.isError}
          onCancel={() => {
            restore.reset();
            setRestoring(null);
          }}
          onConfirm={() =>
            restore.mutate(
              { id: skill.id, version: restoring.version },
              {
                onSuccess: () => {
                  setRestoring(null);
                  onRestored();
                },
              },
            )
          }
        />
      )}
    </div>
  );
}
