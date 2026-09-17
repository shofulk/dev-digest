/* FindingsCell — the PR list's FINDINGS column: compact per-severity counters that open a
   popover listing that level's findings. The counts ride along on the list response
   (PrMeta.findings_by_severity); the findings themselves are fetched only when a level is
   opened, by the popover. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { PrMeta, Severity } from "@devdigest/shared";
import { SeverityCounters } from "@/components/severity-counters";
import { FindingsPopover } from "./_components/FindingsPopover";
import { s } from "./styles";

const NO_COUNTS = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 } as const;

export function FindingsCell({ pr, repoId }: { pr: PrMeta; repoId: string }) {
  const t = useTranslations("prReview");
  const [open, setOpen] = React.useState<Severity | null>(null);
  // The popover is position:fixed (the list card clips absolutely-positioned children), so
  // it measures this cell itself — on open and again whenever the page scrolls.
  const cellRef = React.useRef<HTMLDivElement | null>(null);

  // A null score is the list's "never reviewed" signal — same test the SCORE cell uses.
  // Unknown reads as an em dash here exactly as it does in SCORE and COST.
  if (pr.score == null)
    return (
      <span style={s.never} title={t("list.findings.never")}>
        —
      </span>
    );

  const counts = pr.findings_by_severity ?? NO_COUNTS;

  const toggle = (severity: Severity | null) => {
    setOpen(severity == null || severity === open ? null : severity);
  };

  return (
    // The whole row navigates on click, so every click in here stops there — a counter
    // opens the popover instead of leaving the page.
    <div ref={cellRef} style={s.cell} onClick={(e) => e.stopPropagation()}>
      <SeverityCounters
        compact
        counts={counts}
        active={open}
        onSelect={toggle}
        buttonProps={(level) => ({
          "aria-haspopup": "dialog",
          "aria-expanded": open === level,
        })}
      />
      {open && pr.id && (
        <FindingsPopover
          prId={pr.id}
          prNumber={pr.number}
          repoId={repoId}
          severity={open}
          anchorRef={cellRef}
          onClose={() => setOpen(null)}
        />
      )}
      {counts.CRITICAL + counts.WARNING + counts.SUGGESTION === 0 && (
        // Reviewed and clean. A tick, not an em dash: the dash already means "never
        // reviewed" one column over, and the two states must not read alike.
        <Icon.Check
          size={14}
          aria-label={t("list.findings.clean")}
          style={{ color: "var(--ok)" }}
        />
      )}
    </div>
  );
}
