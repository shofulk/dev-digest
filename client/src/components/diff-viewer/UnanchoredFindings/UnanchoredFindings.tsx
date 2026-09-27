/* UnanchoredFindings — top-of-body block for findings whose line isn't in the
   current patch (including a null patch), patterned on `OutdatedComments`. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import type { DiffFindingApi } from "../findings";
import { cs } from "../comments";

export function UnanchoredFindings({
  findings,
  api,
}: {
  findings: FindingRecord[];
  api: DiffFindingApi;
}) {
  const t = useTranslations("shell");
  if (findings.length === 0) return null;
  return (
    <div style={cs.outdatedWrap}>
      <span style={cs.outdatedTitle}>{t("diffViewer.unanchoredTitle", { count: findings.length })}</span>
      {findings.map((f) => (
        <React.Fragment key={f.id}>{api.renderFinding(f)}</React.Fragment>
      ))}
    </div>
  );
}
