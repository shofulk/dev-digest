/* TabsView — one tab per agent (name + score); the selected agent's summary card and its
   findings as expandable FindingCards. Findings come from the PR's persisted reviews,
   joined by finding id (C6); accept / dismiss / Learn / eval-case go through
   useFindingCardActions so only the touched finding changes (AC-57, AC-61). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, CircularScore, Markdown } from "@devdigest/ui";
import type { AgentColumn, FindingRecord } from "@devdigest/shared";
import { FindingCard } from "@/components/finding-card";
import { useFindingCardActions } from "@/components/finding-card/useFindingCardActions";
import { agentLook } from "@/lib/agent-look";
import { formatCost } from "@/lib/format-cost";
import { NO_DURATION, secondsOf } from "../../helpers";
import { RunningLog } from "../RunningLog";
import { s } from "./styles";

const STATUS_COLOR = { running: "var(--warn)", failed: "var(--crit)", cancelled: "var(--text-muted)" } as const;

export function TabsView({
  columns,
  prId,
  findingsById,
  repoFullName,
  headSha,
  onViewTrace,
  onRetry,
  onCancel,
  pendingAgentId,
}: {
  columns: AgentColumn[];
  prId: string;
  findingsById: Map<string, FindingRecord>;
  repoFullName: string | null;
  headSha: string | null;
  onViewTrace: (column: AgentColumn) => void;
  onRetry: (column: AgentColumn) => void;
  onCancel: (column: AgentColumn) => void;
  pendingAgentId: string | null;
}) {
  const t = useTranslations("multiAgentResults");
  const { cardProps } = useFindingCardActions(prId);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  // Derived, not an effect: a selection that vanished falls back to the first agent.
  const column = columns.find((c) => c.agent_id === selectedId) ?? columns[0];
  if (!column) return null;

  const look = agentLook(column.agent_id);
  const seconds = secondsOf(column.duration_ms);
  const findings = column.findings
    .map((f) => findingsById.get(f.id))
    .filter((f): f is FindingRecord => f != null);
  const status = column.status;

  return (
    <div style={s.root}>
      <div role="tablist" aria-label={t("tabs.label")} style={s.tablist}>
        {columns.map((c) => {
          const on = c.agent_id === column.agent_id;
          return (
            <button
              key={c.agent_id}
              type="button"
              role="tab"
              id={`agent-tab-${c.agent_id}`}
              aria-selected={on}
              aria-controls="agent-tabpanel"
              style={s.tab(on, agentLook(c.agent_id).accent)}
              onClick={() => setSelectedId(c.agent_id)}
            >
              {c.agent_name}
              {c.status === "done" && c.score != null && <span style={s.tabScore}>{c.score}</span>}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id="agent-tabpanel" aria-labelledby={`agent-tab-${column.agent_id}`} style={s.panel}>
        <div style={s.summary(look.accent)}>
          {status === "done" && column.score != null && <CircularScore score={column.score} size={52} />}
          <div style={s.summaryMain}>
            <div style={s.summaryName(look.accent)}>{column.agent_name}</div>
            {status !== "done" && (
              <div>
                <Badge color={STATUS_COLOR[status]} dot>
                  {t(`status.${status}`)}
                </Badge>
              </div>
            )}
            {status === "failed" && column.error && <div style={s.error}>{column.error}</div>}
            {column.summary && (
              <div style={s.summaryText}>
                <Markdown>{column.summary}</Markdown>
              </div>
            )}
          </div>
          <div style={s.summaryAside}>
            <Button kind="ghost" size="sm" onClick={() => onViewTrace(column)}>
              {t("column.viewTrace")}
            </Button>
            <span className="mono">
              {seconds == null ? NO_DURATION : t("column.time", { seconds })} · {formatCost(column.cost_usd)}
            </span>
            {status === "running" && (
              <Button kind="danger" size="sm" loading={pendingAgentId === column.agent_id} onClick={() => onCancel(column)}>
                {t("column.cancel")}
              </Button>
            )}
            {(status === "failed" || status === "cancelled") && (
              <Button
                kind="secondary"
                size="sm"
                icon="RefreshCw"
                loading={pendingAgentId === column.agent_id}
                onClick={() => onRetry(column)}
              >
                {t("column.retry")}
              </Button>
            )}
          </div>
        </div>

        {status === "running" && <RunningLog runId={column.run_id} />}
        {findings.map((f) => (
          <FindingCard key={f.id} f={f} repoFullName={repoFullName} headSha={headSha} {...cardProps(f)} />
        ))}
        {status !== "running" && findings.length === 0 && <div style={s.empty}>{t("tabs.noFindings")}</div>}
      </div>
    </div>
  );
}
