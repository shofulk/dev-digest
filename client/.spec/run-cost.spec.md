# Run cost — `client`

## Goal

Show what reviews cost on the three surfaces where the question arises: the PR
list, the PR's agent-runs tab, and the run trace drawer.

## Acceptance criteria

1. The PR list has a COST column between STATUS and UPDATED, right-aligned.
2. A PR with no priced run renders the em dash `—`, never `$0.00`.
3. Each settled timeline row renders `<tokens> tok · $<cost>`; running and failed
   rows render neither.
4. Each review-run accordion header renders the run's cost beside its score.
5. The trace drawer Stats section renders a fourth COST tile.
6. Sub-cent costs stay legible (`$0.0013`) rather than collapsing to `$0.00`.
7. Unknown cost renders identically (`—`) on all four surfaces.

## Contracts touched

`PrMeta.cost_usd`, `RunSummary.cost_usd`, `RunStats.cost_usd` — all mirrored from
`server/src/vendor/shared`, never edited here.

## Components touched

No new component. `PRRow` + the list header gain a cell, `RunHistory` gains a
line, `ReviewRunAccordion` gains a span (fed by a `run_id` join built in
`FindingsTab`, since `ReviewRecord` carries no cost), `TraceBody` gains a `Stat`.
One new module, `src/lib/format-cost.ts`, owns the formatting so that `—` is
identical everywhere.

## Out of scope

The Overview tab's PR Brief card — it does not exist yet (L05). No cost on
`PrDetail`, no sorting or filtering by cost, no budget UI.

## Open questions

- `ReviewRunAccordion` has no `useTranslations`; the cost follows that file's
  existing hardcoded-English convention rather than retrofitting i18n.
