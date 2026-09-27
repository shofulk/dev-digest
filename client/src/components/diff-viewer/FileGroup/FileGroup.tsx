/* FileGroup — one collapsible role group in Smart order (AC1/AC2): a colour
   square, label + subtitle, and the open-findings/files-count summary on the
   right. Collapse state is initialised from `DEFAULT_COLLAPSED_ROLES`. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { SmartDiffRole } from "@devdigest/shared";
import { ROLE_COLOR, DEFAULT_COLLAPSED_ROLES } from "../constants";
import { s, chevronFor } from "../styles";

const LABEL_KEY: Record<SmartDiffRole, string> = {
  core: "coreLabel",
  tests: "testsLabel",
  wiring: "wiringLabel",
  docs: "docsLabel",
  boilerplate: "boilerplateLabel",
};

const SUBTITLE_KEY: Record<SmartDiffRole, string> = {
  core: "coreSubtitle",
  tests: "testsSubtitle",
  wiring: "wiringSubtitle",
  docs: "docsSubtitle",
  boilerplate: "boilerplateSubtitle",
};

export function FileGroup({
  role,
  filesCount,
  findingFilesCount,
  children,
}: {
  role: SmartDiffRole;
  filesCount: number;
  /** Number of files in the group with at least one OPEN finding (D4). */
  findingFilesCount: number;
  children: React.ReactNode;
}) {
  const t = useTranslations("shell");
  const [open, setOpen] = React.useState(!DEFAULT_COLLAPSED_ROLES.has(role));

  return (
    <div style={s.fileGroup}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setOpen((o) => !o);
        }}
        style={s.groupHeader}
      >
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <span style={{ ...s.roleSquare, background: ROLE_COLOR[role] }} />
        <div style={s.groupLabelWrap}>
          <span style={s.groupLabel}>{t(`diffViewer.${LABEL_KEY[role]}`)}</span>
          <span style={s.groupSubtitle}>{t(`diffViewer.${SUBTITLE_KEY[role]}`)}</span>
        </div>
        <div style={s.groupRight}>
          {findingFilesCount > 0 && (
            <span
              aria-label={t("diffViewer.filesWithFindingsAria", { count: findingFilesCount })}
              style={s.groupFindingCount}
            >
              {t("diffViewer.filesWithFindings", { count: findingFilesCount })}
            </span>
          )}
          <span style={s.groupFilesCount}>{t("diffViewer.filesCount", { count: filesCount })}</span>
        </div>
      </div>
      {open && <div style={s.groupBody}>{children}</div>}
    </div>
  );
}
