# INSIGHTS — `server`

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

### 2026-09-17 — `findings` has no `workspace_id`, so every aggregation over it must join `reviews` — and neither FK column is indexed

`findings` hangs off `reviews` and carries no tenancy column of its own
(`server/src/db/schema/reviews.ts`), so a query keyed on `findings.review_id` alone is
*unscoped*: correct only as long as the review ids were already filtered. For anything
per-PR (the list's severity tally) the shape is
`.from(t.findings).innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id)).where(and(eq(t.reviews.workspaceId, workspaceId), inArray(t.reviews.prId, prIds)))`
— the join is the tenancy check, not an optimisation. A cross-workspace fixture in the
`.it.test.ts` is the only thing that catches getting this wrong; the single-workspace seed
never will.

Second half: Postgres does not index FK columns, and neither `reviews.pr_id` nor
`findings.review_id` had an index — every such read seq-scanned both tables. Added
`reviews_pr_idx` / `findings_review_idx` following the `agent_runs_pr_idx` precedent
(`schema/runs.ts`), i.e. in the `pgTable` extras callback plus `pnpm db:generate`, never a
hand-written migration.

**Evidence:** `server/src/modules/pulls/routes.ts:161`

### 2026-09-17 — a "missing" feature is often a feature that was surgically removed; find the removal commit before writing anything

`README.md`'s "What you build in the course" table lists features deliberately carved out
of the starter, one per lesson. They were removed by real commits, so the removal diff is a
complete, reviewed blueprint for putting the feature back — every call site, every contract
field, every test fixture, in the right places. Re-deriving it by hand instead means
rediscovering all of that.

Run `git log --oneline --all --grep '<feature>'` **first**. For run cost (L01) that is
`d45ab0d` *"feat(reviews): remove per-PR/run cost, keep model pricing"*, whose diff named
every one of the eight files that had to change, and migration `0009` which dropped
`agent_runs.cost_usd`. Note the removals are partial by design: `d45ab0d` kept the whole
pricing catalog (`adapters/llm/pricing.ts`, `platform/price-book.ts`) and `reviewer-core`
kept returning `costUsd` on every `ReviewOutcome` — so the value was already being computed
and merely discarded at `run-executor.ts`. Check what still works before building it.

**Evidence:** `server/src/modules/reviews/run-executor.ts:213`

### 2026-09-17 — a run trace is a jsonb blob replayed verbatim, so a new REQUIRED field in `RunStats` breaks every trace already stored

`run_traces.trace` holds a whole `RunTrace` document as jsonb and `getRunTrace` returns it
as-is — it is never re-derived from columns. So the contract in `contracts/trace.ts` is
parsed against rows written by *older versions of the code*. Adding
`cost_usd: z.number().nullable()` to `RunStats` demands the key be present and makes
`RunTrace.parse` throw `Required` on every trace persisted before the field existed;
`.nullish()` accepts both. Removing a field is safe in the other direction (Zod strips
extras), so this asymmetry only bites on the way back in.

Rule for any future `RunStats` / `RunTrace` field: **nullish, not nullable.** The failure is
easy to miss because `GET /runs/:id/trace` has no response schema and the client casts
rather than parses, so only `test/contracts.test.ts` and future validation actually fail.

**Evidence:** `server/src/vendor/shared/contracts/trace.ts:61`

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
