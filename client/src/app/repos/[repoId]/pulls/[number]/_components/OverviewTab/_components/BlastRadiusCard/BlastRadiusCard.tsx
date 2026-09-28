/* BlastRadiusCard — the Overview tab's "Blast radius" block (AC1-AC5, AC8,
   AC12). Colocated under its only consumer, OverviewTab. Always-expanded
   tree over `GET /pulls/:id/blast`: changed symbols, their callers up to
   `limits.bfs_depth` hops (GitHub-linked file:line), and the HTTP
   endpoints/cron jobs behind those callers. No collapse (O1), no graph (O2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, SectionLabel, Badge, MonoLink, Icon, Skeleton, ErrorState } from "@devdigest/ui";
import type { BlastCaller, DownstreamImpact } from "@devdigest/shared";
import { useBlastRadius } from "@/lib/hooks/blast";
import { blastCounts, callerHref, degradedReasonKey, splitSymbols } from "./helpers";
import { STAT_ICONS } from "./constants";
import { s } from "./styles";

function Summary({ counts }: { counts: ReturnType<typeof blastCounts> }) {
  const t = useTranslations("blast");
  return (
    <div style={s.summary}>
      {STAT_ICONS.map(({ key, icon }) => {
        const I = Icon[icon];
        return (
          <span key={key} style={s.stat}>
            <I size={13} style={s.statIcon} />
            <b className="tnum" style={s.statValue}>
              {counts[key]}
            </b>
            {t(`stat.${key}`)}
          </span>
        );
      })}
    </div>
  );
}

function CallerRow({
  caller,
  repoFullName,
  indexedSha,
  headSha,
}: {
  caller: BlastCaller;
  repoFullName: string | null | undefined;
  indexedSha: string | null | undefined;
  headSha: string;
}) {
  const t = useTranslations("blast");
  const href = callerHref(repoFullName, indexedSha, headSha, caller.file, caller.line);
  const indent = caller.depth === 2;
  return (
    <div style={s.callerRow(indent)}>
      <Icon.CornerDownRight size={13} style={s.callerIcon} />
      <span style={s.callerName}>{caller.name}</span>
      {href ? (
        <MonoLink href={href}>
          {caller.file}:{caller.line}
        </MonoLink>
      ) : (
        <span className="mono" style={s.callerLocation}>
          {caller.file}:{caller.line}
        </span>
      )}
      {indent && caller.via && <span style={s.viaLabel}>{t("viaCaller", { name: caller.via })}</span>}
    </div>
  );
}

function DownstreamNode({
  d,
  repoFullName,
  indexedSha,
  headSha,
}: {
  d: DownstreamImpact;
  repoFullName: string | null | undefined;
  indexedSha: string | null | undefined;
  headSha: string;
}) {
  const t = useTranslations("blast");
  // Direct callers first (D6); a missing depth renders as direct.
  const callers = [...d.callers].sort((a, b) => (a.depth === 2 ? 1 : 0) - (b.depth === 2 ? 1 : 0));
  return (
    <div style={s.node}>
      <div style={s.nodeHeader}>
        <Icon.Code size={13} style={s.nodeIcon} />
        <span className="mono" style={s.nodeSymbol}>
          {d.symbol}()
        </span>
        <span style={s.nodeCallerCount}>{t("callerCount", { count: d.callers.length })}</span>
      </div>
      {callers.map((c, i) => (
        <CallerRow
          key={`${c.file}-${c.line}-${i}`}
          caller={c}
          repoFullName={repoFullName}
          indexedSha={indexedSha}
          headSha={headSha}
        />
      ))}
      {d.endpoints_affected.length > 0 && (
        <div style={s.badgeRow}>
          {d.endpoints_affected.map((e, i) => (
            <Badge key={i} mono icon="Globe" color="var(--accent-text)" bg="var(--accent-bg)">
              {e}
            </Badge>
          ))}
        </div>
      )}
      {d.crons_affected.length > 0 && (
        <div style={s.badgeRow}>
          {d.crons_affected.map((c, i) => (
            <Badge key={i} mono icon="Clock" color="var(--warn)" bg="var(--warn-bg)">
              {c}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export function BlastRadiusCard({
  prId,
  repoFullName,
  headSha,
}: {
  prId: string | null;
  repoFullName: string | null;
  headSha: string;
}) {
  const t = useTranslations("blast");
  const { data: blast, isLoading, isError, refetch } = useBlastRadius(prId);

  if (!prId || isLoading) {
    return (
      <Card>
        <SectionLabel icon="GitBranch">{t("title")}</SectionLabel>
        <Skeleton height={18} />
        <div style={{ height: 8 }} />
        <Skeleton height={60} />
      </Card>
    );
  }

  if (isError || !blast) {
    return (
      <Card>
        <SectionLabel icon="GitBranch">{t("title")}</SectionLabel>
        <ErrorState title={t("loadError")} onRetry={() => refetch()} />
      </Card>
    );
  }

  const counts = blastCounts(blast);
  const { withCallers, withoutCallers } = splitSymbols(blast);
  const degraded = !!blast.degraded;
  const reasonText = degraded ? t(degradedReasonKey(blast.reason)) : null;

  const noSymbols = !degraded && blast.changed_symbols.length === 0;
  const noDownstream = !degraded && blast.changed_symbols.length > 0 && blast.downstream.length === 0;
  // AC5 — degraded + empty downstream shows only the reason, never "no callers";
  // not-degraded + empty downstream shows only `noDownstream`, not a per-symbol list.
  const showTree = !noSymbols && !noDownstream && !(degraded && blast.downstream.length === 0);

  const maxCallers = blast.limits?.max_callers_per_symbol;
  const capped = maxCallers != null && blast.downstream.some((d) => d.callers.length >= maxCallers);

  return (
    <Card>
      <div style={s.header}>
        <SectionLabel icon="GitBranch">{t("title")}</SectionLabel>
        {degraded && (
          <div style={s.headerActions}>
            <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
              {t("degradedBadge")}
            </Badge>
          </div>
        )}
      </div>

      {reasonText && <div style={s.reasonText}>{reasonText}</div>}

      {noSymbols && <div style={s.emptySummary}>{t("noSymbols")}</div>}

      {noDownstream && (
        <div style={s.emptySummary}>{t("noDownstream", { count: blast.changed_symbols.length })}</div>
      )}

      {showTree && (
        <>
          <Summary counts={counts} />
          <div style={s.tree}>
            {withCallers.map((d, i) => (
              <DownstreamNode
                key={`${d.symbol}-${i}`}
                d={d}
                repoFullName={repoFullName}
                indexedSha={blast.indexed_sha}
                headSha={headSha}
              />
            ))}
          </div>
          {withoutCallers.length > 0 && (
            <div style={s.noCallers}>{t("noCallersFor", { names: withoutCallers.join(", ") })}</div>
          )}
          {capped && maxCallers != null && <div style={s.cappedHint}>{t("callersCapped", { max: maxCallers })}</div>}
        </>
      )}
    </Card>
  );
}

export default BlastRadiusCard;
