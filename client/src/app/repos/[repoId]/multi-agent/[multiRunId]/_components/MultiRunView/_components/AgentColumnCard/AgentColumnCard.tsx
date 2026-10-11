/* AgentColumnCard — one agent's column in Columns mode: accent + name + time/cost +
   score ring, then the status body (live log while running, error when failed, findings
   otherwise) and the footer (View trace, Retry / Cancel, findings count). */
"use client";

import { useTranslations } from "next-intl";
import { Badge, Button, CircularScore, Icon, Markdown, SEV } from "@devdigest/ui";
import type { AgentColumn } from "@devdigest/shared";
import { SeverityMark } from "@/components/finding-card";
import { agentLook } from "@/lib/agent-look";
import { formatCost } from "@/lib/format-cost";
import { NO_DURATION, fileLine, secondsOf } from "../../helpers";
import { RunningLog } from "../RunningLog";
import { s } from "./styles";

const STATUS_COLOR = { running: "var(--warn)", failed: "var(--crit)", cancelled: "var(--text-muted)" } as const;

export function AgentColumnCard({
  column,
  onViewTrace,
  onRetry,
  onCancel,
  retryPending,
  cancelPending,
}: {
  column: AgentColumn;
  onViewTrace: (column: AgentColumn) => void;
  onRetry: (column: AgentColumn) => void;
  onCancel: (column: AgentColumn) => void;
  retryPending?: boolean;
  cancelPending?: boolean;
}) {
  const t = useTranslations("multiAgentResults");
  const look = agentLook(column.agent_id);
  const I = Icon[look.icon];
  const seconds = secondsOf(column.duration_ms);
  const status = column.status;

  return (
    <section style={s.card(look.accent)} aria-label={column.agent_name} data-agent-id={column.agent_id}>
      <div style={s.head}>
        <div style={s.iconBox(look.accent)}>
          <I size={16} />
        </div>
        <div style={s.headMain}>
          <div style={s.name}>{column.agent_name}</div>
          <div className="mono" style={s.meta}>
            {seconds == null ? NO_DURATION : t("column.time", { seconds })} · {formatCost(column.cost_usd)}
          </div>
        </div>
        {status === "done" && column.score != null && <CircularScore score={column.score} size={36} stroke={3} />}
      </div>

      <div style={s.body}>
        {status !== "done" && (
          <div style={s.statusRow}>
            <Badge color={STATUS_COLOR[status]} dot>
              {t(`status.${status}`)}
            </Badge>
          </div>
        )}
        {status === "running" && <RunningLog runId={column.run_id} />}
        {status === "failed" && column.error && <div style={s.error}>{column.error}</div>}
        {status !== "running" &&
          column.findings.map((f) => (
            <div key={f.id} data-finding-id={f.id} style={s.finding(SEV[f.severity]?.c ?? "var(--text-muted)")}>
              <div style={s.findingTitle}>
                <SeverityMark severity={f.severity} />
                <Markdown>{f.title}</Markdown>
              </div>
              <div className="mono" style={s.findingFile}>
                {fileLine(f.file, f.start_line)}
              </div>
            </div>
          ))}
        {status === "done" && column.findings.length === 0 && <div style={s.empty}>{t("column.noFindings")}</div>}
      </div>

      <div style={s.foot}>
        <Button kind="ghost" size="sm" onClick={() => onViewTrace(column)}>
          {t("column.viewTrace")}
        </Button>
        {status === "running" && (
          <Button kind="danger" size="sm" loading={cancelPending} onClick={() => onCancel(column)}>
            {t("column.cancel")}
          </Button>
        )}
        {(status === "failed" || status === "cancelled") && (
          <Button kind="secondary" size="sm" icon="RefreshCw" loading={retryPending} onClick={() => onRetry(column)}>
            {t("column.retry")}
          </Button>
        )}
        <span style={s.count}>{t("column.findingsCount", { count: column.findings.length })}</span>
      </div>
    </section>
  );
}
