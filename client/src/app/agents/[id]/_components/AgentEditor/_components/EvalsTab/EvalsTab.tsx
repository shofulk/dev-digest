/* EvalsTab — the agent's regression harness: latest-run tiles with deltas, the frozen case
   list, "Run evals" with live progress, and the run history with a two-run Compare. Read-only,
   so (unlike the Config form) it may unmount on a tab switch. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Button, Checkbox, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { ApiError } from "@/lib/api";
import { notify } from "@/lib/toast";
import { formatCost } from "@/lib/format-cost";
import {
  canCompare,
  formatMetric,
  formatPercent,
  latestTwoCompleted,
  metricDelta,
  orderPair,
  pointsDelta,
  startErrorKey,
  toggleSelected,
} from "@/lib/eval-metrics";
import {
  agentRunBusy,
  useDeleteEvalCase,
  useEvalCases,
  useEvalRuns,
  useStartCaseRun,
  useStartEvalRun,
} from "@/lib/hooks/eval";
import { CompareModal } from "@/components/eval-ui/CompareModal";
import { EvalCaseModal, type EvalCaseModalSource } from "@/components/eval-ui/EvalCaseModal";
import { MetricTile } from "@/components/eval-ui/MetricTile";
import { locationOf, passingCounts } from "./helpers";
import { s } from "./styles";

const RESULT_KEYS = {
  pass: "suite.result.pass",
  fail: "suite.result.fail",
  errored: "suite.result.errored",
  never_run: "suite.result.never_run",
} as const;

const STATUS_ICON = {
  pass: { icon: "CheckCircle", color: "var(--ok)" },
  fail: { icon: "XCircle", color: "var(--crit)" },
  errored: { icon: "AlertTriangle", color: "var(--warn)" },
  never_run: { icon: "Dot", color: "var(--text-muted)" },
} as const;

export function EvalsTab({ agentId }: { agentId: string }) {
  const t = useTranslations("eval");
  const cases = useEvalCases(agentId);
  const runs = useEvalRuns(agentId);
  const start = useStartEvalRun(agentId);
  const del = useDeleteEvalCase(agentId);
  const runCase = useStartCaseRun(agentId);
  const [modal, setModal] = React.useState<{ source: EvalCaseModalSource; opener: HTMLElement } | null>(null);

  // Selection belongs to one agent: reset during render, never in an effect.
  const [selected, setSelected] = React.useState<string[]>([]);
  const [selAgent, setSelAgent] = React.useState(agentId);
  if (selAgent !== agentId) {
    setSelAgent(agentId);
    setSelected([]);
  }
  const [comparing, setComparing] = React.useState(false);

  const caseList = cases.data ?? [];
  const runList = runs.data ?? [];
  const running = runList.find((r) => r.status === "running") ?? null;
  const { latest, previous } = latestTwoCompleted(runList);
  const dash = t("suite.metricEmpty");
  const busy = agentRunBusy(runList, caseList);
  const counts = passingCounts(caseList.map((c) => c.last_result));
  const pair = canCompare(selected) ? orderPair(runList, [selected[0]!, selected[1]!]) : null;

  const onRun = () =>
    start.mutate(undefined, {
      onError: (e) => {
        const code = e instanceof ApiError ? e.code : undefined;
        notify.error(t(startErrorKey(code)));
      },
    });

  const onRunCase = (caseId: string) =>
    runCase.mutate(caseId, {
      onError: (e) => {
        const code = e instanceof ApiError ? e.code : undefined;
        notify.error(t(startErrorKey(code)));
      },
    });

  if (cases.isError || runs.isError) {
    return (
      <div style={s.wrap}>
        <ErrorState
          title={t("suite.loadFailed")}
          onRetry={() => {
            void cases.refetch();
            void runs.refetch();
          }}
        />
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      <section>
        <div style={s.metricsHead}>
          <Icon.Gauge size={14} />
          <span style={s.metricsLabel}>{t("suite.metricsLabel")}</span>
          <Link href="/eval" className="mono" style={s.dashLink}>
            {t("suite.dashboardLink")}
          </Link>
        </div>
        <div style={s.tiles}>
          <MetricTile
            label={t("dashboard.metrics.recall")}
            value={formatPercent(latest?.recall) ?? dash}
            color="var(--accent)"
            delta={pointsDelta(metricDelta(latest?.recall, previous?.recall))}
          />
          <MetricTile
            label={t("dashboard.metrics.precision")}
            value={formatPercent(latest?.precision) ?? dash}
            color="var(--ok)"
            delta={pointsDelta(metricDelta(latest?.precision, previous?.precision))}
          />
          <MetricTile
            label={t("dashboard.metrics.citationAccuracy")}
            value={formatPercent(latest?.citation_accuracy) ?? dash}
            color="var(--warn)"
            delta={pointsDelta(metricDelta(latest?.citation_accuracy, previous?.citation_accuracy))}
          />
          <MetricTile
            label={t("suite.tracesPassed")}
            value={latest ? `${latest.traces_passed}/${latest.traces_total}` : dash}
            color="var(--text-primary)"
          />
        </div>
      </section>

      <section>
        <div style={s.sectionHead}>
          <h2 style={s.h2}>{t("suite.casesHeading")}</h2>
          {counts.anyRun && (
            <span style={s.passingBadge}>{t("suite.passingBadge", { passing: counts.passing, total: counts.total })}</span>
          )}
          <div style={s.spacer}>
            <Button
              kind="secondary"
              size="sm"
              icon="Plus"
              onClick={(e) => setModal({ source: { kind: "new" }, opener: e.currentTarget })}
            >
              {t("caseEditor.newCase")}
            </Button>
            <Button
              kind="secondary"
              size="sm"
              icon="Play"
              loading={start.isPending}
              disabled={busy || caseList.length === 0 || start.isPending}
              onClick={onRun}
            >
              {running
                ? t("suite.progress", { done: running.cases_done, total: running.cases_total })
                : t("suite.runAll")}
            </Button>
          </div>
        </div>
        {cases.isLoading ? (
          <div style={s.skeletons}>
            <Skeleton height={32} />
            <Skeleton height={32} />
          </div>
        ) : caseList.length === 0 ? (
          <div style={s.hint}>{t("suite.emptyCases")}</div>
        ) : (
          <div style={s.caseList}>
            {caseList.map((c) => {
              const e = c.expectation;
              const path = e ? locationOf(e) : null;
              const status = STATUS_ICON[c.last_result];
              const StatusIcon = Icon[status.icon];
              const meta =
                e && (c.last_result === "pass" || c.last_result === "fail")
                  ? t(e.type === "must_find" ? "suite.expectedFind" : "suite.expectedNone", { got: c.last_matched ?? 0 })
                  : t(RESULT_KEYS[c.last_result]);
              const metaLine = c.running ? t("evalsTab.running") : meta;
              return (
                <div key={c.case.id} data-testid="eval-case-card" style={s.caseCard}>
                  <span role="img" aria-label={t(RESULT_KEYS[c.last_result])} style={{ ...s.statusIcon, color: status.color }}>
                    <StatusIcon size={c.last_result === "never_run" ? 14 : 18} />
                  </span>
                  <div style={s.caseMain}>
                    <span className="mono" style={s.caseName}>
                      {c.case.name}
                    </span>
                    <span style={s.caseMeta}>{metaLine}</span>
                    {path && (
                      <span className="mono" style={s.casePath} title={path}>
                        {path}
                      </span>
                    )}
                  </div>
                  <div style={s.caseSide}>
                    {e && (
                      <span style={s.chip}>
                        {e.severity} · {e.category}
                      </span>
                    )}
                    {e && <span style={s.chip}>{t(e.type === "must_find" ? "suite.typeMustFind" : "suite.typeMustNotFlag")}</span>}
                    <Button
                      kind="ghost"
                      size="sm"
                      icon="Play"
                      aria-label={t("evalsTab.run")}
                      title={t("evalsTab.run")}
                      disabled={busy || c.running || runCase.isPending}
                      onClick={() => onRunCase(c.case.id)}
                    />
                    <Button
                      kind="ghost"
                      size="sm"
                      icon="Edit"
                      aria-label={t("evalsTab.edit")}
                      title={t("evalsTab.edit")}
                      onClick={(ev) => setModal({ source: { kind: "edit", evalCase: c.case }, opener: ev.currentTarget })}
                    />
                    <Button
                      kind="ghost"
                      size="sm"
                      icon="Trash"
                      aria-label={t("suite.deleteCase")}
                      title={t("suite.deleteCase")}
                      disabled={del.isPending}
                      onClick={() => del.mutate(c.case.id)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <div style={s.sectionHead}>
          <h2 style={s.h2}>{t("suite.history")}</h2>
          <div style={s.spacer}>
            {!canCompare(selected) && <span style={s.hint}>{t("suite.compareHint")}</span>}
            <Button kind="secondary" size="sm" disabled={!canCompare(selected)} onClick={() => setComparing(true)}>
              {t("suite.compare")}
            </Button>
          </div>
        </div>
        {runs.isLoading ? (
          <Skeleton height={32} />
        ) : runList.length === 0 ? (
          <div style={s.hint}>{t("suite.noRuns")}</div>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th} />
                {(["time", "version", "recall", "precision", "citation", "passed", "cost"] as const).map((k) => (
                  <th key={k} style={s.th}>
                    {t(`suite.columns.${k}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runList.map((r) => (
                <tr key={r.run_id}>
                  <td style={s.td}>
                    {r.status === "completed" && (
                      <Checkbox
                        checked={selected.includes(r.run_id)}
                        onChange={() => setSelected((cur) => toggleSelected(cur, r.run_id))}
                      />
                    )}
                  </td>
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

      {modal && (
        <EvalCaseModal
          agentId={agentId}
          source={modal.source}
          returnFocusTo={modal.opener}
          onClose={() => setModal(null)}
        />
      )}

      {comparing && pair && (
        <CompareModal runA={pair[0]} runB={pair[1]} onClose={() => setComparing(false)} />
      )}
    </div>
  );
}
