/* /eval — Eval Dashboard. One row per agent that has eval cases (latest recall / precision /
   citation, version, passed/total, recall sparkline) linking into that agent's Evals tab,
   plus the most recent suite runs across all agents. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Skeleton, Sparkline } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { formatCost } from "@/lib/format-cost";
import { formatMetric } from "@/lib/eval-metrics";
import { useEvalDashboard } from "@/lib/hooks/eval";
import { s } from "./styles";

export function EvalDashboardView() {
  const t = useTranslations("eval");
  const { data, isLoading, isError, refetch } = useEvalDashboard();
  const crumb = [{ label: t("page.crumbSkillsLab") }, { label: t("page.crumbEvalDashboard") }];

  let body: React.ReactNode;
  if (isLoading) {
    body = (
      <div style={s.skeletons}>
        <Skeleton height={36} />
        <Skeleton height={36} />
        <Skeleton height={36} />
      </div>
    );
  } else if (isError || !data) {
    body = <ErrorState title={t("dashboard.loadFailed")} onRetry={() => refetch()} />;
  } else if (data.agents.length === 0) {
    body = <EmptyState icon="Gauge" title={t("dashboard.empty")} />;
  } else {
    body = (
      <>
        <section>
          <h2 style={s.h2}>{t("dashboard.agents")}</h2>
          <table style={s.table}>
            <thead>
              <tr>
                {(["agent", "version", "recall", "precision", "citation", "passed", "trend"] as const).map((k) => (
                  <th key={k} style={s.th}>
                    {t(`dashboard.columns.${k}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.agents.map((a) => {
                const recalls = a.trend.map((p) => p.recall).filter((v): v is number => v != null);
                return (
                  <tr key={a.agent_id}>
                    <td style={s.td}>
                      <Link href={`/agents/${a.agent_id}?tab=evals`} style={s.link}>
                        {a.name}
                      </Link>
                      <div className="mono" style={s.model}>
                        {a.model}
                      </div>
                    </td>
                    <td style={s.td}>{a.latest ? `v${a.latest.agent_version}` : "—"}</td>
                    <td style={s.td}>{formatMetric(a.latest?.recall)}</td>
                    <td style={s.td}>{formatMetric(a.latest?.precision)}</td>
                    <td style={s.td}>{formatMetric(a.latest?.citation_accuracy)}</td>
                    <td style={s.td}>
                      {a.latest ? `${a.latest.traces_passed}/${a.latest.traces_total}` : "—"}
                    </td>
                    <td style={s.td}>{recalls.length >= 2 && <Sparkline data={recalls} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section>
          <h2 style={s.h2}>{t("dashboard.recentRuns")}</h2>
          {data.recent_runs.length === 0 ? (
            <div style={s.model}>{t("dashboard.noRuns")}</div>
          ) : (
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>{t("dashboard.columns.agent")}</th>
                  {(["time", "version", "recall", "precision", "citation", "passed", "cost"] as const).map((k) => (
                    <th key={k} style={s.th}>
                      {t(`suite.columns.${k}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.recent_runs.map((r) => (
                  <tr key={r.run_id}>
                    <td style={s.td}>{r.agent_name}</td>
                    <td style={s.td}>{new Date(r.started_at).toLocaleString()}</td>
                    <td style={s.td}>v{r.agent_version}</td>
                    <td style={s.td}>{formatMetric(r.recall)}</td>
                    <td style={s.td}>{formatMetric(r.precision)}</td>
                    <td style={s.td}>{formatMetric(r.citation_accuracy)}</td>
                    <td style={s.td}>
                      {r.status === "running"
                        ? t("suite.progress", { done: r.cases_done, total: r.cases_total })
                        : `${r.traces_passed}/${r.traces_total}`}
                    </td>
                    <td style={s.td}>{formatCost(r.cost_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={s.wrap}>
        <header>
          <h1 style={s.h1}>{t("dashboard.defaultTitle")}</h1>
          <p style={s.subtitle}>{t("dashboard.subtitle")}</p>
        </header>
        {body}
      </div>
    </AppShell>
  );
}
