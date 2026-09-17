import type { FindingRecord, ReviewRecord, Severity } from "@devdigest/shared";
import { RATIONALE_PREVIEW_CHARS, ANCHOR_OFFSET, POPOVER_WIDTH, POPOVER_MAX_HEIGHT } from "./constants";

/** Every finding of one severity across all of the PR's reviews — the same set the list's
 *  counters were computed from server-side. */
export function findingsOfSeverity(
  reviews: ReviewRecord[] | undefined,
  severity: Severity,
): FindingRecord[] {
  return (reviews ?? []).flatMap((r) => r.findings).filter((f) => f.severity === severity);
}

export function previewOf(rationale: string): string {
  const flat = rationale.replace(/\s+/g, " ").trim();
  return flat.length > RATIONALE_PREVIEW_CHARS
    ? `${flat.slice(0, RATIONALE_PREVIEW_CHARS)}…`
    : flat;
}

/** Fixed-position coordinates for the popover: below the cell, nudged back inside the
 *  viewport, and flipped above when there is no room underneath. */
export function popoverPosition(
  anchor: DOMRect | null,
  viewport: { width: number; height: number },
): { top: number; left: number } {
  if (!anchor) return { top: ANCHOR_OFFSET, left: ANCHOR_OFFSET };
  const left = Math.max(
    ANCHOR_OFFSET,
    Math.min(anchor.left, viewport.width - POPOVER_WIDTH - ANCHOR_OFFSET),
  );
  const below = anchor.bottom + ANCHOR_OFFSET;
  const fitsBelow = below + POPOVER_MAX_HEIGHT <= viewport.height;
  const top = fitsBelow
    ? below
    : Math.max(ANCHOR_OFFSET, anchor.top - POPOVER_MAX_HEIGHT - ANCHOR_OFFSET);
  return { top, left };
}
