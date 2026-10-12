/* BriefBanner/helpers.ts — pure formatting, no `use` prefix
   (frontend-ui-architecture "logic placement"). */
import type { ReviewRecord } from "@devdigest/shared";

/** `8200` → `"8.2K"`; below 1000, the plain number (Interfaces §UI). */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}K`;
}

/** `0.014` → `"0.014"` (3 decimals, Interfaces §UI). */
export function formatCost(n: number): string {
  return n.toFixed(3);
}

/** The newest `kind: 'review'` review, by `created_at` — the one the banner's
 *  verdict/findings/blockers row reflects (S14). `undefined` when the PR has
 *  no review yet (AC-38). */
export function latestReview(reviews: ReviewRecord[] | undefined): ReviewRecord | undefined {
  return (reviews ?? [])
    .filter((r) => r.kind === "review")
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
}

/** CRITICAL, not-dismissed findings — the blocker count next to the verdict. */
export function blockerCount(review: ReviewRecord | undefined): number {
  if (!review) return 0;
  return review.findings.filter((f) => f.severity === "CRITICAL" && !f.dismissed_at).length;
}
