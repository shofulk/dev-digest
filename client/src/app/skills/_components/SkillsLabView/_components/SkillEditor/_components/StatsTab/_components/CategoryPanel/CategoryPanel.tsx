/* CategoryPanel — findings by category as a donut plus a `category → count` legend. The legend
   is also the accessible table view of the chart. Counts, not currency. No findings renders an
   empty state ("no data yet"), not an error. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Cell, Pie, PieChart, Tooltip } from "recharts";
import type { SkillStats } from "@devdigest/shared";
import { Card, EmptyState, SectionLabel } from "@devdigest/ui";
import { DONUT_SIZE, DONUT_STROKE, SERIES_CSS, SERIES_SCOPE } from "../../constants";
import { toDonutSegments, totalOf } from "../../helpers";
import { s } from "./styles";

const TOOLTIP_STYLE: React.CSSProperties = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border-strong)",
  borderRadius: 6,
  fontSize: 12.5,
  color: "var(--text-primary)",
};

export function CategoryPanel({ byCategory }: { byCategory: SkillStats["by_category"] }) {
  const t = useTranslations("skills");
  const segments = React.useMemo(() => toDonutSegments(byCategory, t("stats.category.other")), [byCategory, t]);
  const total = totalOf(segments);

  return (
    <Card>
      <SectionLabel icon="BarChart">{t("stats.category.title")}</SectionLabel>
      {segments.length === 0 ? (
        <EmptyState title={t("stats.category.empty.title")} body={t("stats.category.empty.body")} />
      ) : (
        <div className={SERIES_SCOPE} style={s.body}>
          <style>{SERIES_CSS}</style>
          <div style={s.chart}>
            <PieChart width={DONUT_SIZE} height={DONUT_SIZE} role="img" aria-label={t("stats.category.chartLabel", { count: total })}>
              <Pie
                data={segments}
                dataKey="value"
                nameKey="label"
                cx="50%"
                cy="50%"
                innerRadius={(DONUT_SIZE - DONUT_STROKE) / 2 - DONUT_STROKE / 2}
                outerRadius={(DONUT_SIZE - DONUT_STROKE) / 2 + DONUT_STROKE / 2}
                startAngle={90}
                endAngle={-270}
                paddingAngle={segments.length > 1 ? 1 : 0}
                isAnimationActive={false}
                stroke="var(--bg-elevated)"
                strokeWidth={2}
              >
                {segments.map((seg) => (
                  <Cell key={seg.label} fill={seg.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: "var(--text-primary)" }} />
            </PieChart>
            <div style={s.center}>
              <div style={s.total}>
                <div className="tnum" style={s.totalValue}>
                  {total}
                </div>
                <div style={s.totalLabel}>{t("stats.category.totalLabel")}</div>
              </div>
            </div>
          </div>
          <ul style={s.legend} aria-label={t("stats.category.legendLabel")}>
            {segments.map((seg) => (
              <li key={seg.label} style={s.legendRow}>
                <span aria-hidden style={s.swatch(seg.color)} />
                <span style={s.legendLabel}>{seg.label}</span>
                <span className="mono tnum" style={s.legendCount}>
                  {seg.value}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
