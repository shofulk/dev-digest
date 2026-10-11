/* EvalsTab — the agent's regression harness: latest-run tiles with deltas, the frozen case
   list, "Run evals" with live progress, and the run history with a two-run Compare. Read-only,
   so (unlike the Config form) it may unmount on a tab switch. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Checkbox, ErrorState, MetricCard, Skeleton } from "@devdigest/ui";
import type { EvalCaseView } from "@devdigest/shared/contracts/eval-ci";
import { ApiError } from "@/lib/api";
import { notify } from "@/lib/toast";
import { formatCost } from "@/lib/format-cost";
import { formatMetric, orderPair } from "@/lib/eval-metrics";
import { useDeleteEvalCase, useEvalCases, useEvalRuns, useStartEvalRun } from "@/lib/hooks/eval";
import { CompareModal } from "./_components/CompareModal";
import { canCompare, latestTwoCompleted, metricDelta, startErrorKey, toggleSelected } from "./helpers";
import { s } from "./styles";

const RESULT_KEYS = {
  pass: "suite.result.pass",
  fail: "suite.result.fail",
  errored: "suite.result.errored",
  never_run: "suite.result.never_run",
} as const;

function lineRange(c: EvalCaseView): string | null {
  const e = c.expectation;
  if (!e) return null;
  return e.start_line === e.end_line ? `${e.file}:${e.start_line}` : `${e.file}:${e.start_line}-${e.end_line}`;
}

export function EvalsTab({ agentId }: { agentId: string }) {
  const t = useTranslations("eval");
  const cases = useEvalCases(agentId);
  const runs = useEvalRuns(agentId);
  const start = useStartEvalRun(agentId);
  const del = useDeleteEvalCase(agentId);

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
  const pair = canCompare(selected) ? orderPair(runList, [selected[0]!, selected[1]!]) : null;

  const onRun = () =>
    start.mutate(undefined, {
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
      {latest && (
        <div style={s.tiles}>
          <MetricCard
            label={t("dashboard.metrics.recall")}
            value={formatMetric(latest.recall)}
            delta={metricDelta(latest.recall, previous?.recall)}
          />
          <MetricCard
            label={t("dashboard.metrics.precision")}
            value={formatMetric(latest.precision)}
            delta={metricDelta(latest.precision, previous?.precision)}
          />
          <MetricCard
            label={t("dashboard.metrics.citationAccuracy")}
            value={formatMetric(latest.citation_accuracy)}
            delta={metricDelta(latest.citation_accuracy, previous?.citation_accuracy)}
          />
          <MetricCard label={t("dashboard.metrics.passed")} value={`${latest.traces_passed}/${latest.traces_total}`} />
        </div>
      )}

      <section>
        <div style={s.sectionHead}>
          <h2 style={s.h2}>{t("suite.casesHeading")}</h2>
          <div style={s.spacer}>
            <Button
              kind="primary"
              size="sm"
              icon="Play"
              loading={start.isPending}
              disabled={running !== null || caseList.length === 0 || start.isPending}
              onClick={onRun}
            >
              {running
                ? t("suite.progress", { done: running.cases_done, total: running.cases_total })
                : t("suite.runEvals")}
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
          <table style={s.table}>
            <tbody>
              {caseList.map((c) => {
                const range = lineRange(c);
                const type = c.expectation?.type;
                return (
                  <tr key={c.case.id}>
                    <td style={s.td}>{c.case.name}</td>
                    <td style={s.td}>
                      {type && (
                        <Badge>{t(type === "must_find" ? "suite.typeMustFind" : "suite.typeMustNotFlag")}</Badge>
                      )}
                    </td>
                    <td style={s.td}>{range && <span className="mono">{range}</span>}</td>
                    <td style={{ ...s.td, ...s.result(c.last_result) }}>{t(RESULT_KEYS[c.last_result])}</td>
                    <td style={s.td}>
                      <Button
                        kind="ghost"
                        size="sm"
                        icon="Trash"
                        aria-label={t("suite.deleteCase")}
                        title={t("suite.deleteCase")}
                        disabled={del.isPending}
                        onClick={() => del.mutate(c.case.id)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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

      {comparing && pair && (
        <CompareModal runA={pair[0]} runB={pair[1]} onClose={() => setComparing(false)} />
      )}
    </div>
  );
}
