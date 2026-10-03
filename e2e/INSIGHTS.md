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

## Codebase Patterns

Conventions and structural decisions that are not stated in the code.

<!-- newest first: codebase-patterns -->

## Tool & Library Notes

Quirks of dependencies, CLIs and the toolchain.

<!-- newest first: tool-and-library-notes -->

## Recurring Errors & Fixes

Errors seen more than once, each with the signal that identifies it.

<!-- newest first: recurring-errors-and-fixes -->

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
