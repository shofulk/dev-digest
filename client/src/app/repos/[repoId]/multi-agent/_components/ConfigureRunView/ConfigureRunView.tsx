/* Configure run — step 1 picks a pull request, step 2 picks the agents, then one
   multi-run starts and the results page opens. */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, SelectInput, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useAgents, usePulls, useRunEstimates, useStartMultiRun } from "@/lib/hooks";
import { useRepoNotFound } from "@/lib/repo-context";
import { estimateTotals } from "@/lib/multi-agent-estimates";
import { NO_COST, formatCost } from "@/lib/format-cost";
import { pickablePulls, preselectedPrId } from "./helpers";
import { AgentCard } from "./_components/AgentCard";
import { RecentRuns } from "./_components/RecentRuns";
import { s } from "./styles";

export function ConfigureRunView() {
  const t = useTranslations("multiAgent");
  const tr = useTranslations("runs");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const search = useSearchParams();
  const router = useRouter();
  const repoNotFound = useRepoNotFound(repoId);
  const { data: pulls, isPending: pullsPending, isError, refetch } = usePulls(repoId);
  const { data: agents, isPending: agentsPending } = useAgents();
  const { data: estimates } = useRunEstimates();
  const start = useStartMultiRun();

  const prs = pickablePulls(pulls);
  // `undefined` = the user has not touched the control yet: fall back to the URL / enabled agents.
  const [pickedPr, setPickedPr] = React.useState<string | null | undefined>(undefined);
  const prId = pickedPr === undefined ? preselectedPrId(prs, search.get("pr")) : pickedPr;
  const [pickedAgents, setPickedAgents] = React.useState<Set<string> | null>(null);

  const all = agents ?? [];
  const hasEnabled = all.some((a) => a.enabled);
  const checked = pickedAgents ?? new Set(all.filter((a) => a.enabled).map((a) => a.id));
  const count = all.filter((a) => checked.has(a.id)).length;

  const estimateById = new Map((estimates ?? []).map((e) => [e.agent_id, e]));
  const totals = estimateTotals(all.filter((a) => checked.has(a.id)).map((a) => estimateById.get(a.id)));

  const toggle = (id: string, on: boolean) => {
    const next = new Set(checked);
    if (on) next.add(id);
    else next.delete(id);
    setPickedAgents(next);
  };

  const run = async () => {
    if (!prId || count === 0) return;
    try {
      const res = await start.mutateAsync({
        prId,
        agentIds: all.filter((a) => checked.has(a.id)).map((a) => a.id),
      });
      router.push(`/repos/${repoId}/multi-agent/${res.multi_agent_run_id}`);
    } catch {
      // The global MutationCache toasts the API error; the PR and checks stay (AC-19).
    }
  };

  const crumb = [{ label: t("configure.breadcrumb") }, { label: t("configure.title") }];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const prOptions = [
    { value: "", label: t("configure.selectPr") },
    ...prs.map((p) => ({ value: p.id, label: t("configure.prItem", { number: p.number, title: p.title }) })),
  ];

  let agentsStep: React.ReactNode;
  if (agentsPending) {
    agentsStep = <Skeleton height={64} />;
  } else if (!hasEnabled) {
    agentsStep = (
      <EmptyState
        title={tr("page.noAgents.title")}
        body={tr("page.noAgents.body")}
        cta={tr("page.noAgents.cta")}
        onCta={() => router.push("/agents")}
      />
    );
  } else if (!prId) {
    agentsStep = <EmptyState title={t("configure.pickPrFirst")} body={t("configure.pickPrFirstBody")} />;
  } else {
    agentsStep = (
      <div style={s.agentList}>
        {all.map((a) => (
          <AgentCard
            key={a.id}
            agent={a}
            checked={checked.has(a.id)}
            estimate={estimateById.get(a.id)}
            onChange={(v) => toggle(a.id, v)}
          />
        ))}
      </div>
    );
  }
  const showAgentList = !agentsPending && hasEnabled && !!prId;

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <h1 style={s.h1}>{t("configure.pageTitle")}</h1>
        <p style={s.subtitle}>{t("configure.subtitle")}</p>

        <section style={s.step}>
          <div style={s.stepHead}>
            <span style={s.stepNum}>1</span>
            <h2 style={s.stepTitle}>{t("configure.stepPr")}</h2>
          </div>
          <div style={s.selectWrap}>
            {pullsPending ? (
              <Skeleton height={40} />
            ) : isError ? (
              <ErrorState title={t("configure.loadError")} onRetry={() => refetch()} />
            ) : (
              <label>
                <span style={s.srOnly}>{t("configure.stepPr")}</span>
                <SelectInput
                  value={prId ?? ""}
                  onChange={(v) => setPickedPr(v || null)}
                  options={prOptions}
                  mono={false}
                />
              </label>
            )}
          </div>
        </section>

        <section style={s.step}>
          <div style={s.stepHead}>
            <span style={s.stepNum}>2</span>
            <h2 style={s.stepTitle}>{t("configure.stepAgents")}</h2>
            {showAgentList && (
              <button
                type="button"
                style={s.selectAll}
                onClick={() => setPickedAgents(new Set(all.map((a) => a.id)))}
              >
                {t("configure.selectAll")}
              </button>
            )}
          </div>
          {agentsStep}
        </section>

        <div style={s.footer}>
          <Button
            kind="primary"
            icon="Users"
            disabled={!prId || count === 0 || start.isPending}
            loading={start.isPending}
            onClick={run}
          >
            {t("configure.run", { count })}
          </Button>
          {count > 0 && (
            <span className="mono" style={s.total}>
              {t("configure.total", {
                time: totals.seconds == null ? NO_COST : t("configure.seconds", { seconds: totals.seconds }),
                cost: formatCost(totals.costUsd),
              })}
              {totals.partial && <span style={s.partial}>{t("configure.partial")}</span>}
            </span>
          )}
        </div>

        <RecentRuns repoId={repoId} />
      </div>
    </AppShell>
  );
}
