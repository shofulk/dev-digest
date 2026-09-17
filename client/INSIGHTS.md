# INSIGHTS — `client`

Empirical findings about this package: things that cost time to discover and that the code
does not say out loud. Written and read by the `engineering-insights` skill — read this
file before working here, append to it when the work turns up something non-obvious.

**Append-only.** Never rewrite or delete an existing entry. A finding that turns out to be
wrong is retired by a newer dated entry carrying `**Supersedes:**`. New entries go directly
under their section's marker, newest first.

Entry shape (`Cause` / `Signal` / `Fix` are required under Recurring Errors & Fixes and
optional elsewhere; `Evidence` is always required):

```markdown
### YYYY-MM-DD — <the symptom or claim, as it first looked>

**Cause:** what was actually happening.
**Signal:** how to recognise it next time (error text, log line, failing test).
**Fix:** what resolved it, or the workaround that holds.
**Evidence:** `path/to/file.ts:42`
```

Not for: architecture (that is `README.md`), design rationale (`.doc/`), feature contracts
(`.spec/`), or anything a linter or type-checker already catches.

## What Works

Approaches and solutions that held up.

<!-- newest first: what-works -->

## What Doesn't Work

Dead ends and antipatterns. The most valuable section and the one most often skipped —
a documented dead end saves the next session the whole detour.

<!-- newest first: what-doesnt-work -->

### 2026-09-17 — closing a fixed-position popover on `scroll` makes its own content unscrollable

**Supersedes:** the 2026-09-17 entry below — its "must close on `scroll` (capture phase) and
on `resize`" is wrong for any popover that scrolls internally.

A `scroll` listener in the capture phase fires for scrolls **inside** the popover too, so the
box vanishes the moment the user drags its scrollbar or wheels over a long findings list —
which reads as "the popover is broken", not as a deliberate dismissal. `position: fixed`
does need the stale-rect problem solved, but the answer is to **re-measure, not dismiss**:
keep the anchor *element* (a ref), and on capture-phase `scroll` + `resize` recompute the
coordinates inside a `requestAnimationFrame`. Measuring is idempotent, so an inner scroll
just recomputes the same values and costs nothing. Escape and outside-mousedown stay as the
only ways to close. The regression test is the one that would have caught it: fire `scroll`
on the dialog itself and assert it is still there.

**Evidence:** `client/src/app/repos/[repoId]/pulls/_components/FindingsCell/_components/FindingsPopover/FindingsPopover.tsx:75`

### 2026-09-17 — a popover inside a PR-list row renders, measures fine, and is still invisible below the row

Two things in the list swallow it, and neither is visible from the component you are writing:

- `s.tableCard` (`client/src/app/repos/[repoId]/pulls/styles.ts`) sets `overflow: "hidden"`
  to clip the rounded corners, so an `absolute`-positioned child is cut off at the card edge
  — the popover exists in the DOM, has a size, and shows nothing past the last row. The fix
  is `position: fixed` with coordinates measured from the trigger's
  `getBoundingClientRect()`. The consequence of `fixed` is that the rect goes stale, so the
  popover must close on `scroll` (capture phase — the scroller is an ancestor, not `window`)
  and on `resize`, on top of Escape and outside-click.
- the whole row is one big `onClick` that routers to the PR (`PRRow.tsx`), so every
  interactive cell needs `e.stopPropagation()` on the cell wrapper **and** inside the
  popover — otherwise the first click navigates away and the popover is blamed for "not
  opening". A test that asserts the row's `push` was *not* called is the cheap guard.

**Evidence:** `client/src/app/repos/[repoId]/pulls/_components/FindingsCell/_components/FindingsPopover/styles.ts:8`

### 2026-09-17 — importing a *value* from `@devdigest/shared` compiles and tests green, then `next dev` serves 500 on every route

Until now every client import from `@devdigest/shared` was `import type` — erased before a
bundler ever sees it. The first **runtime** import (here the Zod `Severity` schema, wanted so
the severity list and the `?severity=` validation come from the contract instead of a
hand-written union) pulls `src/vendor/shared/index.ts` into the webpack graph, and the barrel
re-exports with `.js` specifiers (`export * from './contracts/findings.js'`) against `.ts`
sources. `tsc` rewrites those (`moduleResolution: "Bundler"`) and vitest resolves them
through vite, so **typecheck and the whole vitest suite pass**; webpack does not, and the dev
server answers 500 for *every* page — including routes that never touch the import.

**Signal:** `Error: Module not found: Can't resolve './contracts/findings.js'` buried in the
500 page's HTML, not in the terminal you were watching; `curl -o /dev/null -w '%{http_code}'`
on the route is the fastest way to see it, since `pnpm typecheck && pnpm test` say nothing.
**Fix:** import the contract file directly — `@devdigest/shared/contracts/findings` — which
the `@devdigest/shared/*` tsconfig path (and the vitest alias, by prefix) resolves to the
`.ts` file with no barrel in between. Do not "fix" the barrel: `src/vendor/**` is a mirror of
`server/src/vendor/shared`, where the `.js` specifiers are correct for the server's own
resolution. Corollary: a green `pnpm typecheck` + `pnpm test` does **not** prove the app
boots — load one route before calling client work done.
**Evidence:** `client/src/app/repos/[repoId]/pulls/[number]/_components/SeverityCounters/constants.ts:1`

## Codebase Patterns

Conventions and structural decisions that are not stated in the code.

<!-- newest first: codebase-patterns -->

### 2026-09-17 — the PR list is a CSS grid whose columns are coupled in three places by convention alone, and the right-align was index-derived

Adding a column to `/repos/:repoId/pulls` means changing three things that nothing checks
against each other: the track count in `GRID` (`pulls/constants.ts`), the order of
`COLUMN_KEYS` (same file, drives the headers), and the hand-written sibling `<div>`s in
`PRRow.tsx`. Get one out of step and cells silently render under the wrong headers — no type
error, no test failure, because the header and the row are built from different sources.

Two things that are not obvious from reading either file:

- `GRID` is consumed only by `s.row` and `s.headRow` in `pulls/styles.ts`, so one constant
  covers header, rows **and** the skeleton. The loading state is flat `<Skeleton>` bars and
  is not a grid at all, so it never previews a new column.
- Right-alignment used to be positional — `s.headCell(i === COLUMN_KEYS.length - 1)` —
  which silently aligns whatever happens to be last. Inserting a numeric column before
  `updated` therefore left it left-aligned. Replaced with a named
  `RIGHT_ALIGNED_COLUMNS` set; keep alignment keyed by column name, not index.

`PRRow.test.tsx` now asserts `GRID.split(/\s+/).length === COLUMN_KEYS.length`, which is the
cheap guard for the first half of this.

**Evidence:** `client/src/app/repos/[repoId]/pulls/constants.ts:27`

### 2026-09-17 — a review-run header cannot show anything that lives on the RUN; `ReviewRecord` and `RunSummary` are different objects

`ReviewRunAccordion` renders a `ReviewRecord` (from `/pulls/:id/reviews`), which carries the
verdict, score, model and findings — but no tokens, no duration and no cost, because the
`reviews` table has no such columns. Those live on `agent_runs`, surfaced as `RunSummary` by
`/pulls/:id/runs`, the endpoint the timeline above already uses.

So per-run stats in the accordion are a **join, not a new field**: `FindingsTab` receives
both lists (`runs: ReviewRecord[]` and `prRuns: RunSummary[]`), so build a
`Map<run_id, RunSummary>` there and pass what is needed down as a prop — no extra request.
Do not add the field to `ReviewRecord` instead; that is a denormalization with no column
behind it, and it would have to be faked server-side.

**Evidence:** `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsTab/FindingsTab.tsx:44`

## Tool & Library Notes

Quirks of dependencies, CLIs and the toolchain.

<!-- newest first: tool-and-library-notes -->

## Recurring Errors & Fixes

Errors seen more than once, each with the signal that identifies it.

<!-- newest first: recurring-errors-and-fixes -->

## Session Notes

Dated summaries of sessions worth remembering as a whole.

<!-- newest first: session-notes -->

## Open Questions

Things left unresolved, so the next session does not re-derive the same uncertainty.

<!-- newest first: open-questions -->
