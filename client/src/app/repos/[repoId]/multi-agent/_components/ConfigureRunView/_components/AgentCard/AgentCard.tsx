/* One selectable agent on Configure run: checkbox, accent icon tile, name over description, estimate. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { Agent, RunEstimate } from "@devdigest/shared";
import { agentLook } from "@/lib/agent-look";
import { estimateFor } from "@/lib/multi-agent-estimates";
import { NO_COST, formatCost } from "@/lib/format-cost";
import { s } from "./styles";

export function AgentCard({
  agent,
  checked,
  estimate,
  onChange,
}: {
  agent: Agent;
  checked: boolean;
  estimate?: RunEstimate;
  onChange: (checked: boolean) => void;
}) {
  const t = useTranslations("multiAgent");
  const { accent, icon } = agentLook(agent.id);
  const I = Icon[icon];
  const { seconds, costUsd } = estimateFor(estimate);
  const hasEstimate = seconds != null || costUsd != null;
  return (
    <div style={s.card(accent, checked)}>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={agent.name}
        onClick={() => onChange(!checked)}
        style={s.checkbox(accent, checked)}
      >
        {checked && <Icon.Check size={11} style={s.check} />}
      </button>
      <span style={s.iconBox(accent)} aria-hidden>
        <I size={16} />
      </span>
      <div style={s.body}>
        <div style={s.name}>{agent.name}</div>
        <div style={s.desc}>{agent.description}</div>
      </div>
      <span className="mono" style={s.estimate}>
        {hasEstimate
          ? t("configure.estimate", { time: seconds == null ? NO_COST : t("configure.seconds", { seconds }), cost: formatCost(costUsd) })
          : t("configure.noEstimate")}
      </span>
    </div>
  );
}
