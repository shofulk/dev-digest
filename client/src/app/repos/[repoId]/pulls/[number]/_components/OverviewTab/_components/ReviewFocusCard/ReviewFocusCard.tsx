/* ReviewFocusCard — the Overview tab's "Review focus" card (AC-55, AC-56,
   AC-57): an ordered list of where to start reading, each item opening the
   Files changed tab at its cited file/line. Colocated under its only
   consumer, OverviewTab. Loading gates on `!prId || isPending`, never
   `isLoading` (client/INSIGHTS.md, 2026-10-03). Reason text is a plain text
   node — never Markdown/dangerouslySetInnerHTML/MonoLink (AC-69). */
"use client";

import { useTranslations } from "next-intl";
import { Card, SectionLabel, Skeleton } from "@devdigest/ui";
import { usePrBrief } from "@/lib/hooks/brief";
import { s } from "./styles";

export function ReviewFocusCard({
  prId,
  onOpenFile,
}: {
  prId: string | null;
  onOpenFile?: (path: string, line: number | null) => void;
}) {
  const t = useTranslations("brief");
  const { data, isPending } = usePrBrief(prId);
  const loading = !prId || isPending;
  const brief = data?.brief ?? null;
  const items = brief?.review_focus ?? [];

  return (
    <Card>
      <div style={s.header}>
        <SectionLabel icon="ListChecks">{t("focus.title")}</SectionLabel>
        {brief && items.length > 0 && <span style={s.count}>{t("focus.count", { count: items.length })}</span>}
      </div>

      {loading ? (
        <Skeleton height={48} />
      ) : !brief || items.length === 0 ? (
        <div style={s.hint}>{t("focus.empty")}</div>
      ) : (
        <ol style={s.list}>
          {items.map((item, i) => {
            const label = item.line != null ? `${item.file}:${item.line} — ${item.reason}` : `${item.file} — ${item.reason}`;
            return (
              <li key={i} style={s.item}>
                <button
                  type="button"
                  style={s.itemButton}
                  onClick={() => onOpenFile?.(item.file, item.line)}
                >
                  {label}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
