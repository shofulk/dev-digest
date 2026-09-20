# Findings column on the PR list — `client` + `server`

## Goal

Make each PR's severity mix visible without opening it, and let one click preview that
level's findings in place.

## Acceptance criteria

1. The PR list has a FINDINGS column between SCORE and STATUS, left-aligned.
2. Each row shows one compact counter (icon + count) per severity that has findings;
   a severity with none is dropped, not shown as a zero.
3. A PR that was reviewed and produced no findings shows a tick, not an em dash — the
   em dash is reserved for "never reviewed" (`score == null`), as in SCORE and COST.
4. Clicking a counter opens a popover listing that severity's findings: title, category,
   `file:line`, confidence, and the opening of the rationale.
5. Clicking a counter does not navigate the row; clicking the row anywhere else still does.
6. Clicking the open counter again closes the popover; so do Escape and a click outside.
   Scrolling does **not** close it — the popover scrolls internally and re-anchors to its
   cell instead.
7. The popover is never clipped by the list card, and it stays inside the viewport
   (flipping above the row when there is no room below), including after a scroll.
8. While the findings load the popover shows a loading state; if the level turns out empty
   it explains that instead of rendering an empty box.
9. The popover's "Open in PR" link lands on
   `/repos/:repoId/pulls/:number?tab=findings&severity=<LEVEL>` — the filter shipped with
   [severity-counters](./severity-counters.spec.md).
10. The counters in a row sum to the counters in that PR's header: both count every
    finding of every review of the PR.
11. Each counter is a `<button>` with `aria-haspopup="dialog"` and `aria-expanded`; the
    popover is a `role="dialog"` with an accessible name.

## Contracts touched

`PrMeta.findings_by_severity` — `{ CRITICAL, WARNING, SUGGESTION }`, `.nullish()`, added in
`server/src/vendor/shared/contracts/platform.ts` and hand-mirrored to the client copy.
Named after the existing `AgentStats.findings_by_severity`. The list endpoint always sets
it (zeros included); the GitHub adapters, which also produce `PrMeta`, omit it.

No new endpoint: the counts ride on `GET /repos/:id/pulls`, and the popover reads the
findings from the existing `GET /pulls/:id/reviews` through `usePrReviews`, lazily and
under the same query key the PR detail page uses.

## Components touched

`SeverityCounters` moves to `client/src/components/severity-counters/` (shared between the
PR header and the list) and gains `compact`. New `_components/FindingsCell/` on the list,
with a nested `_components/FindingsPopover/`. `PRRow` gains a cell, and the list's `GRID`,
`COLUMN_KEYS` and `list.columns.findings` gain the column — the three places the grid is
coupled in.

Server: one extra aggregation in `server/src/modules/pulls/routes.ts` (findings joined
through reviews, folded per PR) and two indexes — `reviews_pr_idx`, `findings_review_idx` —
since neither FK column was indexed.

## Out of scope

Sorting or filtering the list by severity; counting only the latest run (the numbers are
deliberately the same as the PR header's, which means repeated runs of the same problem add
up); a popover on the "no findings" tick; accept/dismiss from the popover.

## Open questions

- The tally counts dismissed and accepted findings, like the header does. If the list should
  instead show what is still open, that is a `WHERE dismissed_at IS NULL` on the server side
  plus the same change in the header's `countBySeverity`, so the two stay equal.
