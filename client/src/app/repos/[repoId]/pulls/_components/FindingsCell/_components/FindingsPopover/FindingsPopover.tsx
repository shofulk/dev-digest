/* FindingsPopover — the list's preview of one severity's findings for one PR. The list
   response carries only counts, so the findings themselves are fetched here, lazily, from
   the endpoint the PR detail page already uses: same query key, so opening this after
   visiting the PR (or vice versa) costs nothing. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import {
  Icon,
  SEV,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  Skeleton,
  EmptyState,
  type Category,
} from "@devdigest/ui";
import type { Severity } from "@devdigest/shared";
import { usePrReviews } from "@/lib/hooks/reviews";
import { findingsOfSeverity, popoverPosition, previewOf } from "./helpers";
import { s } from "./styles";

/** Viewport coordinates for the box, from the anchor's current rect. */
function measure(anchor: HTMLElement | null): { top: number; left: number } {
  const viewport =
    typeof window === "undefined"
      ? { width: 1280, height: 800 }
      : { width: window.innerWidth, height: window.innerHeight };
  return popoverPosition(anchor?.getBoundingClientRect() ?? null, viewport);
}

export function FindingsPopover({
  prId,
  prNumber,
  repoId,
  severity,
  anchorRef,
  onClose,
}: {
  prId: string;
  prNumber: number;
  repoId: string;
  severity: Severity;
  /** The cell that opened it — re-measured on scroll/resize, since the box is positioned
   *  in viewport coordinates and the list scrolls under it. */
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const t = useTranslations("prReview");
  // Fetched only while open — this component is mounted by the cell on demand.
  const { data: reviews, isLoading } = usePrReviews(prId);
  const ref = React.useRef<HTMLDivElement | null>(null);

  // Close on Escape and on a click outside. NOT on scroll: the popover has its own
  // scrollbar, and a `scroll` listener in the capture phase sees that inner scroll too —
  // closing there makes the list unreadable the moment you try to read it. Instead the
  // position is re-measured, which is what the stale-rect problem actually needs.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPointer = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [onClose]);

  // Re-anchor on any scroll (capture, so ancestor scrollers count) and on resize. Measuring
  // the anchor is idempotent, so an inner scroll simply recomputes the same coordinates.
  const [pos, setPos] = React.useState(() => measure(anchorRef.current));
  React.useEffect(() => {
    let frame = 0;
    const reposition = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setPos(measure(anchorRef.current)));
    };
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [anchorRef]);

  React.useEffect(() => {
    ref.current?.focus();
  }, []);

  const findings = findingsOfSeverity(reviews, severity);
  const tone = SEV[severity];
  const LevelIcon = Icon[tone.icon];
  const level = t(`severityFilter.level.${severity}`);
  const title = t("list.findings.popoverTitle", { count: findings.length, level });

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={title}
      tabIndex={-1}
      onClick={(e) => e.stopPropagation()}
      style={s.popover(pos.top, pos.left)}
    >
      <div style={s.head}>
        <LevelIcon size={13} style={{ color: tone.c }} />
        {isLoading ? t("list.findings.loading") : title}
      </div>

      {isLoading ? (
        <div style={s.list}>
          <Skeleton height={14} width={240} />
          <Skeleton height={12} width={180} />
          <Skeleton height={12} />
        </div>
      ) : findings.length === 0 ? (
        <EmptyState
          icon="Filter"
          title={t("list.findings.emptyTitle")}
          body={t("list.findings.emptyBody")}
        />
      ) : (
        <div style={s.list}>
          {findings.map((f) => (
            <div key={f.id} style={s.item}>
              <div style={s.titleRow}>
                <span style={s.title}>{f.title}</span>
                <CategoryTag category={f.category as Category} />
              </div>
              <div style={s.metaRow}>
                <MonoLink>
                  {f.file}:{f.start_line === f.end_line ? f.start_line : `${f.start_line}-${f.end_line}`}
                </MonoLink>
                <ConfidenceNum value={f.confidence} />
              </div>
              <div style={s.rationale}>{previewOf(f.rationale)}</div>
            </div>
          ))}
        </div>
      )}

      <div style={s.footer}>
        <Link
          href={`/repos/${repoId}/pulls/${prNumber}?tab=findings&severity=${severity}`}
          style={s.link}
        >
          {t("list.findings.openInPr")} →
        </Link>
      </div>
    </div>
  );
}
