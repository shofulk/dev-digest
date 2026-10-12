/* MetricBar — a 0..1 metric as a coloured horizontal bar plus its whole percent. `null`
   (not computable) renders a dash and no meter. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { formatPercent } from "@/lib/eval-metrics";
import { s } from "./styles";

export function MetricBar({ value, color, label }: { value: number | null; color: string; label: string }) {
  const t = useTranslations("eval");
  if (value == null) return <span style={s.empty}>{t("suite.metricEmpty")}</span>;
  const pct = Math.min(100, Math.max(0, Math.round(value * 100)));
  return (
    <div style={s.wrap}>
      <div role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label} style={s.track}>
        <div style={s.fill(pct, color)} />
      </div>
      <span className="tnum" style={s.text}>
        {formatPercent(value)}
      </span>
    </div>
  );
}
