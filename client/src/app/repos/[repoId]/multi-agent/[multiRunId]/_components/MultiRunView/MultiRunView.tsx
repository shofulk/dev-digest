/* MultiRunView — /repos/:repoId/multi-agent/:multiRunId. The results of one multi-run:
   header + Columns / Tabs (?view) + "Where agents disagree". Data only through hooks;
   the run refreshes itself while any agent is running (useMultiRun polls), so a column
   turns final without a reload (AC-51). */
"use client";

import React from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ErrorState, Skeleton } from "@devdigest/ui";
import type { AgentColumn, FindingRecord } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import RunTraceDrawer from "@/components/run-trace-drawer";
import { ApiError } from "@/lib/api";
import { usePullDetail } from "@/lib/hooks";
import { useCancelMultiRun, useMultiRun, useMultiRunEvents, useRetryAgent } from "@/lib/hooks/multi-agent";
import { useCancelRun, usePrReviews } from "@/lib/hooks/reviews";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { doneRunKey, findingsLoad, hasRunning, parseView, type MultiRunViewMode } from "./helpers";
import { ResultsHeader } from "./_components/ResultsHeader";
import { ColumnsView } from "./_components/ColumnsView";
import { TabsView } from "./_components/TabsView";
import { DisagreementBlock } from "./_components/DisagreementBlock";
import { s } from "./styles";

export function MultiRunView() {
  const t = useTranslations("multiAgentResults");
  const params = useParams<{ repoId: string; multiRunId: string }>();
  const { repoId, multiRunId } = params;
  const search = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const view = parseView(search.get("view"));
  const { data: run, isPending, isError, error, refetch } = useMultiRun(multiRunId);
  const prId = run?.pr_id ?? null;
  const { data: pr } = usePullDetail(prId);
  const reviewsQuery = usePrReviews(prId);
  const reviews = reviewsQuery.data;
  const findingsState = findingsLoad(prId, reviewsQuery);
  const cancelAll = useCancelMultiRun(multiRunId);
  const cancelOne = useCancelRun();
  const retry = useRetryAgent(multiRunId);
  const [traceRunId, setTraceRunId] = React.useState<string | null>(null);
  const [pendingAgentIds, setPendingAgentIds] = React.useState<ReadonlySet<string>>(() => new Set());

  // One shared stream for every running column (C14), keyed on their run ids.
  const runningRunIds = (run?.columns ?? []).filter((c) => c.status === "running").map((c) => c.run_id);
  const liveEvents = useMultiRunEvents(multiRunId, runningRunIds);

  // A column that turns `done` has new persisted findings: refresh the PR's reviews (C15).
  const doneKey = run ? doneRunKey(run.columns) : null;
  const seenDoneKey = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (doneKey == null) return;
    if (seenDoneKey.current != null && seenDoneKey.current !== doneKey) {
      void qc.invalidateQueries({ queryKey: ["reviews", prId] });
    }
    seenDoneKey.current = doneKey;
  }, [doneKey, prId, qc]);

  const findingsById = React.useMemo(() => {
    const map = new Map<string, FindingRecord>();
    for (const r of reviews ?? []) for (const f of r.findings) map.set(f.id, f);
    return map;
  }, [reviews]);

  const configureHref = `/repos/${repoId}/multi-agent${prId ? `?pr=${prId}` : ""}`;
  const prNumber = run?.pr_number ?? pr?.number ?? null;
  const crumb = [
    { label: t("header.title"), href: `/repos/${repoId}/multi-agent` },
    ...(prNumber != null ? [{ label: `#${prNumber}`, mono: true }] : []),
  ];

  const setView = (next: MultiRunViewMode) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("view", next);
    router.replace(`/repos/${repoId}/multi-agent/${multiRunId}?${sp.toString()}`);
  };

  const settle = <T,>(agentId: string, call: (done: () => void) => T) => {
    setPendingAgentIds((prev) => new Set(prev).add(agentId));
    return call(() =>
      setPendingAgentIds((prev) => {
        const next = new Set(prev);
        next.delete(agentId);
        return next;
      }),
    );
  };
  const onRetry = (c: AgentColumn) =>
    settle(c.agent_id, (done) => retry.mutate({ agentId: c.agent_id }, { onSettled: done }));
  const onCancel = (c: AgentColumn) =>
    settle(c.agent_id, (done) =>
      cancelOne.mutate(c.run_id, {
        onSuccess: () => qc.invalidateQueries({ queryKey: ["multi-agent-run", multiRunId] }),
        onSettled: done,
      }),
    );

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  if (isPending) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.skeleton}>
          <Skeleton height={28} width={360} />
          <Skeleton height={16} width={300} />
          <Skeleton height={240} />
        </div>
      </AppShell>
    );
  }

  if (isError || !run) {
    const missing = error instanceof ApiError && (error.status === 404 || error.status === 422);
    return (
      <AppShell crumb={crumb}>
        {missing ? (
          <div style={s.notFound}>
            <h1 style={s.notFoundTitle}>{t("notFound.title")}</h1>
            <p style={s.notFoundBody}>{t("notFound.body")}</p>
            <Link href={`/repos/${repoId}/multi-agent`} style={s.link}>
              {t("configureRun")}
            </Link>
          </div>
        ) : (
          <ErrorState
            fullScreen
            title={t("loadError.title")}
            body={t("loadError.body")}
            onRetry={() => refetch()}
          />
        )}
      </AppShell>
    );
  }

  const traceColumn = run.columns.find((c) => c.run_id === traceRunId) ?? null;

  return (
    <AppShell crumb={crumb}>
      <ResultsHeader
        prNumber={prNumber}
        prTitle={pr?.title ?? null}
        agentCount={run.agent_count}
        totalDurationMs={run.total_duration_ms}
        totalCostUsd={run.total_cost_usd}
        view={view}
        onViewChange={setView}
        onConfigure={() => router.push(configureHref)}
        showCancelAll={hasRunning(run.columns)}
        cancelAllPending={cancelAll.isPending}
        onCancelAll={() => cancelAll.mutate()}
      />

      <div style={s.body}>
        {run.stale && (
          <div style={s.banner} role="status">
            <span>{t("stale.banner")}</span>
            <Link href={configureHref} style={s.link}>
              {t("configureRun")}
            </Link>
          </div>
        )}

        {view === "tabs" ? (
          <TabsView
            columns={run.columns}
            prId={run.pr_id}
            findingsById={findingsById}
            repoFullName={activeRepo?.full_name ?? null}
            headSha={run.head_sha}
            onViewTrace={(c) => setTraceRunId(c.run_id)}
            onRetry={onRetry}
            onCancel={onCancel}
            pendingAgentIds={pendingAgentIds}
            liveEvents={liveEvents}
            findingsState={findingsState}
            onRetryFindings={() => void reviewsQuery.refetch()}
          />
        ) : (
          <ColumnsView
            columns={run.columns}
            onViewTrace={(c) => setTraceRunId(c.run_id)}
            onRetry={onRetry}
            onCancel={onCancel}
            pendingAgentIds={pendingAgentIds}
            liveEvents={liveEvents}
          />
        )}

        <DisagreementBlock columns={run.columns} groups={run.conflicts} />
      </div>

      {traceColumn && (
        <RunTraceDrawer
          runId={traceColumn.run_id}
          agentName={traceColumn.agent_name}
          prNumber={prNumber}
          running={traceColumn.status === "running"}
          findings={traceColumn.findings
            .map((f) => findingsById.get(f.id))
            .filter((f): f is FindingRecord => f != null)}
          findingsState={findingsState}
          onClose={() => setTraceRunId(null)}
        />
      )}
    </AppShell>
  );
}
