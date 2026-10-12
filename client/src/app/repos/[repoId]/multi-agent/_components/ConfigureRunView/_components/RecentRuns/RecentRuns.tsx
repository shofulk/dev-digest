/* The repo's newest multi-runs, under the Configure run form. Owns its own query,
   so a slow or failed list never touches the form above it. */
"use client";

import React from "react";
import Link from "next/link";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { useMultiRuns } from "@/lib/hooks";
import { recentRuns, runSeconds } from "@/lib/multi-agent-history";
import { formatCost } from "@/lib/format-cost";
import { STATUS_LOOK, s } from "./styles";

export function RecentRuns({ repoId }: { repoId: string }) {
  const t = useTranslations("multiAgent");
  const format = useFormatter();
  const now = useNow();
  // The viewer's zone, passed explicitly: the provider sets none (CH5).
  const timeZone = React.useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const { data, isPending, isError, refetch } = useMultiRuns(repoId);
  const titleId = "recent-runs-title";

  let body: React.ReactNode;
  if (!repoId || isPending) {
    body = (
      <div style={s.skeletons}>
        <Skeleton height={44} />
        <Skeleton height={44} />
        <Skeleton height={44} />
      </div>
    );
  } else if (isError) {
    body = (
      <div>
        <ErrorState title={t("history.error")} />
        <div style={s.retry}>
          <Button kind="ghost" size="sm" onClick={() => refetch()}>
            {t("history.retry")}
          </Button>
        </div>
      </div>
    );
  } else {
    const rows = recentRuns(data);
    body =
      rows.length === 0 ? (
        <EmptyState title={t("history.emptyTitle")} body={t("history.emptyBody")} />
      ) : (
        <ul style={s.list}>
          {rows.map((r) => {
            const ranAt = new Date(r.ran_at);
            const seconds = runSeconds(r.total_duration_ms);
            const look = STATUS_LOOK[r.status];
            return (
              <li key={r.id}>
                <Link href={`/repos/${repoId}/multi-agent/${r.id}`} style={s.row}>
                  <span style={s.pr}>{t("history.prItem", { number: r.pr_number, title: r.pr_title })}</span>
                  <time
                    dateTime={r.ran_at}
                    title={format.dateTime(ranAt, { dateStyle: "medium", timeStyle: "short", timeZone })}
                    style={s.meta}
                  >
                    {format.relativeTime(ranAt, now)}
                  </time>
                  <span style={s.meta}>{t("history.agents", { count: r.agent_count })}</span>
                  <Badge color={look.color} bg={look.bg}>
                    {t(`history.status.${r.status}`)}
                  </Badge>
                  <span className="mono" style={s.meta}>
                    {seconds === null ? t("history.none") : t("history.seconds", { seconds })}
                  </span>
                  <span className="mono" style={s.meta}>
                    {formatCost(r.total_cost_usd)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      );
  }

  return (
    <section aria-labelledby={titleId} style={s.section}>
      <h2 id={titleId} style={s.title}>
        {t("history.title")}
      </h2>
      {body}
    </section>
  );
}
