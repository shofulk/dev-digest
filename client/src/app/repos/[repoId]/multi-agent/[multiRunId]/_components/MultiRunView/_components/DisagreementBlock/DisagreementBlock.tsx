/* DisagreementBlock — "Where agents disagree": one row per group (file:line, title) with
   one cell per done agent — its severity + finding title, or "did not flag" (no reason).
   Shown in both modes. Fewer than two done agents → "Not enough finished agents". */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Markdown, SectionLabel, SeverityBadge, Toggle } from "@devdigest/ui";
import type { AgentColumn, Conflict } from "@devdigest/shared";
import { canCompare, disagreementCells, fileLine, visibleGroups } from "../../helpers";
import { s } from "./styles";

export function DisagreementBlock({ columns, groups }: { columns: AgentColumn[]; groups: Conflict[] }) {
  const t = useTranslations("multiAgentResults");
  const [onlyConflicts, setOnlyConflicts] = React.useState(false);
  const comparable = canCompare(columns);
  const rows = visibleGroups(groups, onlyConflicts);

  return (
    <section style={s.root} aria-label={t("disagree.title")}>
      <SectionLabel
        icon="Activity"
        right={
          <label style={s.toggleLabel}>
            {t("disagree.onlyConflicts")}
            <Toggle on={onlyConflicts} onChange={setOnlyConflicts} />
          </label>
        }
      >
        {t("disagree.title")}
      </SectionLabel>

      {!comparable && <div style={s.notice}>{t("disagree.notEnough")}</div>}
      {comparable && rows.length === 0 && <div style={s.notice}>{t("disagree.empty")}</div>}
      {comparable &&
        rows.map((g, i) => (
          <div key={`${g.file}:${g.line}:${i}`} style={s.group}>
            <div style={s.groupHead}>
              <span className="mono" style={s.groupFile}>
                {fileLine(g.file, g.line)}
              </span>
              <div style={s.groupTitle}>
                <Markdown>{g.title}</Markdown>
              </div>
            </div>
            <div style={s.cells}>
              {disagreementCells(g).map((c) => (
                <div key={c.agentId} style={s.cell}>
                  <span style={s.cellAgent}>{c.agentName}</span>
                  {c.flagged && c.severity ? (
                    <>
                      <span>
                        <SeverityBadge severity={c.severity} />
                      </span>
                      <div style={s.cellTitle}>
                        <Markdown>{c.title}</Markdown>
                      </div>
                    </>
                  ) : (
                    <span style={s.cellNone}>
                      <span style={s.dot} aria-hidden="true" />
                      {t("disagree.didNotFlag")}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
    </section>
  );
}
