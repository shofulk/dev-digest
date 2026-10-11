/* /eval/agents/:agentId — one agent's regression harness: a callout when the newest completed
   run moved a metric, three metric cards with sparklines, the metric trend chart, and the
   runs table where exactly two selected runs open the Compare modal. */
"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Checkbox, ErrorState, Icon, LineChart, SelectInput, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { CompareModal } from "@/components/eval-ui/CompareModal";
import { MetricBar } from "@/components/eval-ui/MetricBar";
import { MetricTile } from "@/components/eval-ui/MetricTile";
import { ApiError } from "@/lib/api";
import { formatCost } from "@/lib/format-cost";
import {
  canCompare,
  formatPercent,
  latestTwoCompleted,
  metricDelta,
  orderPair,
  pointsDelta,
  startErrorKey,
  toggleSelected,
  toneColor,
} from "@/lib/eval-metrics";
import { useAgent, useAgents } from "@/lib/hooks/agents";
import { useEvalCases, useEvalRuns, useStartEvalRun } from "@/lib/hooks/eval";
import { notify } from "@/lib/toast";
import { metricCallout, trendPoints, type MetricKey } from "./helpers";
import { s } from "./styles";

const COLOR = { recall: "var(--accent)", precision: "var(--ok)", citation: "var(--warn)" } as const;

/** `MetricKey` -> message key under `agentPage.metric`. */
const METRIC_LABEL: Record<MetricKey, "recall" | "precision" | "citation"> = {
  recall: "recall",
  precision: "precision",
  citation_accuracy: "citation",
};

export function AgentEvalView({ agentId }: { agentId: string }) {
  const t = useTranslations("eval");
  const router = useRouter();
  const agent = useAgent(agentId);
  const agents = useAgents();
  const runs = useEvalRuns(agentId);
  const cases = useEvalCases(agentId);
  const start = useStartEvalRun(agentId);

  // Selection belongs to one agent: reset during render, never in an effect.
  const [selected, setSelected] = React.useState<string[]>([]);
  const [selAgent, setSelAgent] = React.useState(agentId);
  if (selAgent !== agentId) {
    setSelAgent(agentId);
    setSelected([]);
  }
  const [comparing, setComparing] = React.useState(false);

  const name = agent.data?.name ?? "";
  const crumb = [
    { label: t("page.crumbSkillsLab") },
    { label: t("page.crumbEvalDashboard"), href: "/eval" },
    { label: name || "…" },
  ];

  if (agent.isPending) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.wrap}>
          <Skeleton height={32} width={320} />
          <Skeleton height={96} />
          <Skeleton height={200} />
        </div>
      </AppShell>
    );
  }
  if (agent.isError || !agent.data) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.wrap}>
          <ErrorState title={t("agentPage.loadFailed")} onRetry={() => void agent.refetch()} />
        </div>
      </AppShell>
    );
  }

  const runList = runs.data ?? [];
  const caseCount = cases.data?.length ?? 0;
  const running = runList.find((r) => r.status === "running") ?? null;
  const { latest, previous } = latestTwoCompleted(runList);
  const callout = metricCallout(runList);
  const points = trendPoints(runList);
  const dash = t("suite.metricEmpty");
  const pair = canCompare(selected) ? orderPair(runList, [selected[0]!, selected[1]!]) : null;

  const onRun = () =>
    start.mutate(undefined, {
      onError: (e) => {
        const code = e instanceof ApiError ? e.code : undefined;
        notify.error(t(startErrorKey(code)));
      },
    });

  const sparkOf = (pick: (p: (typeof points)[number]) => number) => points.map(pick);
  const options = (agents.data ?? []).map((a) => ({ value: a.id, label: a.name }));
  if (!options.some((o) => o.value === agentId)) options.unshift({ value: agentId, label: agent.data.name });

  return (
    <AppShell crumb={crumb}>
      <div style={s.wrap}>
        <Link href="/eval" style={s.back}>
          {t("agentPage.backToAll")}
        </Link>

        <header style={s.header}>
          <div style={s.headerText}>
            <div style={s.titleRow}>
              <h1 style={s.h1}>{agent.data.name}</h1>
              <span className="mono" style={s.chip}>
                {agent.data.model}
              </span>
            </div>
            <p style={s.subtitle}>
              {t("agentPage.subtitle", { runs: runList.length, cases: caseCount })}
            </p>
          </div>
          <div style={s.controls}>
            <div style={s.picker} aria-label={t("agentPage.pickerLabel")}>
              <SelectInput
                mono={false}
                value={agentId}
                options={options}
                onChange={(id) => router.push(`/eval/agents/${id}`)}
              />
            </div>
            <Button
              kind="primary"
              icon="Play"
              loading={start.isPending}
              disabled={running !== null || caseCount === 0 || start.isPending}
              onClick={onRun}
            >
              {running
                ? t("suite.progress", { done: running.cases_done, total: running.cases_total })
                : t("agentPage.runEval")}
            </Button>
          </div>
        </header>

        {callout && (
          <div role="status" style={s.callout(toneColor(callout.direction))}>
            {t(callout.direction === "up" ? "agentPage.calloutUp" : "agentPage.calloutDown", {
              metric: t(`agentPage.metric.${METRIC_LABEL[callout.metric]}`),
              points: callout.points,
              version: callout.version,
            })}
          </div>
        )}

        <section style={s.tiles}>
          <MetricTile
            label={t("dashboard.metrics.recall")}
            value={formatPercent(latest?.recall) ?? dash}
            color={COLOR.recall}
            delta={pointsDelta(metricDelta(latest?.recall, previous?.recall))}
            trend={sparkOf((p) => p.recall)}
          />
          <MetricTile
            label={t("dashboard.metrics.precision")}
            value={formatPercent(latest?.precision) ?? dash}
            color={COLOR.precision}
            delta={pointsDelta(metricDelta(latest?.precision, previous?.precision))}
            trend={sparkOf((p) => p.precision)}
          />
          <MetricTile
            label={t("dashboard.metrics.citationAccuracy")}
            value={formatPercent(latest?.citation_accuracy) ?? dash}
            color={COLOR.citation}
            delta={pointsDelta(metricDelta(latest?.citation_accuracy, previous?.citation_accuracy))}
            trend={sparkOf((p) => p.citation_accuracy)}
          />
        </section>

        <section>
          <div style={s.sectionHead}>
            <h2 style={s.h2}>
              <Icon.TrendingUp size={14} />
              {t("dashboard.metricTrend")}
            </h2>
            <div style={s.spacer}>
              {(["recall", "precision", "citation"] as const).map((k) => (
                <span key={k} style={s.legend}>
                  <span style={s.swatch(COLOR[k])} aria-hidden />
                  {t(`dashboard.legend.${k}`)}
                </span>
              ))}
            </div>
          </div>
          {points.length >= 2 ? (
            <div style={s.chartBox}>
              <LineChart
                w={1200}
                h={220}
                yMin={0}
                yMax={1}
                series={[
                  { name: t("dashboard.legend.recall"), color: COLOR.recall, data: sparkOf((p) => p.recall) },
                  { name: t("dashboard.legend.precision"), color: COLOR.precision, data: sparkOf((p) => p.precision) },
                  { name: t("dashboard.legend.citation"), color: COLOR.citation, data: sparkOf((p) => p.citation_accuracy) },
                ]}
              />
            </div>
          ) : (
            <div style={s.hint}>{t("agentPage.trendTooFew")}</div>
          )}
        </section>

        <section>
          <div style={s.sectionHead}>
            <h2 style={s.h2}>
              <Icon.History size={14} />
              {t("dashboard.recentRuns")}
            </h2>
            <div style={s.spacer}>
              <Button kind="secondary" size="sm" disabled={!canCompare(selected)} onClick={() => setComparing(true)}>
                {t("suite.compare")}
              </Button>
            </div>
          </div>
          {runs.isPending ? (
            <Skeleton height={32} />
          ) : runList.length === 0 ? (
            <div style={s.hint}>{t("suite.noRuns")}</div>
          ) : (
            <div style={s.tableWrap}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th} />
                    <th style={s.th}>{t("dashboard.table.ranAt")}</th>
                    <th style={s.th}>{t("dashboard.columns.version")}</th>
                    <th style={s.th}>{t("dashboard.table.recall")}</th>
                    <th style={s.th}>{t("dashboard.table.precision")}</th>
                    <th style={s.th}>{t("dashboard.table.citation")}</th>
                    <th style={s.th}>{t("dashboard.table.pass")}</th>
                    <th style={s.th}>{t("dashboard.table.cost")}</th>
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
                      <td className="tnum" style={s.td}>
                        {formatCost(r.cost_usd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      {comparing && pair && <CompareModal runA={pair[0]} runB={pair[1]} onClose={() => setComparing(false)} />}
    </AppShell>
  );
}
