/* DiffViewer — basic GitHub-style unified diff viewer. Renders real PrFile.patch
   (unified-diff text from the F1 API) as a list of collapsible FileCards.
   Optional inline comments (Files changed tab): hover a line → "+" → comment,
   posted live to GitHub; existing GitHub review comments render inline.
   Smart order (AC1/AC5): pass `groups` to render role-grouped `FileGroup`s
   instead of the flat list; `findings` overlays live finding dots/cards
   (AC3/AC4) in either order. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { PrFile } from "@/lib/types";
import { type DiffCommentApi } from "../comments";
import { type DiffFindingApi, findingsForFile, isOpenFinding } from "../findings";
import { type SmartDiffFileGroup } from "../helpers";
import { s } from "../styles";
import { FileCard } from "../FileCard";
import { FileGroup } from "../FileGroup";

export function DiffViewer({
  files,
  commenting,
  groups,
  findings,
}: {
  files: PrFile[];
  commenting?: DiffCommentApi;
  /** Smart order (AC1) when set and non-empty; flat GitHub order otherwise. */
  groups?: SmartDiffFileGroup[] | null;
  findings?: DiffFindingApi;
}) {
  const t = useTranslations("shell");
  if (!files || files.length === 0) {
    return <div style={s.empty}>{t("diffViewer.noChangedFiles")}</div>;
  }

  if (groups && groups.length > 0) {
    return (
      <div style={s.list}>
        {groups.map((g) => {
          const findingFilesCount = findings
            ? g.files.filter((f) => findingsForFile(findings.findings, f.path).some(isOpenFinding)).length
            : 0;
          return (
            <FileGroup key={g.role} role={g.role} filesCount={g.files.length} findingFilesCount={findingFilesCount}>
              {g.files.map((f) => (
                <FileCard key={f.path} file={f} commenting={commenting} findings={findings} />
              ))}
            </FileGroup>
          );
        })}
      </div>
    );
  }

  return (
    <div style={s.list}>
      {files.map((f) => (
        <FileCard key={f.path} file={f} commenting={commenting} findings={findings} />
      ))}
    </div>
  );
}
