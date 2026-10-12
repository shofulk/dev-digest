/* CiTab — the agent's CI deployment: installations, "Fail CI on", recent CI runs and the
   Export-to-CI wizard. Data only through hooks/ci.ts; refreshes CI results on open (AC-45). */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, FormField, Icon, SelectInput, Skeleton } from "@devdigest/ui";
import type { Agent, CiFailOn, CiInstallation } from "@devdigest/shared";
import { ciKeys, useCiAgent, useCiRefresh } from "../../../../../../../lib/hooks/ci";
import { useUpdateAgent } from "../../../../../../../lib/hooks/agents";
import { CiRunsTable, isGithubUrl } from "../../../../../../../components/ci/CiRunsTable";
import { relativeTime } from "../../../../../../../lib/relative-time";
import { ExportWizard } from "./ExportWizard";
import { CI_FAIL_ON_VALUES } from "./constants";
import { s } from "./styles";

export function CiTab({ agent }: { agent: Agent }) {
  const t = useTranslations("ci");
  const { data, isPending, isError, error, refetch } = useCiAgent(agent.id);
  const { result } = useCiRefresh([ciKeys.agent(agent.id)]);
  const update = useUpdateAgent();
  const [wizard, setWizard] = React.useState<"add" | "update" | null>(null);

  const installations = data?.installations ?? [];
  const active = installations.filter((i) => i.status === "active").length;
  const failOnOptions = CI_FAIL_ON_VALUES.map((v) => ({ value: v, label: t(`ciTab.failOn.${v}`) }));

  const status = (i: CiInstallation) => {
    if (i.last_run)
      return (
        <>
          <Badge dot>{t(`runs.verdict.${i.last_run.verdict}`)}</Badge>
          <span style={s.muted}>{t("ciTab.agoSuffix", { time: relativeTime(i.last_run.ran_at) })}</span>
        </>
      );
    if (i.status === "pr_open")
      return isGithubUrl(i.pr_url) ? (
        <a href={i.pr_url} target="_blank" rel="noopener noreferrer" style={s.link}>
          {t("ciTab.prOpen")}
        </a>
      ) : (
        <span style={s.muted}>{t("ciTab.prOpen")}</span>
      );
    return <span style={s.muted}>{t("ciTab.manualInstall")}</span>;
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("ciTab.heading")}</h2>
        {active > 0 && (
          <Badge color="var(--ok)" bg="var(--ok-bg)" dot>
            {t("ciTab.activeIn", { count: active })}
          </Badge>
        )}
        <div style={s.spacer}>
          <Button icon="RefreshCw" disabled={installations.length === 0} onClick={() => setWizard("update")}>
            {t("ciTab.updateConfig")}
          </Button>
          <Button kind="primary" icon="Plus" onClick={() => setWizard("add")}>
            {t("ciTab.addToCi")}
          </Button>
        </div>
      </div>

      {result && result.degraded.length > 0 && (
        <div role="status" style={s.notice}>
          {t("ciTab.degraded", {
            repos: result.degraded.map((d) => d.repo).join(", "),
            reason: [...new Set(result.degraded.map((d) => d.reason))].join(", "),
          })}
        </div>
      )}

      {isPending && <Skeleton height={120} />}
      {isError && <ErrorState body={error.message} onRetry={() => refetch()} />}
      {data && (
        <>
          {installations.map((i) => (
            <div key={i.id} style={s.row} data-testid="ci-installation">
              <Icon.GitBranch size={15} />
              <span className="mono" style={s.repo}>
                {i.repo}
              </span>
              <Badge icon="Workflow">{t("ciTab.ghaChip")}</Badge>
              <span className="mono" style={s.muted}>{`v${i.installed_agent_version}`}</span>
              {status(i)}
            </div>
          ))}
          <button type="button" style={s.addRow} onClick={() => setWizard("add")}>
            + {t("ciTab.addRepository")}
          </button>

          <div style={s.failOn}>
            <FormField label={t("ciTab.failOnLabel")}>
              <SelectInput
                value={agent.ci_fail_on}
                onChange={(v) => update.mutate({ id: agent.id, patch: { ci_fail_on: v as CiFailOn } })}
                options={failOnOptions}
              />
            </FormField>
          </div>

          <h3 style={s.h2}>{t("ciTab.recentRuns")}</h3>
          <CiRunsTable runs={data.runs.slice(0, 20)} />
          <Link href="/ci-runs" style={s.link}>
            {t("ciTab.allRuns")}
          </Link>
        </>
      )}

      {wizard && (
        <ExportWizard
          agent={agent}
          mode={wizard}
          installedRepos={installations.map((i) => i.repo)}
          onClose={() => setWizard(null)}
        />
      )}
    </div>
  );
}
