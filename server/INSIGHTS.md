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

### 2026-09-20 — every local gate reads the WORKING TREE, so a file left uncommitted is invisible until CI

`routes.ts` imported `SKILL_BODY_BODY_LIMIT` from a commit that never carried
`constants.ts` — the export sat unstaged in the working tree. Locally `pnpm typecheck`,
`pnpm lint` and the whole suite stayed green (they compile the worktree); on the pushed tree
the same commit failed **three** jobs at once with three different faces: `TS2305: has no
exported member`, three route smoke tests answering 500, and the e2e job dying at
`SyntaxError: The requested module './constants.js' does not provide an export named …`
before the API ever booted. One missing export, three unrelated-looking red jobs.

This repo's commit discipline makes it likely, not rare: commits are made with an explicit
pathspec (`git commit -- <paths>`) so a sibling session's files cannot be swept in, and a
pathspec silently omits anything not named. After committing, check `git status` for
leftovers that the committed code imports — or read `git show --stat HEAD` against the set
of files the change actually touched.
**Evidence:** `server/src/modules/skills/routes.ts:8`, `server/src/modules/skills/constants.ts:22`

### 2026-09-20 — a "no DB" test that calls any route handler is DB-backed unless it injects `auth`

`test/routes-smoke.test.ts` builds the app with no `db` and calls itself no-DB, and it is
green on a dev box — because `docker compose` is up. In CI's unit job (no Postgres) three of
its cases answered **500**. Every module handler opens with
`getContext(app.container, req)`, and the default `LocalNoAuthProvider` resolves the system
user and the default workspace **from the database** on the first request. A route whose
body never runs (bad input rejected by the Zod schema at the edge → 422) hides this
completely, so a smoke test that only checks validation stays green and the one that
exercises the handler does not.

Any non-`*.it.test.ts` test that expects a handler to run must pass
`overrides: { auth: new MockAuthProvider() }`. "It passes locally" is not evidence of
hermeticity here; re-run the unit suite with an unreachable `DATABASE_URL`
(`DATABASE_URL='postgres://x:x@127.0.0.1:1/none' pnpm exec vitest run --exclude '**/*.it.test.ts'`)
— that is the CI condition, and it takes two seconds.
**Evidence:** `server/src/adapters/auth/local.ts:20`, `server/src/modules/_shared/context.ts:14`

### 2026-09-20 — picking an LLM provider "by whichever key is configured" makes the test suite spend real money

`platform/config.ts:1` is `import 'dotenv/config'`, so a test run loads `server/.env` —
including the developer's real `OPENROUTER_API_KEY` — into `process.env`, and
`LocalSecretsProvider` falls back to `process.env`. A feature that chose its provider by
asking "does this key exist?" therefore saw a *real* OpenRouter key inside the suite, skipped
the `MockLLMProvider` the test had injected for `openai`, built a real client and made real
paid calls. It surfaced as four assertion failures against live model output plus 10–30s
durations where a mock should be instant — never as anything that says "network".

The rule that fixes it, in `Container.canUseLlm`: **injected providers replace the real
world, they do not extend it.** When `overrides.llm` is present at all, only the injected
ids are available:

```ts
if (this.overrides.llm) return Boolean(this.overrides.llm[id]);
```

Anything new that selects a provider dynamically must go through `container.canUseLlm`, never
`secrets.get` directly — the container is the only thing that knows a mock is wired.
**Evidence:** `server/src/platform/container.ts`, `server/src/modules/_shared/feature-models.ts`

### 2026-09-20 — the conventions sampler's config wish-list contributes nothing on this repo, and silently

`CONFIG_SAMPLE_PATHS` reads `package.json`, `tsconfig.json`, eslint/prettier/editorconfig,
`CONTRIBUTING.md`, `CLAUDE.md`, `AGENTS.md` — all at the **repo root**. A live scan of
`shofulk/dev-digest` sampled 12 files and **not one config**, because this repo is four
standalone packages with no root `package.json` and no root `tsconfig.json`. An unreadable
path is skipped by design (the list is a wish-list), so the miss leaves no log line and the
scan just quietly costs the same tokens for less signal.

This matters because config files are the cheapest high-confidence evidence there is — a
rule stated outright by an eslint config is far harder to hallucinate than one inferred from
source. For any multi-package repo the sampler should glob one level down
(`*/package.json`, `*/tsconfig.json`, `*/AGENTS.md`) rather than only the root. Until it
does, treat a conventions scan of a monorepo as source-only.
**Evidence:** `server/src/modules/conventions/constants.ts`

## Codebase Patterns

Conventions and structural decisions that are not stated in the code.

<!-- newest first: codebase-patterns -->

### 2026-09-20 — a long job can stream progress with no `jobs` row and no table: `RunBus` is keyed by an arbitrary string and replays its buffer

`platform/sse.ts` keys everything by a plain string, not by an `agent_runs` id, and
`subscribe()` replays `buffers` before going live while `complete()` deletes only the
emitter. So minting `randomUUID()` as a synthetic stream id gives a detached job live
progress **and** correct behaviour for a client that subscribes late or reconnects — verified
by curling `/conventions/scans/:id/events` after the scan had already finished and receiving
the full sequence, then a clean end-of-stream.

Two traps:

- **`runBus.complete(id)` must run in a `finally`.** Without it every subscriber's SSE
  connection hangs open forever; nothing in the logs says so.
- Prefer this over `JobRunner` for anything that costs a model call. `JobRunner` is built
  once in `container.ts` with `timeoutMs: 120_000, retries: 2` and exposes **no per-enqueue
  override**, so a slow paid call is killed at 120s and then retried twice — up to 3× the
  spend, all publishing into one stream.

Do **not** reuse `agent_runs` for this even though `agent_id`/`pr_id` are nullable: those
rows feed the PR cost rollups, the run history list and `/runs/:id/trace`.
**Evidence:** `server/src/modules/conventions/service.ts`, `server/src/platform/sse.ts:63`

### 2026-09-20 — a file upload sent as base64 JSON is refused by Fastify's 1 MiB default long before the route's own size cap is reached

`POST /skills/import/preview` takes `{ filename, content_base64 }` and caps a `.zip` at
5 MiB — but Fastify's global `bodyLimit` is 1 MiB and base64 inflates by 4/3, so a real
5 MiB archive is ~6.7 MiB on the wire and is rejected by the framework with a generic
413 that never reaches the module's human-readable "too large" message. The route lifts
its own limit (`bodyLimit` in the route options, 7 MiB) instead of raising the global one,
so nothing else on the API accepts a large body. Any future route that carries a file as
base64 needs the same per-route limit, sized as `cap * 4/3` plus JSON overhead; the
in-code size check stays the source of the user-facing message.

**Evidence:** `server/src/modules/skills/constants.ts:15`

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

### 2026-09-20 — `db:generate` hangs on an interactive "is this a rename?" prompt; splitting the change into two passes avoids it entirely

drizzle-kit asks the rename question only when one diff contains **both** a DROP and an ADD
on the same table. It reads the tty directly, so the prompt cannot be driven from a script:
`yes '' |` and `printf '\r' | script` both hang, and the recorded
`(for i in …; do printf '\r'; done) | script -qec … /dev/null` workaround is a coin flip you
then have to audit by reading the SQL.

Do not fight the prompt — **never let it fire.** Split the schema edit in two:

```
# pass 1 — ADD only, leaving the doomed column in place
pnpm --dir server db:generate && pnpm --dir server db:migrate
# pass 2 — now remove the column (and any import it was the sole user of)
pnpm --dir server db:generate && pnpm --dir server db:migrate
```

Verified on `conventions.accepted boolean` → `status text`: two migrations (`0013`, `0014`),
zero prompts. Ordering inside pass 1 is also what makes the CHECK constraints safe — drizzle
emits `ADD COLUMN … NOT NULL DEFAULT` *before* `ADD CONSTRAINT … CHECK`, so existing rows
already hold a legal value when the constraint validates the table.
**Evidence:** `server/src/db/migrations/0013_strange_the_liberteens.sql`

### 2026-09-20 — dependency-cruiser rules that look right never fire: pnpm paths and the tsconfig aliases both defeat anchored regexes

Two resolution facts, each of which turns a rule into a silent no-op:

1. pnpm resolves a package to `node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/index.js`,
   so `to: { path: '^node_modules/zod/' }` matches nothing. Leave npm paths **unanchored**
   (`'node_modules/zod/'`). A rule that matches nothing reports success, so this reads as
   "architecture is clean" rather than as a broken rule.
2. `@devdigest/shared` and `@devdigest/reviewer-core` are tsconfig path aliases, and
   `tsConfig: { fileName: 'tsconfig.json' }` makes depcruise follow them. Consequence:
   cruising `server/src` also pulls in `../reviewer-core/src/**` (11 modules), and
   reviewer-core's own `@devdigest/shared` imports surface as `src/vendor/shared/**`. So any
   rule phrased "nothing may import `^src/…`" fires on reviewer-core too, and a
   purity rule for reviewer-core must carve `^src/vendor/shared/` back out via `pathNot`.

**Evidence:** `server/.dependency-cruiser.cjs:128`

### 2026-09-20 — `pnpm arch`: the architecture baseline is 0 errors / 17 warnings, and the warnings are the todo list

`depcruise` is already a runtime dependency (it backs `src/adapters/depgraph`), so the
layering check needed no install — only `server/.dependency-cruiser.cjs` and a `pnpm arch`
script. Rule severities encode state, not opinion: `error` = clean today, `warn` = known
violations, each named in an `OUTSTANDING` comment inside the rule. The 17 today are
db/schema imported outside the persistence ring (8), cycles (5 — four are the
`container.ts ↔ modules/repo-intel/service.ts` knot, since the container constructs the
service while the service takes the container), adapters importing
`modules/repo-intel/constants.ts` (2), and `modules/repos/service.ts` reaching into
repo-intel (1). Raising a count is the regression signal; a rule goes to `error` in the
commit that clears its last violation. Full rules and rationale: the `onion-architecture`
skill.

**Evidence:** `server/.dependency-cruiser.cjs:12`

## Recurring Errors & Fixes

Errors seen more than once, each with the signal that identifies it.

<!-- newest first: recurring-errors-and-fixes -->

### 2026-09-20 — `TypeError: Cannot read properties of undefined (reading 'skills')` in `reviews.it.test.ts`, about one full run in two

**Cause:** `run-executor.ts` awaits `completeAgentRun({ status: 'done' })` and only then
builds and writes the `run_traces` document, while `test/helpers/runs.ts` `waitForPrRuns`
polled `agent_runs.status` alone. The test is therefore allowed to fetch
`GET /runs/:id/trace` before the row exists, get the 404 envelope back, and read
`trace.prompt_assembly` off it as `undefined`.
**Signal:** a `.it.test.ts` reading a trace fails with `Cannot read properties of undefined`
on a field of `trace`, fails roughly every other **full** run, and passes 3/3 in isolation —
the race only opens when the suite is under load.
**Fix:** `waitForPrRuns` now also waits for one `run_traces` row per terminal run. Anything
new that is persisted *after* the status flip needs the same treatment; a status of `done`
is not a promise that the run's side documents are on disk.
**Evidence:** `server/test/helpers/runs.ts:33`, `server/src/modules/reviews/run-executor.ts:257`

## Session Notes

Dated summaries of sessions worth remembering as a whole.

<!-- newest first: session-notes -->

## Open Questions

Things left unresolved, so the next session does not re-derive the same uncertainty.

<!-- newest first: open-questions -->
