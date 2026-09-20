/* SeverityCounters — the per-severity finding tally, on two surfaces:
   - the PR header, as "3 CRITICAL · 5 WARNING · 2 SUGGESTION", where each level toggles the
     page's findings filter (the selection itself lives in the URL, ?severity=);
   - the PR list's FINDINGS cell, in `compact` form (icon + count, empty levels dropped),
     where a level opens that level's findings popover.
   Either way the component is pure: it renders what it is given and reports a click. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SEV } from "@devdigest/ui";
import type { Severity } from "@devdigest/shared";
import { SEVERITY_LEVELS } from "./constants";
import { isEmptyCounts, type SeverityCounts } from "./helpers";
import { s } from "./styles";

export function SeverityCounters({
  counts,
  active,
  onSelect,
  compact = false,
  buttonProps,
}: {
  counts: SeverityCounts;
  /** The severity currently filtered on, or null for "all findings". */
  active: Severity | null;
  onSelect: (severity: Severity | null) => void;
  /** Tight variant for a table cell: no level labels, and empty levels are dropped. */
  compact?: boolean;
  /** Extra attributes for each level button (e.g. the popover's aria-expanded). */
  buttonProps?: (severity: Severity) => React.ButtonHTMLAttributes<HTMLButtonElement>;
}) {
  const t = useTranslations("prReview");

  // A PR with no findings gets no row at all — the tab's own empty state already speaks.
  if (isEmptyCounts(counts)) return null;

  // In compact form an empty level is dropped rather than greyed: the cell has no room to
  // spend on zeros, and the header row above is where the full picture belongs.
  const levels = compact
    ? SEVERITY_LEVELS.filter((level) => counts[level] > 0 || active === level)
    : SEVERITY_LEVELS;

  return (
    <div
      style={compact ? s.rowCompact : s.row}
      role="group"
      aria-label={t("severityFilter.groupLabel")}
    >
      {levels.map((level, i) => {
        const count = counts[level];
        const isActive = active === level;
        // An empty level is inert — except while it is the active one, or a re-run that
        // empties it would trap the user in a view they cannot clear.
        const disabled = count === 0 && !isActive;
        const label = t(`severityFilter.level.${level}`);
        const tone = SEV[level];
        const LevelIcon = Icon[tone.icon];
        return (
          <React.Fragment key={level}>
            {i > 0 && !compact && (
              <span style={s.sep} aria-hidden="true">
                ·
              </span>
            )}
            <button
              type="button"
              {...buttonProps?.(level)}
              disabled={disabled}
              aria-pressed={isActive}
              aria-label={
                disabled
                  ? t("severityFilter.none", { level })
                  : isActive
                    ? t("severityFilter.clear", { level })
                    : t("severityFilter.select", { level, count })
              }
              onClick={() => onSelect(isActive ? null : level)}
              style={{
                ...s.button(isActive, disabled),
                ...(compact ? s.buttonCompact : null),
                color: tone.c,
                background: isActive ? tone.bg : "transparent",
              }}
            >
              <LevelIcon size={12.5} />
              <span className="tnum">{count}</span>
              {compact ? null : label}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default SeverityCounters;
