/* /eval — Eval Dashboard. One card per agent that has eval cases (latest recall / precision /
   citation, version, passed/total, recall sparkline) linking to that agent's eval page,
   a "Run all agents" action, and the most recent suite runs across all agents. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, Modal, Skeleton, Sparkline } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { MetricBar } from "@/components/eval-ui/MetricBar";
import { formatPercent } from "@/lib/eval-metrics";
import { notify } from "@/lib/toast";
import { useEvalDashboard, useRunAllEvals } from "@/lib/hooks/eval";
import { runAllOutcome, runAllSummary } from "./helpers";
import { s } from "./styles";

const COLOR = { recall: "var(--accent)", precision: "var(--ok)", citation: "var(--warn)" } as const;

export function EvalDashboardView() {
  const t = useTranslations("eval");
  const { data, isLoading, isError, refetch } = useEvalDashboard();
  const runAll = useRunAllEvals();
  const [confirming, setConfirming] = React.useState(false);
  const crumb = [{ label: t("page.crumbSkillsLab") }, { label: t("page.crumbEvalDashboard") }];
  const dash = t("suite.metricEmpty");

  const agents = data?.agents ?? [];
  const summary = runAllSummary(agents);

  const onConfirm = () =>
    runAll.mutate(undefined, {
      onSuccess: (result) => {
        const outcome = runAllOutcome(result);
        notify.success(t("runAll.started", { count: outcome.started }));
        outcome.refused.forEach((x) =>
          notify.error(t("runAll.refusedLine", { agent: x.agent_name, reason: t(`runAll.reason.${x.reason}`) })),
        );
        setConfirming(false);
      },
      onError: () => {
        notify.error(t("runAll.failed"));
        setConfirming(false);
      },
    });

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
          <h2 style={s.h2}>
            <Icon.Cpu size={14} />
            {t("dashboard.agents")}
          </h2>
          <div style={s.cards}>
            {data.agents.map((a) => {
              const recalls = a.trend.map((p) => p.recall).filter((v): v is number => v != null);
              const last = a.latest;
              const values = [
                { key: "recall", label: t("dashboard.short.recall"), v: last?.recall, color: COLOR.recall },
                { key: "precision", label: t("dashboard.short.precision"), v: last?.precision, color: COLOR.precision },
                { key: "citation", label: t("dashboard.short.citation"), v: last?.citation_accuracy, color: COLOR.citation },
              ];
              return (
                <Link key={a.agent_id} href={`/eval/agents/${a.agent_id}`} style={s.card}>
                  <span style={s.cardIcon}>
                    <Icon.Cpu size={20} />
                  </span>
                  <div style={s.cardMain}>
                    <div style={s.cardTitle}>
                      <span style={s.cardName}>{a.name}</span>
                      <span className="mono" style={s.chip}>
                        {a.model}
                      </span>
                    </div>
                    <div style={s.lastRun}>
                      {last
                        ? t("dashboard.lastRun", {
                            version: last.agent_version,
                            date: new Date(last.finished_at ?? last.started_at).toLocaleString(),
                            passed: last.traces_passed,
                            total: last.traces_total,
                          })
                        : t("dashboard.neverRun")}
                    </div>
                  </div>
                  {recalls.length >= 2 && <Sparkline data={recalls} color={COLOR.recall} w={110} h={36} />}
                  <div style={s.values}>
                    {values.map((x) => (
                      <div key={x.key} style={s.value}>
                        <span style={s.valueLabel}>{x.label}</span>
                        <span className="tnum" style={s.valueNum(x.color)}>
                          {formatPercent(x.v) ?? dash}
                        </span>
                      </div>
                    ))}
                  </div>
                  <span style={s.chevron}>
                    <Icon.ChevronRight size={18} />
                  </span>
                </Link>
              );
            })}
          </div>
        </section>

        <section>
          <h2 style={s.h2}>
            <Icon.History size={14} />
            {t("dashboard.recentRunsAll")}
          </h2>
          {data.recent_runs.length === 0 ? (
            <div style={s.muted}>{t("dashboard.noRuns")}</div>
          ) : (
            <div style={s.tableWrap}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>{t("dashboard.columns.agent")}</th>
                    {(["time", "version", "recall", "precision", "citation", "passed"] as const).map((k) => (
                      <th key={k} style={s.th}>
                        {t(`suite.columns.${k}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.recent_runs.map((r) => (
                    <tr key={r.run_id}>
                      <td style={{ ...s.td, ...s.agentCell }}>{r.agent_name}</td>
                      <td className="mono" style={s.td}>
                        {new Date(r.started_at).toLocaleString()}
                      </td>
                      <td className="mono" style={{ ...s.td, ...s.version }}>
                        v{r.agent_version}
                      </td>
                      <td style={{ ...s.td, ...s.barCell }}>
                        <MetricBar value={r.recall} color={COLOR.recall} label={t("dashboard.legend.recall")} />
                      </td>
                      <td style={{ ...s.td, ...s.barCell }}>
                        <MetricBar value={r.precision} color={COLOR.precision} label={t("dashboard.legend.precision")} />
                      </td>
                      <td style={{ ...s.td, ...s.barCell }}>
                        <MetricBar value={r.citation_accuracy} color={COLOR.citation} label={t("dashboard.legend.citation")} />
                      </td>
                      <td className="tnum" style={s.td}>
                        {r.status === "running"
                          ? t("suite.progress", { done: r.cases_done, total: r.cases_total })
                          : `${r.traces_passed}/${r.traces_total}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={s.wrap}>
        <header style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>{t("dashboard.defaultTitle")}</h1>
            <p style={s.subtitle}>{t("dashboard.subtitle")}</p>
          </div>
          <Button
            kind="primary"
            icon="Play"
            disabled={isLoading || agents.length === 0 || runAll.isPending}
            onClick={() => setConfirming(true)}
          >
            {t("dashboard.runAll")}
          </Button>
        </header>
        {body}
      </div>
      {confirming && (
        <Modal
          width={480}
          title={t("runAll.title")}
          onClose={() => setConfirming(false)}
          footer={
            <div style={s.modalFooter}>
              <Button kind="secondary" onClick={() => setConfirming(false)}>
                {t("runAll.cancel")}
              </Button>
              <Button kind="primary" loading={runAll.isPending} disabled={runAll.isPending} onClick={onConfirm}>
                {t("runAll.confirm", { calls: summary.calls })}
              </Button>
            </div>
          }
        >
          <p style={s.modalBody}>{t("runAll.body", summary)}</p>
        </Modal>
      )}
    </AppShell>
  );
}
