/* RiskAreas — the Intent card's "Risk areas" section (AC-46, AC-48 ff.):
   severity icon, expandable risk rows with file refs that open the Files
   changed tab. Colocated under its only consumer, OverviewTab/IntentCard.
   State comes only from the brief (`usePrBrief`), never from the intent
   (AC-46). Loading gates on `!prId || isPending`, never `isLoading`
   (client/INSIGHTS.md, 2026-10-03 — isLoading renders "ready" for a
   disabled query). Risk title/explanation/ref text are plain text nodes —
   never Markdown/dangerouslySetInnerHTML/MonoLink (AC-69). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, SectionLabel, Skeleton, Button } from "@devdigest/ui";
import { usePrBrief } from "@/lib/hooks/brief";
import { parseFileRef, severityMeta, riskKindIcon, riskKindLabelKey } from "./helpers";
import { s } from "./styles";

export function RiskAreas({
  prId,
  onOpenFile,
}: {
  prId: string | null;
  onOpenFile?: (path: string, line: number | null) => void;
}) {
  const t = useTranslations("brief");
  const { data, isPending, isError, refetch } = usePrBrief(prId);
  const [expanded, setExpanded] = React.useState<Set<number>>(new Set());

  const loading = !prId || isPending;
  const brief = data?.brief ?? null;
  const risks = brief?.risks ?? [];

  const toggle = (i: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <div style={s.section} aria-busy={loading}>
      <SectionLabel icon="AlertTriangle">{t("risks.title")}</SectionLabel>

      {loading ? (
        <Skeleton height={48} />
      ) : isError ? (
        <div style={s.errorRow} role="alert">
          <span>{t("risks.error")}</span>
          <Button kind="secondary" size="sm" onClick={() => refetch()}>
            {t("risks.retry")}
          </Button>
        </div>
      ) : !brief ? (
        <div style={s.hint}>{t("risks.empty")}</div>
      ) : (
        <>
          {data?.outdated && <Badge color="var(--warn)" bg="var(--warn-bg)">{t("risks.outdated")}</Badge>}
          {risks.length === 0 ? (
            <div style={s.hint}>{t("risks.none")}</div>
          ) : (
            <div style={s.list}>
              {risks.map((risk, i) => {
                const meta = severityMeta(risk.severity);
                const KindIcon = Icon[riskKindIcon(risk.kind)];
                const isOpen = expanded.has(i);
                return (
                  <div key={i} style={s.row}>
                    <div style={s.rowHeader}>
                      <KindIcon
                        size={14}
                        role="img"
                        aria-label={t(`risks.severity.${risk.severity}`)}
                        data-risk-kind={risk.kind}
                        style={{ color: meta.c, flexShrink: 0, marginTop: 1 }}
                      />
                      <span style={s.kindLabel}>{t(`risks.kind.${riskKindLabelKey(risk.kind)}`)}</span>
                      <span style={s.title}>{risk.title}</span>
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-label={t("risks.toggle", { title: risk.title })}
                        onClick={() => toggle(i)}
                        style={s.toggleButton}
                      >
                        <Icon.ChevronDown
                          size={14}
                          style={{ transform: isOpen ? "rotate(180deg)" : undefined }}
                        />
                      </button>
                    </div>
                    {isOpen && <div style={s.explanation}>{risk.explanation}</div>}
                    {risk.file_refs.length > 0 && (
                      <div style={s.refs}>
                        {risk.file_refs.map((ref, j) => {
                          const { path, line } = parseFileRef(ref);
                          return (
                            <button
                              key={j}
                              type="button"
                              style={s.refButton}
                              onClick={() => onOpenFile?.(path, line)}
                            >
                              {ref}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
