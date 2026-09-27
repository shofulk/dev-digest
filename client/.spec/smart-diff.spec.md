# Smart Diff — `client`

## Goal

On the PR page's "Files changed" tab, group files by reviewer-relevant role
(core → tests → wiring → docs → boilerplate) from the server's `GET /pulls/:id/smart-diff`,
overlay live finding counters/dots/inline cards from `usePrReviews`, and let the user switch
back to the flat GitHub order.

## Acceptance criteria

1. **AC1 — Role groups.** In Smart order, the tab renders one group per non-empty role, in
   the order core → tests → wiring → docs → boilerplate. Each group header shows a collapse
   chevron, a role colour square, the role label and a short subtitle, and on the right
   `● N` (N = number of files in the group with at least one open finding; shown only when
   N > 0) and `M files`. Within a group, files keep `PrDetail.files` order.
2. **AC2 — Default collapse.** `docs` and `boilerplate` groups start collapsed (file cards
   not rendered). `core`, `tests`, `wiring` start expanded. Clicking a header toggles it.
3. **AC3 — Live finding indicators.** Group counters and per-file dots are computed from
   `usePrReviews(prId)` and update without a reload: when a review run settles (whichever
   tab is open) and after Accept/Dismiss. A `FileCard` with at least one open finding
   (`dismissed_at == null`) shows a dot next to its path, beside the comment counter, with an
   accessible label.
4. **AC4 — Inline findings.**
   - A finding whose `RIGHT:${start_line}` key matches a rendered line is rendered directly
     under that line, as the existing `FindingCard`, expanded, with working Accept/Dismiss
     through `useFindingAction()`.
   - The line gets a left bar in the severity colour and a `SeverityBadge`; several findings
     on one line use the most severe one for the bar/label. No new colour palette.
   - A finding whose line is not in the patch (including `patch: null`) renders in a block
     at the top of the file body, titled with a count, patterned on `OutdatedComments`.
5. **AC5 — Order toggle and header.** Header reads "Reviewer-ordered diff" with
   `<files_count> files · +<additions> −<deletions>` from `PrDetail`. A "Smart order |
   Original order" segmented toggle sits next to it, Smart by default (local state, not a
   URL param). Original order renders the flat `PrDetail.files` list, no group headers, dots
   and inline findings still present. While `useSmartDiff` loads, a skeleton shows; on
   failure, an `ErrorState` with retry, and Original order stays usable.
6. **AC9 — Copy.** Every new user-facing string lives under `smartDiff` in
   `client/messages/en/prReview.json`.

## Contracts touched

`SmartDiffResponse`, `SmartDiffRole` (`client/src/vendor/shared/contracts/brief.ts` +
`review-api.ts`, type-only imports). No new endpoint beyond the mirrored
`GET /pulls/:id/smart-diff`.

## Components touched

`client/src/lib/hooks/smart-diff.ts` (new `useSmartDiff(prId)`, plain TanStack Query, no
effect). `client/src/components/diff-viewer/{findings.ts,helpers.ts,constants.ts}` (pure
grouping/finding logic), `FileGroup/` and `UnanchoredFindings/` (new), `DiffViewer`,
`FileCard`, `CodeLine` (modified to accept groups + a `DiffFindingApi` render-prop, keeping
the shared component's independence from route-private code).
`…/[number]/_components/DiffTab/DiffTab.tsx` (owns the toggle, header, and builds
`DiffFindingApi` from route-private `FindingCard`); `page.tsx` gains the run-settle
`["smart-diff", prId]` invalidation.

## Out of scope

The file dot coloured by max severity (P1 uses one neutral accent dot); per-comment collapse
on inline finding cards; locales other than `en`; de-duplicating findings across runs;
refactoring pre-existing `DiffViewer`/`DiffTab` code beyond what this feature touches.

## Open questions

None — resolved in `docs/plans/smart-diff.plan.md` (Q1–Q3, rev 2).
