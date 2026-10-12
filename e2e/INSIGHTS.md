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

## Recurring Errors & Fixes

Errors seen more than once, each with the signal that identifies it.

<!-- newest first: recurring-errors-and-fixes -->

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
