/* MetricTile — one metric: label, large coloured value, optional signed point delta and an
   optional sparkline (only at >= 2 points: the vendor Sparkline divides by length - 1). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Sparkline } from "@devdigest/ui";
import { toneColor } from "@/lib/eval-metrics";
import { s } from "./styles";

export function MetricTile({
  label,
  value,
  color,
  delta,
  trend,
}: {
  label: string;
  value: string;
  color: string;
  delta?: { direction: "up" | "down" | "flat"; points: number };
  trend?: number[];
}) {
  const t = useTranslations("eval");
  return (
    <div style={s.tile}>
      <div style={s.label}>{label}</div>
      <div style={s.body}>
        <span className="tnum" style={s.value(color)}>
          {value}
        </span>
        {delta && (
          <span className="tnum" style={s.delta(toneColor(delta.direction))}>
            {delta.direction === "flat"
              ? t("suite.deltaFlat")
              : t(delta.direction === "up" ? "suite.deltaUp" : "suite.deltaDown", { points: delta.points })}
          </span>
        )}
        {trend && trend.length >= 2 && (
          <span style={s.spark}>
            <Sparkline data={trend} color={color} />
          </span>
        )}
      </div>
    </div>
  );
}
