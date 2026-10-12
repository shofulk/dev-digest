/* PR-header link to the newest multi-run of this PR — shown only once the PR has a multi-run. Renders
   nothing while loading, on error or for an empty list (no error copy, no toast). */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMultiRuns } from "@/lib/hooks";
import { newestRunHref } from "@/lib/multi-agent-history";
import { s } from "./styles";

export function OpenMultiRunLink({ repoId, prId }: { repoId?: string; prId: string | null }) {
  const t = useTranslations("multiAgent");
  const { data } = useMultiRuns(repoId, { prId });
  const href = repoId ? newestRunHref(repoId, data) : null;
  if (!href) return null;
  return (
    <Link href={href} style={s.link}>
      {t("prLink.open")}
    </Link>
  );
}
