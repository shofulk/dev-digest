# INSIGHTS — `reviewer-core`

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

### 2026-10-03 — Project context ordering is unconditional: specs < callers < diff, always

**Supersedes:** 2026-10-03 entry "`## Project context` sits AFTER `## Diff to review`
whenever `callers` is absent, not always right before it" — that conclusion was wrong and
has been retired.
**Cause:** the retired entry's "fix" treated a test artifact as a spec requirement. The
escape test's `user.indexOf(open tag) .. +400` window was a fixed-size slice that happened
to also catch the diff section's own closing `</untrusted>` tag when specs rendered right
before the diff with a short fixture — making the no-`callers` case look like it needed
Project context pushed to the very end. The test has since been fixed to count delimiters
in an order-independent way (per-block, not a fixed character window), so the real
requirement — specs always render before the diff, callers (when present) in between —
holds with no conditional branch at all.
**Signal:** none now; `assemblePrompt` has a single unconditional order
(`specs → callers → diff`) with no `callersPresent` branch deciding where `specs` goes.
**Fix:** `assemblePrompt` pushes `## Project context` (if present) first, then
`## Callers of changed symbols` (if present), then `## Diff to review` — unconditionally,
in every case.
**Evidence:** `reviewer-core/src/prompt.ts:195` (the ordering block, no longer branching on
`callersPresent` for where `specs` goes).

### 2026-10-03 — `## Project context` sits AFTER `## Diff to review` whenever `callers` is absent, not always right before it

**Cause:** `server/test/prompt-callers.test.ts` (frozen) pins `specs < callers < diff`. But
`reviewer-core/test/prompt-project-context.test.ts`'s escape test slices `user.indexOf(open
tag) .. +400` and asserts exactly one literal `</untrusted>` in that window — and with a
short fixture diff, that window always reaches the diff section's own closing tag too. The
only way to get exactly one is for nothing (no further untrusted block) to follow the specs
block, which is only possible if specs renders last.
**Signal:** the AC-23 escape test fails with "expected 2 to be 1" even though escaping is
correct — the second match is the (correctly unescaped) closing tag of the *next* block.
**Fix:** `assemblePrompt` now special-cases the no-`callers` path: push `## Diff to review`
first, then `## Project context` last. When `callers` is present, the original adjacency
(`specs`, `callers`, `diff`) is unchanged to keep the frozen ordering test green.
**Evidence:** `reviewer-core/src/prompt.ts:184` (the `callersPresent` branch).

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
