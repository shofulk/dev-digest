/* IntentCard — the derived PR intent (AC10): summary, in/out-of-scope
   columns, confidence chip, sources with missing-context flags, stale badge,
   re-derive action. Colocated under its only consumer, OverviewTab. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, SectionLabel, Badge, Button, Skeleton, ErrorState, EmptyState, Icon } from "@devdigest/ui";
import { usePrIntent, useDeriveIntent } from "@/lib/hooks/intent";
import { confidenceTone, isLowConfidence, isMissingStatus, reasonKey, sourceIcon } from "./helpers";
import { s } from "./styles";

export function IntentCard({ prId }: { prId: string | null }) {
  const t = useTranslations("prReview");
  const { data: intent, isLoading, isError, refetch } = usePrIntent(prId);
  const deriveIntent = useDeriveIntent(prId);

  if (!prId || isLoading) {
    return (
      <Card>
        <SectionLabel icon="Target">{t("intent.title")}</SectionLabel>
        <Skeleton height={18} />
        <div style={{ height: 8 }} />
        <Skeleton height={60} />
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <SectionLabel icon="Target">{t("intent.title")}</SectionLabel>
        <ErrorState title={t("intent.errorTitle")} onRetry={() => refetch()} />
      </Card>
    );
  }

  if (!intent) {
    return (
      <Card>
        <SectionLabel icon="Target">{t("intent.title")}</SectionLabel>
        <EmptyState
          icon="Target"
          title={t("intent.emptyTitle")}
          body={t("intent.emptyBody")}
          cta={t("intent.emptyCta")}
          onCta={() => deriveIntent.mutate()}
          ctaLoading={deriveIntent.isPending}
        />
      </Card>
    );
  }

  const tone = confidenceTone(intent.confidence);
  const low = isLowConfidence(intent.confidence);

  return (
    <Card>
      <div style={s.header}>
        <Icon.Target size={14} style={{ color: "var(--text-muted)" }} />
        <span style={s.title}>{t("intent.title")}</span>
        <div style={s.headerActions}>
          <Badge color={tone.color} bg={tone.bg}>
            {t(`intent.confidence.${intent.confidence}`)}
          </Badge>
          {intent.stale && (
            <Badge color="var(--warn, #d29922)" bg="var(--warn-bg, rgba(210,153,34,.12))" icon="AlertTriangle">
              {t("intent.staleBadge")}
            </Badge>
          )}
          <Button
            kind={intent.stale ? "primary" : "secondary"}
            size="sm"
            icon="RefreshCw"
            loading={deriveIntent.isPending}
            onClick={() => deriveIntent.mutate()}
          >
            {deriveIntent.isPending ? t("intent.deriving") : t("intent.reDerive")}
          </Button>
        </div>
      </div>

      {low && (
        <div style={s.banner}>
          <Icon.Info size={14} />
          {t("intent.lowConfidenceHint")}
        </div>
      )}

      {intent.missing_context && (
        <div style={s.banner}>
          <Icon.AlertTriangle size={14} />
          {t("intent.missingContextBanner")}
        </div>
      )}

      <blockquote style={s.summary}>{intent.intent}</blockquote>

      <div style={s.columns}>
        <div>
          <div style={s.columnLabel}>{t("intent.inScope")}</div>
          <ul style={s.list}>
            {intent.in_scope.map((item, i) => (
              <li key={i} style={s.listItem}>
                <Icon.Check size={14} style={{ color: "var(--good, #3fb950)", flexShrink: 0, marginTop: 2 }} />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div style={s.columnLabel}>{t("intent.outOfScope")}</div>
          <ul style={s.list}>
            {intent.out_of_scope.map((item, i) => (
              <li key={i} style={s.listItem}>
                <Icon.Slash size={14} style={{ color: "var(--text-muted)", flexShrink: 0, marginTop: 2 }} />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {intent.sources.length > 0 && (
        <div>
          <div style={s.columnLabel}>{t("intent.sources")}</div>
          <ul style={s.list}>
            {intent.sources.map((source, i) => {
              const missing = isMissingStatus(source.status);
              const I = Icon[sourceIcon(source.kind)];
              return (
                <li key={i} style={s.sourceRow(missing)}>
                  <I size={13} />
                  <span style={s.sourceRef}>{source.ref}</span>
                  <span>
                    {t(`intent.sourceStatus.${source.status}`)}
                    {missing ? ` — ${t(reasonKey(source.reason))}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div style={s.footer}>
        {intent.model && <span>{t("intent.footerModel", { model: intent.model })}</span>}
        {intent.derived_at && (
          <span>{t("intent.footerDerivedAt", { time: new Date(intent.derived_at).toLocaleString() })}</span>
        )}
      </div>
    </Card>
  );
}
