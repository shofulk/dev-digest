# Intent card — `client`

## Goal

Show the derived PR intent — summary, scope, confidence, sources, staleness — on the
Overview tab, before the Description, with a "Re-derive intent" action.

## Acceptance criteria

1. `OverviewTab` renders `<IntentCard prId={prId} />` first, then the existing Description.
2. `IntentCard` reads through `usePrIntent(prId)` (`GET /pulls/:id/intent`) and mutates
   through `useDeriveIntent(prId)` (`POST /pulls/:id/intent/derive`) — both plain TanStack
   Query hooks in `client/src/lib/hooks/intent.ts`, no `EventSource`/effects.
3. States:
   - **loading** — `Skeleton` block.
   - **empty** (`intent: null`) — `EmptyState` "No intent derived yet" + "Derive intent".
   - **deriving** (mutation pending) — action disabled, label "Deriving…"; existing content
     kept.
   - **error (GET)** — inline `ErrorState` + retry (`refetch`).
   - **derive error** — `notify` toast with the API message; card keeps its previous state.
   - **stale** — badge "Stale — PR updated since derivation" + primary "Re-derive intent".
   - **low confidence** — warning chip "Low confidence" + hint.
   - **missing context** — banner "Some referenced context could not be fetched" + flagged
     source rows.
4. Header: title + confidence chip + stale badge + "Re-derive intent" (primary when stale,
   secondary otherwise).
5. Body: summary as a blockquote-styled plain-text block (not `Markdown`); two columns IN
   SCOPE / OUT OF SCOPE; a sources list (kind icon, ref, status; `missing`/`not_fetched`
   rows shown with a warning tone and the translated reason); a footer with model and
   derived time.
6. `page.tsx` invalidates `["pr-intent", prId]` when a run settles (a review may have
   derived one inline).
7. `FindingCard` shows an "Out of scope" chip when `f.scope === "out"`.
8. No "Risk areas" section is rendered anywhere on this tab.
9. Every string on the card comes from `client/messages/en/prReview.json` — no literal
   copy in the component.
10. Types come from `@devdigest/shared` as `import type` only; any runtime enum value is
    imported from the concrete contract file, never the barrel (`client/INSIGHTS.md`,
    2026-09-17).

## Contracts touched

`PrIntentRecord`, `PrIntentResponse` (`server/src/vendor/shared/contracts/review-api.ts`,
mirrored byte-for-byte into `client/src/vendor/shared`). `FindingRecord.scope`
(`contracts/findings.ts`, same mirror).

## Components touched

`IntentCard` — new, colocated at
`app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/IntentCard/`
(`IntentCard.tsx`, `index.ts`, `styles.ts`, `helpers.ts` for pure presentation
derivations — tone per status, low-confidence check). `OverviewTab.tsx` gains a `prId`
prop. `page.tsx` passes it and invalidates the intent query on run settle. `FindingCard`
gains the out-of-scope chip.

## Out of scope

A Risk areas section (no data-backed producer exists). Showing the Intent card on the
Findings tab (Overview only). Locales other than `en`. Disabling the scope filter from the
UI.

## Open questions

None — resolved in the Development Plan (`docs/plans/intent-layer.plan.md`, rev 2).
