# Severity counters — `client`

## Goal

Make the severity mix of a PR's findings readable at a glance in the PR header, and let one
click narrow every findings list on the page to a single severity.

## Acceptance criteria

1. The PR header renders one counter per contract severity — `CRITICAL`, `WARNING`,
   `SUGGESTION`, in that order — between the meta line and the tabs, reading
   `3 CRITICAL · 5 WARNING · 2 SUGGESTION`.
2. Each count is that severity's share of **all** findings of **all** review runs of the PR,
   so the three counts sum to the number on the `Agent runs` tab.
3. Clicking a counter sets `?severity=<LEVEL>`; clicking the active counter removes the
   parameter. Only one level can be active.
4. Under `?severity=X` every run's findings list shows only level `X`. The tab badge, each
   accordion header (`N findings · M blockers`) and each `VerdictBanner` keep their
   unfiltered totals — they describe the run, not the current view.
5. A run with no finding of the selected level keeps its accordion and header; its body
   shows the existing `panel.noMatchTitle` / `panel.noMatchBody` empty state.
6. `?severity=BOGUS` and `?severity=critical` are ignored: no filter, no crash.
7. Reloading or sharing `?tab=findings&severity=CRITICAL` reproduces the filtered view.
8. Clicking a counter from the Overview or Files tab also switches to the `findings` tab,
   in a single history entry. Clearing the filter does not change the tab.
9. A level with 0 findings is rendered greyed and non-interactive — unless it is the active
   one, which stays clickable so the filter can always be cleared. When all three are 0 the
   whole row is absent.
10. Each counter is a `<button>` carrying `aria-pressed`, inside a group with an accessible
    name; the severity is conveyed by icon + label, never by colour alone.

## Contracts touched

None. `Severity` and `FindingRecord` are read from `@devdigest/shared` (mirrored from
`server/src/vendor/shared`, never edited here); `Severity.options` drives the display order
and `Severity.safeParse` validates the URL parameter. The counts are derived on the client
from the findings the page already holds — the server deliberately does not expose a
per-severity breakdown (`server/src/modules/pulls/routes.ts`).

## Components touched

One new component, `_components/SeverityCounters/`, owning the counter row, the toggle
semantics and `countBySeverity` / `parseSeverityParam`. `page.tsx` reads and writes
`?severity` (its `setParam` generalised to `setParams` so tab + severity move in one
`router.replace`), `PrDetailHeader` renders the row, and `FindingsTab` →
`ReviewRunAccordion` → `FindingsPanel` forward the selected level to `visibleFindings`,
which becomes the single place the filter is applied and takes a `FindingsFilter` object
instead of a `hideLow` boolean.

## Out of scope

The PR list's findings column — shipped separately, see
[findings-column](./findings-column.spec.md). The lethal-trifecta banner, which is a
security alarm rather than a findings list. Multi-select, category filters, sorting by
severity, and any server-side aggregation.

## Open questions

- The run-trace drawer's `FindingsSection` is left unfiltered: it is an audit view of one
  run's raw output and its badge reports that run's `findings.length`, so a shared
  `?trace=…&severity=…` URL would otherwise understate what the run produced. If it should
  follow the filter after all, that is a `severity` prop threaded
  `page.tsx → RunTraceDrawer → TraceBody → FindingsSection` plus a filtered-vs-total
  decision for its badge.
- The counters include dismissed and accepted findings, because the filtered lists show them
  too and because the counts must sum to the tab badge. An "actionable only" view, if wanted,
  belongs next to *Hide low confidence*, not baked into the header counts.
