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

### 2026-10-04 — a job-stream hook keyed only on the job id never recovers when the server hands back the SAME running job id
After `onerror` marks the job `failed`, Retry/Generate can resolve with the id of the
job that is still running (`POST /brief/generate` → `{job_id: <same>, reused: true}`,
by design: D2/AC-31). A render-time reset and an effect keyed on `jobId` alone see no
change, so `failed` sticks, no new `EventSource` opens and the finished brief never
appears until a reload. Key the reset and the subscription on the job id **plus** a
per-mutation attempt counter (bumped in `onSuccess`), never on the id text alone.
Applies to any SSE job hook over a deduping endpoint.
**Evidence:** server/src/modules/brief/service.ts:108-109; client/src/lib/hooks/brief.ts:56 (`attempt`), brief.ts:4-6 (reset keyed on `(jobId, attempt)`); client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/BriefBanner/BriefBanner.retrySameJob.test.tsx

### 2026-10-04 — a "stays true until X" `useState` latch (`canRetry`) enumerates exits, and misses one

**Cause:** `BriefBanner`'s `canRetry` (F22) was set `true` on `job.failed` and cleared only
on `job.done`. A Retry/Generate click can also resolve with `GenerateBriefCurrent`
(`{brief}`, no `job_id`) — `useGenerateBrief`'s `onSuccess` (`brief.ts`) then writes
`job: null` into the query cache, so `jobId` goes `null` and `job.done` can never become
`true` for that resolution. The latch stayed `true` forever next to a freshly rendered
brief, and clicking it sent `{force: true}` — a paid regeneration nobody asked for (F22b).
**Signal:** a derived boolean driven by a `useState` latch that only clears on ONE named
terminal event; any other way the same async flow can resolve bypasses the clear.
**Fix:** stopped naming the terminal case and instead cleared on the absence of the start
case: `else if (!isGenerating && !job.failed && canRetry) setCanRetry(false)` — "no longer
failed and nothing in flight" covers `job.done`, `GenerateBriefCurrent`, and any future
resolution shape, without enumerating each one.
**Evidence:** `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/BriefBanner/BriefBanner.tsx:43-55`,
`client/src/lib/hooks/brief.ts:60-69` (the `job: null` write that breaks a `job.done`-only clear).

### 2026-10-04 — an EventSource hook's `onerror` that only `close()`s leaves derived `running` stuck `true` forever

**Cause:** a native `onerror` fires when the stream itself drops (API restart, an evicted
job) — it is never followed by a `done`/`failed` event on that same connection. A hook that
derives `running` from "not done and not failed" (e.g. `useBriefJob`, round 1) and whose
`onerror` handler only calls `es.close()` never reaches a terminal state: `running` stays
`true` across the API's process lifetime, and any UI gated on it (Generate/Regenerate/Retry
buttons) stays disabled forever after a single dropped connection.
**Signal:** `onerror = () => { es.close(); }` with nothing else in the handler body, next to
a `running` derived as `!done && !failed`.
**Fix:** `onerror` must reach the same terminal state a `failed` SSE event would (set
`failed`/`ended`, whichever the hook's terminal flag is) AND invalidate the TanStack query
key so the server's own state takes over on refetch — `useConventionScan`
(`client/src/lib/hooks/conventions.ts:189-193`) already does both; it was the correct
reference during the F12 fix, not a second instance of the bug. `useBriefJob` was the one
hook missing it (`client/src/lib/hooks/brief.ts`, fix-list F12, round 2).
**Evidence:** `client/src/lib/hooks/brief.ts:115-128`, `client/src/lib/hooks/conventions.ts:189-193`,
`client/src/lib/hooks/brief.onerror.test.ts`.

### 2026-10-03 — gating a TanStack Query loading view on `isLoading` renders the "ready" view for a disabled query (`repoId` null/undefined)

`isLoading` is `isPending && isFetching` — a query disabled via `enabled: !!repoId` is
never fetching, so `isLoading` stays `false` even while it has no data. A component that
checks only `isLoading` before rendering rows therefore renders the data-shaped branch
with `data` undefined: in `ContextDocPicker`, that meant every row the caller passed as
`attached` showed the "Missing" badge and a live Detach button, and one click
permanently dropped it (F12, round-3 fix list). Gate on `!repoId || query.isPending`
instead — `isPending` is true whenever there is no data and no error, which also covers
the disabled case. A mock that hand-rolls `{ isLoading, isError }` for a hook under test
needs an `isPending` field added too, or the real bug reappears as a false-green test.
**Evidence:** `client/src/components/context-docs/ContextDocPicker.tsx:57`

### 2026-09-26 — a test for an ordering function passed while the function used the wrong order, because both used the same order

`orderBySmartDiff`'s original T8 built its `SmartDiff` fixture with each group's
`files` already in `PrDetail.files` order, so the implementation (which grouped by
walking `smartDiff.groups[].files` directly, ignoring the input `files` order)
and the test's expectation were both derived from the *same* list — the test
could not have told a correct implementation from a broken one; it would pass
either way (plan-verifier finding, `smart-diff.retro.md` iteration 1, class
`test-oracle-weaker-than-plan`). Fixed by making the fixture's response order
for one multi-file group the *reverse* of the `PrDetail.files` (input) order,
then asserting the input order wins — a case where the two candidate
implementations produce different, checkable output. General rule for any
pure "reorder/merge two sources" function: build the fixture so the two inputs
disagree on order, not just on which items belong together — agreement lets a
wrong implementation hide.
**Evidence:** `client/src/components/diff-viewer/helpers.ts:52`,
`client/src/components/diff-viewer/helpers.test.ts:18`

### 2026-09-26 — adding a new `useTranslations` namespace call to a shared component passes typecheck/lint/its own tests, then breaks an unrelated existing test's console output

Giving `diff-viewer/FileCard.tsx` a second, unconditional `useTranslations("prReview")` call
(for the open-findings dot, Smart Diff AC3) is invisible to every check that renders the
component with its own fixtures (`DiffTab.test.tsx`, `DiffViewer.test.tsx` both already
supply the `prReview` namespace) — but `src/test/smoke.test.tsx` mounts the shared
`DiffViewer` directly with only `{ shell: shellMessages }`, and `next-intl`'s
`useTranslations` throws `MISSING_MESSAGE` the moment the hook runs, regardless of whether
the missing key is ever actually read. `pnpm test` still exits 0 (the component doesn't
crash, next-intl just logs), so the only signal is a stderr `IntlError` block in an
otherwise-green run — easy to miss in a big test run's output. Any new `useTranslations`
namespace added to a component under `client/src/components/` (not `_components/`, i.e. one
usable by more than one route) needs every direct-mount test of that component checked for
the new namespace, not just the tests written for the new feature.
**Evidence:** `client/src/components/diff-viewer/FileCard/FileCard.tsx`,
`client/src/test/smoke.test.tsx:37`

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

### 2026-10-04 — a data hook reports failure as a stable `code` only; the component maps code → `t()` key
`client/AGENTS.md` says "no literal copy in components", which reads as if hooks were
exempt — they are not: user-facing strings live in `messages/<locale>/*.json`. Hooks are
tested without `NextIntlClientProvider`, so copy put in a hook escapes `next-intl`
entirely (one round shipped an English `STREAM_ERROR_MESSAGE` and a dead
`banner.streamError` key). The hook sets e.g. `{ code: "stream_error", message: "" }`;
the rendering component owns the only code → key mapping.
**Evidence:** client/src/lib/hooks/brief.ts:155; client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/BriefBanner/BriefBanner.tsx:71; client/src/lib/hooks/conventions.ts:208-212 (same shape)

### 2026-10-03 — a nav entry added straight to `vendor/ui/nav.ts` is a deliberate exception, not drift to clean up

`client/src/vendor/ui/nav.ts` is mirrored from `@devdigest/ui` and is otherwise do-not-touch, but `NAV`/`SHORTCUTS` have no other home: they are plain data, not a primitive, so an entry added only here is lost the moment the mirror is re-vendored. The Conventions nav item (`d30ff64`) and the Project Context nav item (`key: "context"`, `gKey: "x"`) are both this deliberate exception. When the mirror is next re-vendored, re-add every such entry by hand instead of treating its presence in `nav.ts` as drift to clean up.
**Evidence:** `client/src/vendor/ui/nav.ts:40-46,78`

### 2026-09-20 — an `EventSource` hook that resets its state inside the effect trips `react-hooks/set-state-in-effect`; reset during render instead

The obvious shape for "subscribe to stream X, clear the last stream's state" is
`setEvents([]); setResult(null); setRunning(true)` at the top of the effect — which is what
`lib/hooks/reviews.ts:175` does and why it carries a lint warning. Copying that shape into a
new hook raises the client warning baseline (13) by one per hook.

The fix is the pattern `useBodyTokens` already uses: reset **during render**, keyed on the
id, and derive anything that can be derived.

```ts
const [shownId, setShownId] = React.useState(id);
if (id !== shownId) { setShownId(id); setEvents([]); setResult(null); setEnded(false); }
const running = Boolean(id && repoId) && !ended && typeof EventSource !== "undefined";
```

React re-renders immediately without committing, so there is no stale frame under the new
id — which is also a real bug the effect version has, not just a lint complaint. One trap:
the effect's **cleanup must not** touch `ended`. Cleanup runs after the render-time reset has
already cleared it, so setting it there would instantly re-end the stream that is starting.
**Evidence:** `client/src/lib/hooks/conventions.ts`

### 2026-09-20 — markdown renders flat everywhere: `<Markdown>` parses correctly, but `.dd-md` is a hook with no CSS behind it

`@devdigest/ui`'s `Markdown` is a real `react-markdown` + `remark-gfm` wrapper, so `#` does
become `<h1>` and `-` does become `<ul><li>` — a test asserting `getByRole("heading")`
passes while the screen shows undifferentiated text. Three CSS facts flatten it: the
primitive wraps output in `<div className="dd-md">` and **nothing in the repo styles
`.dd-md`**; Tailwind v4 preflight sets `h1…h6 { font-size: inherit; font-weight: inherit }`
and `ul, ol { list-style: none }`; and `vendor/ui/styles.css:205` adds
`h1, h2, h3, h4, p { margin: 0 }`. It went unnoticed because the original call sites
(`FindingCard` rationale, `CommentCard`) render short heading-free snippets.

Two things worth knowing before touching it:

- The fix does **not** belong in `vendor/ui` (which is "do not touch"): `src/app/globals.css`
  is app-owned, already imports the design-system sheet and already carries app-level CSS
  (the `ddToastIn` keyframe). Element-level markdown styling is descendant-selector work, so
  the co-located inline-`styles.ts` convention cannot express it at all — global CSS is the
  only correct home.
- Specificity: preflight sits in `@layer base` and unlayered rules beat any layer, so plain
  `.dd-md ul` wins; `.dd-md h1` (0-1-1) beats `h1 { margin: 0 }` (0-0-1). But the primitive
  styles `p` and `code` **inline**, which no stylesheet beats — `li > p`, `pre code` and the
  `:first-child` / `:last-child` margin reset need `!important`, and only those.

jsdom applies no stylesheet, so none of this is testable: `pnpm test` stays green whether the
CSS is there or not. Only the DOM contract can be pinned; the render must be checked by eye.

**Evidence:** `client/src/app/globals.css:26`

### 2026-09-20 — a tab body chosen by `TAB_COMPONENTS[tab]` unmounts on every switch, so its unsaved form state is silently lost

The Skills Lab editor lifts only the unsaved **body** into `SkillEditor` (Preview needs it),
so a `Config → Preview → Config` round trip kept the edited body but reset name,
description and type to the saved values — no error, no test failing, because each tab was
tested in isolation. Lifting every field into the parent works but drags the whole form into
a shell that should not know it; the fix that held is to keep the form tab **mounted** and
hide it: `<div style={{ display: tab === "config" ? "contents" : "none" }}>`. `contents`
(not a plain `hidden`) keeps the child's flex/grid layout identical while visible. Apply the
same to any editor tab that owns a form; read-only tabs (Stats, Versions) can keep
unmounting so they refetch on entry.

**Evidence:** `client/src/app/skills/_components/SkillsLabView/_components/SkillEditor/SkillEditor.tsx:90`

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

### 2026-10-04 — `@testing-library/user-event` is not installed; component tests use `fireEvent`
Only `@testing-library/react` and `jest-dom` are dependencies, so the RTL skill's
"prefer `userEvent`" advice does not apply here without adding a package (a lockfile
change). A reviewer flagging `fireEvent` as an anti-pattern is a false positive.
**Evidence:** client/package.json:30-31

### 2026-10-03 — `@devdigest/ui` primitives like `IconBtn` are plain function components, not `forwardRef` — you cannot get a DOM ref from them directly

A control that must hand focus back to itself after closing an overlay (AC-37's "Escape
returns focus to the row's Preview button") needs a real `HTMLButtonElement` to call
`.focus()` on. Passing `ref={...}` straight to `IconBtn` (or `Button`, `Checkbox`, etc. —
none of them call `React.forwardRef`) is silently dropped; React only warns "Function
components cannot be given refs" in the console, the build and tests stay green. Fix:
wrap the primitive in a plain `<span ref={(el) => ...el?.querySelector("button")}>` and
capture the native button that way, since none of these can be edited (`vendor/ui` is
do-not-touch).
**Evidence:** `client/src/components/context-docs/ContextDocPicker.tsx` (the `registerPreviewButton` wrapper), `client/src/vendor/ui/primitives/IconBtn.tsx:4`

### 2026-09-28 — `MonoLink` with `href` unset renders a `<button>`, not a link — passing it a possibly-`undefined` href for a "should be plain text" case silently ships a clickable no-op button

`MonoLink({ href })` branches on truthiness: `href` set → `<a target="_blank">`, `href`
unset → `<button onClick>` with no `onClick` handler wired if the caller never intended one.
`BlastRadiusCard`'s `CallerRow` passed `href={href ?? undefined}` when `repoFullName` was
`null` (AC4's "renders as plain mono text, not a broken link"), which produced a focusable,
clickable, no-op `<button>mono</button>` instead. Fix: branch in the consumer and render a
plain `<span className="mono">` when `href` is falsy — never rely on `MonoLink`'s own
fallback to represent "no link".

**Evidence:** `client/src/vendor/ui/primitives/MonoLink.tsx:25-52`,
`client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/BlastRadiusCard/BlastRadiusCard.tsx:49-58`

## Recurring Errors & Fixes

Errors seen more than once, each with the signal that identifies it.

<!-- newest first: recurring-errors-and-fixes -->

### 2026-10-04 - an absence assertion in `waitFor` passes trivially right after a raw `FakeEventSource.emit()`
**Cause:** `waitFor` runs its callback once synchronously before polling. A test-double
`emit()`/`triggerError()` called outside `act`/`fireEvent` has not flushed its React
update yet, so `expect(queryByRole(...)).toBeNull()` (or a flipped negative control)
can pass on that first check before the code under test ever reacted.
**Signal:** a negative control (assertion flipped) still passes; `not wrapped in act(...)`
warnings on stderr.
**Fix:** after a raw emit, first `waitFor` a real async signal the reaction produces
(e.g. the brief GET counter rising after `invalidateQueries`, or new status text), then
assert presence/absence.
**Evidence:** client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/BriefBanner/BriefBanner.retryExits.test.tsx:192-193

### 2026-10-04 - Do not override `notifyManager`'s scheduler globally to fix a test; assert `mutateAsync`'s resolved value instead
**Supersedes:** 2026-10-04 entry "`useMutation().data` is stale right after `await
mutateAsync(...)`, flaky even alone" — the fix below (module-scope
`notifyManager.setScheduler((cb) => queueMicrotask(cb))` in `client/src/lib/hooks/brief.ts`)
was rejected on review: `notifyManager` is process-wide, so it changed notification timing
for every query and mutation in the app to stabilise one test's assertion style.
**Cause:** the underlying race was real (query-core defers the store-change notification
that updates `.data` through a real `setTimeout(cb, 0)`), but the fix belonged in the test,
not in app code: `mutateAsync(...)`'s own resolved promise already carries the mutation's
result with no timer involved, so there is never a reason for a caller — test or component
— to read a mutation hook's `.data` synchronously right after `await mutateAsync(...)`.
**Signal:** a `notifyManager.setScheduler(...)` call anywhere outside a test setup file, or
a `.data` read immediately after `await mutateAsync(...)`.
**Fix:** assert on `mutateAsync`'s resolved value (`const result = await
mutateAsync(...)`), or consume the result inside the mutation's own `onSuccess`, never
`result.current.data` read right after the await. Leave `notifyManager`'s scheduler at its
default everywhere.
**Evidence:** client/src/lib/hooks/brief.ts (scheduler override removed);
client/src/lib/hooks/brief.test.ts:140-149 (asserts `mutateAsync`'s resolved value).

### 2026-10-04 - `useMutation().data` is stale right after `await mutateAsync(...)`, flaky even alone
**Cause:** `@tanstack/query-core`'s `notifyManager` is a process-wide singleton whose
default scheduler defers every store-change notification through a real
`setTimeout(cb, 0)` (`timeoutManager.js` → `systemSetTimeoutZero`) — including the one
that makes `useMutation()`'s `.data` reflect a just-settled mutation. `mutation.execute()`
sets `this.state.data` synchronously and resolves the promise `mutateAsync` awaits
*before* that timer fires, so a test (or component) that reads `.data` immediately after
`await mutateAsync(...)` races a real macrotask that `await` does not wait for — `act()`
only flushes microtasks. This is **not** cross-test pollution: it reproduced failing in
isolation (`vitest run brief.test.ts` alone, 3 of 5 runs failed) as often as "in a full
run", despite how it first looked.
**Signal:** `expected undefined to deeply equal {...}` on a `useMutation` result read
synchronously after `await mutateAsync(...)`, passing most but not all runs of the same
single test file.
**Fix:** `notifyManager.setScheduler((cb) => queueMicrotask(cb))` once, at module scope
(`client/src/lib/hooks/brief.ts`) — routes notifications through the same microtask queue
`await` already drains, instead of a real timer. Safe to set globally: it only changes
*when* a React Query update flushes (microtask vs. next real tick), not whether updates
are batched. Confirmed with 8 standalone runs + 3 consecutive full `pnpm --dir client
test` runs, all green.
**Evidence:** client/src/lib/hooks/brief.ts:11-28; client/node_modules/@tanstack/query-core/build/modern/notifyManager.js; client/node_modules/@tanstack/query-core/build/modern/timeoutManager.js (`systemSetTimeoutZero`); client/node_modules/@tanstack/react-query/build/modern/useMutation.js (`notifyManager.batchCalls(onStoreChange)`).

## Session Notes

Dated summaries of sessions worth remembering as a whole.

<!-- newest first: session-notes -->

## Open Questions

Things left unresolved, so the next session does not re-derive the same uncertainty.

<!-- newest first: open-questions -->
