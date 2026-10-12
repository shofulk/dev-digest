/* ResultsHeader — PR number + title (plain text), the "<N> agents · parallel · <time>s
   total · $<cost>" line, the Columns / Tabs switch, "Configure run" and "Cancel all". */
"use client";

import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import { formatCost } from "@/lib/format-cost";
import { estimateSeconds } from "@/lib/multi-agent-estimates";
import type { MultiRunViewMode } from "../../helpers";
import { s } from "./styles";

const MODES: MultiRunViewMode[] = ["columns", "tabs"];

export function ResultsHeader({
  prNumber,
  prTitle,
  agentCount,
  totalDurationMs,
  totalCostUsd,
  view,
  onViewChange,
  onConfigure,
  showCancelAll,
  cancelAllPending,
  onCancelAll,
}: {
  prNumber: number | null;
  prTitle: string | null;
  agentCount: number;
  totalDurationMs: number;
  totalCostUsd: number | null;
  view: MultiRunViewMode;
  onViewChange: (v: MultiRunViewMode) => void;
  onConfigure: () => void;
  showCancelAll: boolean;
  cancelAllPending: boolean;
  onCancelAll: () => void;
}) {
  const t = useTranslations("multiAgentResults");
  return (
    <div style={s.root}>
      <div style={s.topRow}>
        <Button kind="secondary" size="sm" icon="Settings" onClick={onConfigure}>
          {t("configureRun")}
        </Button>
        <h1 style={s.heading}>{t("header.title")}</h1>
        <div style={s.spacer} />
        {showCancelAll && (
          <Button kind="danger" size="sm" loading={cancelAllPending} onClick={onCancelAll}>
            {t("column.cancelAll")}
          </Button>
        )}
        <div style={s.switchGroup} role="group" aria-label={t("view.label")}>
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={view === m}
              style={s.switchBtn(view === m)}
              onClick={() => onViewChange(m)}
            >
              {t(`view.${m}`)}
            </button>
          ))}
        </div>
      </div>
      <div style={s.prRow}>
        {prNumber != null && (
          <span className="mono" style={s.prNumber}>
            {t("header.prNumber", { number: prNumber })}
          </span>
        )}
        {prTitle && <span style={s.prTitle}>{prTitle}</span>}
        <span style={s.meta}>
          {t("header.meta", {
            count: agentCount,
            seconds: estimateSeconds(totalDurationMs),
            cost: formatCost(totalCostUsd),
          })}
        </span>
      </div>
    </div>
  );
}
