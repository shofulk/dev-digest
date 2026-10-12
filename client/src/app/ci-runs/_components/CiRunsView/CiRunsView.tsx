/* /ci-runs — CI Runs: the workspace's latest CI reviews, refreshed from GitHub on open. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import { CiRunsTable } from "../../../../components/ci/CiRunsTable";
import { ciKeys, useCiRefresh, useCiRuns } from "../../../../lib/hooks/ci";

const s = {
  page: { padding: "24px 32px 44px", maxWidth: 1100, margin: "0 auto" },
  header: { display: "flex", alignItems: "center", gap: 14, marginBottom: 20 },
  headerText: { flex: 1 },
  h1: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" },
  subtitle: { fontSize: 14, color: "var(--text-secondary)", marginTop: 4 },
  notice: { padding: "10px 14px", borderRadius: 8, background: "var(--warn-bg)", color: "var(--warn)", fontSize: 13, marginBottom: 16 },
} satisfies Record<string, React.CSSProperties>;

export function CiRunsView() {
  const t = useTranslations("ci");
  const { data, isPending, isError, error, refetch } = useCiRuns();
  const { refresh, result, isRefreshing } = useCiRefresh([ciKeys.runs]);
  const items = data?.items ?? [];

  return (
    <AppShell crumb={[{ label: t("page.crumb") }]}>
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>{t("runs.title")}</h1>
            <p style={s.subtitle}>{t("runs.subtitle")}</p>
          </div>
          <Button icon="RefreshCw" onClick={refresh} disabled={isRefreshing}>
            {isRefreshing ? t("runs.refreshing") : t("runs.refresh")}
          </Button>
        </div>
        {result && result.degraded.length > 0 && (
          <div role="status" style={s.notice}>
            {t("runs.degraded", {
              repos: result.degraded.map((d) => d.repo).join(", "),
              reason: [...new Set(result.degraded.map((d) => d.reason))].join(", "),
            })}
          </div>
        )}
        {isPending && <Skeleton height={160} />}
        {isError && <ErrorState body={error.message} onRetry={() => refetch()} />}
        {data && items.length === 0 && (
          <EmptyState icon="Workflow" title={t("runs.emptyTitle")} body={t("runs.emptyBody")} />
        )}
        {items.length > 0 && <CiRunsTable runs={items} />}
      </div>
    </AppShell>
  );
}
