# INSIGHTS — `e2e`

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

### 2026-10-12 — `./scripts/e2e.sh` with a dev web from the same checkout running fails flows at "land on the PR list"
Both `next dev` instances share `client/.next`; measured 7/12 flows green with
`pnpm --dir client dev` up, 12/12 with it stopped. Stop the dev web before a hermetic run.
**Evidence:** `scripts/e2e.sh`

### 2026-10-03 - the hermetic stack isolated only the DB and ports, not the seed's files on disk
`db:seed` also writes the Project Context demo checkout into `DEVDIGEST_CLONE_DIR`, and only when
that folder is absent. Without its own per-run value, a hermetic run wrote into the developer's
real clone dir and could read stale fixtures. `scripts/e2e.sh` now exports a fresh `mktemp -d`
clone dir after its cleanup trap; any new seed write outside the DB needs the same treatment.
**Evidence:** scripts/e2e.sh:98, server/src/db/seed-project-context.ts:69

## Codebase Patterns

Conventions and structural decisions that are not stated in the code.

<!-- newest first: codebase-patterns -->

### 2026-10-03 — a flow that opens a run trace needs `seed-project-context.ts`, not just `seed()`

`server/src/db/seed.ts`'s `seed()` writes PR #482's demo review straight to `reviews` /
`findings`; it never inserts an `agent_runs` row. The only place an `agent_runs` row (with a
matching `run_traces` document) gets created is `seedProjectContextDemo` (fixed
`DEMO_RUN_ID`), called only from `seed.ts`'s CLI entrypoint (`pnpm db:seed`), not from
`seed()` itself. A flow that opens the run trace drawer therefore depends on running the full
seed CLI, not on calling `seed()` directly (as some server tests do) — check which one a
fixture setup actually calls before assuming a run trace exists.
**Evidence:** `server/src/db/seed.ts`, `server/src/db/seed-project-context.ts:24`

## Tool & Library Notes

Quirks of dependencies, CLIs and the toolchain.

<!-- newest first: tool-and-library-notes -->

### 2026-10-12 — `find role link … --name` resolves no link at all; use `find text` for links
Control: `find role link click --name "Eval Dashboard"` returns Element not found while the
snapshot lists that link. This is the opposite of the 2026-10-11 popover entry (which says
use `find role button` for buttons): for LINKS use `find text "<unique text>" click` and pick
text that appears once on the page, or the misclick described there returns.
**Evidence:** `e2e/specs/13-multi-agent-review.flow.json` (AC-100)

## Recurring Errors & Fixes

Errors seen more than once, each with the signal that identifies it.

<!-- newest first: recurring-errors-and-fixes -->

### 2026-10-11 — a late flow fails alone in the full suite; its page shows "Rate limit exceeded, retry in N seconds"

**Cause:** the API registers a global `@fastify/rate-limit` of 120 req/min per IP unless
`NODE_ENV=test`. The whole suite drives one browser from one IP, and by flow 13 it had sent
~124 requests in the trailing minute, so the results page's read got 429s; TanStack's quick
retries all landed inside the window and the page settled on its error state. Run alone, the
same flow passes.
**Signal:** a `wait --text` times out only in a full run; the failure screenshot shows an
error state with "Rate limit exceeded"; `grep '"statusCode": 429'` in the API log hits.
**Fix:** the hermetic and CI API processes start with `NODE_ENV=test LOG_LEVEL=info` (rate
limit off, request log kept). A dev stack you point `npm test` at is still throttled.
**Evidence:** `server/src/app.ts:96`, `scripts/e2e.sh:155`, `.github/workflows/e2e-web.yml`

### 2026-10-11 — `find text "<button label>" click` reports `✓ Done` but a popover closes and nothing fires

**Cause:** the text locator resolved to some node other than the button (the label string
also lives in the page, e.g. the next-intl messages inside the RSC payload). Its click landed
outside the Run Review picker, whose outside-`mousedown` handler closed it; no POST was sent.
**Signal:** the next `wait --url` times out and the API log has no request for the action.
**Fix:** click buttons by role: `find role button click --name "<label>"` (substring match, so
a trailing count like "(4)" is fine); add `--exact` when a longer name could also match
(`Learn` vs `Learned`).
**Evidence:** `e2e/specs/13-multi-agent-review.flow.json`

### 2026-10-04 — a `find … click` on a below-the-fold control reports `✓ Done` but nothing happens

**Cause:** the app scrolls the nested `<main>` (`overflow:auto`), not the document. agent-browser
acts by viewport coordinates: `find … click`, top-level `focus <sel>` and `scrollintoview` all return
`Done` without scrolling `<main>`, so a control below the fold is clicked off-screen and nothing fires.
`find role button focus` does not exist (`✗ Unknown subaction: focus`).
**Signal:** the click step passes, the next `wait --url` / `wait --text` times out; in a probe the
target's `getBoundingClientRect().y` is greater than `innerHeight` and `main.scrollTop` stays `0`.
**Fix:** add `["set", "viewport", "1280", "1600"]` right after `open` so the control is on-screen,
then click by role as usual. Flows run in one shared session, so a later flow that needs the default
size must set its own viewport.
**Evidence:** `client/src/vendor/ui/shell/AppFrame.tsx:29`, `e2e/specs/12-pr-brief.flow.json:6`

### 2026-09-28 — `wait --text "Blast radius"` times out while the card is plainly on screen

**Cause:** `agent-browser wait --text` matches the RENDERED text (`innerText`), which applies
CSS `text-transform`. `SectionLabel` (and severity `Badge`) render `textTransform: "uppercase"`,
so the page shows `BLAST RADIUS` and the source-case string never matches. Vitest/jsdom
applies no CSS, so every component test still finds "Blast radius".
**Signal:** `Command failed: agent-browser wait --text <Title>` on a section title or badge;
in the page, `document.body.innerText.includes('<Title>')` is false while `textContent` is true.
**Fix:** wait on the text as rendered (`"BLAST RADIUS"`), or on a nearby non-transformed string.
**Evidence:** `client/src/vendor/ui/primitives/SectionLabel.tsx:22`, `e2e/specs/10-blast-radius.flow.json:10`

## Session Notes

Dated summaries of sessions worth remembering as a whole.

<!-- newest first: session-notes -->

## Open Questions

Things left unresolved, so the next session does not re-derive the same uncertainty.

<!-- newest first: open-questions -->
