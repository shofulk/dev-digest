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

### 2026-10-03 - a containment check alone lets an in-checkout symlink read the clone's `.git/config` (GitHub token)
Every clone stores the token in its remote URL (`withGitHubToken`), so `.git/config` inside the
checkout is a secret. `realpath` containment passes a symlink like `docs/x.md → ../.git/config`.
Any new reader of checkout files must re-apply its path policy (`.md`, roots, `dot:false`) to
the realpath-resolved repo-relative path, not only to the requested path. The pre-existing
`readClone` in repo-intel follows symlinks with no containment at all.
**Evidence:** server/src/adapters/project-docs/index.ts:114, server/src/modules/repos/helpers.ts:29, server/src/modules/repo-intel/service.ts:907

### 2026-10-03 — `seedProjectContextDemo` re-ran `.set({ clonePath, contextDocs })` unconditionally on every seed, clobbering a user's own edits

`seedProjectContextDemo` (`src/db/seed-project-context.ts`) is called on every
`pnpm db:seed`, not just the first one. Its two `db.update(...)` calls that
point `repos.clone_path` at the demo checkout and set the Security Reviewer
agent's `context_docs` to `['docs/architecture.md']` used to run unconditionally
every time — so a user who repointed `clone_path` at a real checkout, or edited
`context_docs` through the UI, lost that edit on the next `db:seed` (e.g. after
pulling a migration). Fix: guard each write — `clonePath` only when it is still
`null`, `contextDocs` only when still empty — so the demo values are a one-time
default, not a reset-on-every-seed.
**Evidence:** `server/src/db/seed-project-context.ts:87` (`if (repo.clonePath
=== null)`), `:95` (`if (agent && (agent.contextDocs?.length ?? 0) === 0)`),
`server/test/seed-project-context.it.test.ts`.

### 2026-10-03 — `js-tiktoken`'s default `encode()` throws on untrusted text containing a special-token string, and the tokenizer adapter latched `broken` on it forever

`TiktokenTokenizer.count()` (`adapters/tokenizer/index.ts`) counts every document
passed through Project Context / repo-map, and some of that text is untrusted (a
PR body, a doc from the repo). `js-tiktoken`'s `encode(text)` throws
`"The text contains a special token that is not allowed: <|endoftext|>"` for any
text containing one of cl100k_base's reserved special-token strings — this is
intentional upstream behavior (it assumes the caller controls the input), not a
bug in the library. The adapter's catch block treated that exception exactly
like an encoder-load failure and set `this.broken = true`, which is a field on
the single shared `TiktokenTokenizer` instance — so one untrusted document
containing that literal string silently downgraded EVERY later `count()` call,
for the rest of the process, to the `ceil(chars/4)` heuristic. Fix: pass `'all'`
as the second argument (`encode(text, 'all')`) so each recognized special-token
string maps to the ONE special token it represents instead of throwing — not,
as the code once mis-stated in a comment, counted as ordinary text (which
would cost ~7 plain-text tokens instead of 1); `broken` now only latches on an
actual encoder-load failure.
**Evidence:** `server/src/adapters/tokenizer/index.ts:41` (`encode(text,
'all')`), `server/test/tokenizer.test.ts`.

### 2026-10-03 — `seedProjectContextDemo` writes its fixtures only once, keyed on the clone dir, not the DB

Follow-up to the entry directly below: the idempotency check (`writes the demo checkout
fixtures, only when the folder is absent`) is a filesystem check on `<cloneDir>/acme/
payments-api`, run BEFORE the DB insert, not a DB-state check. `cloneDir` is
`config.cloneDir`, i.e. `DEVDIGEST_CLONE_DIR` (default `~/.devdigest/workspace`); this
repo's `server/.env` sets it to `./clones`, so the demo tree actually lands at
`server/clones/acme/payments-api`. Deleting that folder and re-running `db:seed` writes
the fixtures again even though the `repos`/`agents` rows from the first run are still
there — and, conversely, wiping the DB but leaving the folder means the fixture content
is never rewritten (the inserts guard separately on `DEMO_RUN_ID`). The two idempotency
checks are independent and can disagree.
**Evidence:** `server/src/db/seed-project-context.ts:52` (`access(path)` gate before the
write), `:71` (`join(cloneDir, 'acme', 'payments-api')`), `server/src/platform/config.ts`
(`cloneDir` ← `DEVDIGEST_CLONE_DIR`), `server/.env` (`DEVDIGEST_CLONE_DIR=./clones`).

### 2026-10-03 — `seed-project-context`'s demo checkout is a plain folder, so Resync on it degrades silently instead of reporting `index_failed`

D10's seeded `acme/payments-api` checkout (`server/src/db/seed-project-context.ts`) is a
plain directory under `DEVDIGEST_CLONE_DIR` (default `~/.devdigest/workspace`) with no
`git init` and no `.git` — by design, so the demo never needs a real upstream to clone
from. Clicking Resync on that repo therefore fails at `this.container.git.sync(ref,
defaultBranch)` (`modules/repo-intel/service.ts:151`, `resyncRepo`): `simple-git`'s
`fetch()` throws `fatal: not a git repository (or any of the parent directories): .git`,
caught and turned into `{ status: 'degraded', reason: 'sync_failed:...' }`.

The assumption going in was that this would surface as `GET /repos/:id/index-state`
reporting `degradedReason: 'index_failed'` — confirmed WRONG by running the actual
request. `resyncRepo`'s early-return-on-sync-failure branch never calls
`repository.upsertIndexState`, and the enqueuing job handler swallows the returned
`IndexResult` entirely (`registerIndexJobHandlers`, "handlers swallow the IndexResult on
purpose"), so nothing is ever persisted to `repo_index_state` for this repo. A repo that
was never indexed has no row there at all, so `getIndexState` keeps returning its
synthesised fallback — `degradedReason: 'no_data'` — **before and after** clicking
Resync, unchanged. `index_failed` is a real `DegradedReason` value, but only for a
different failure mode (an indexer-internal crash that DOES reach
`upsertIndexState` with `status: 'degraded'|'failed'` and no explicit reason); this path
never reaches it.
**Evidence:** `server/src/modules/repo-intel/service.ts:143-160` (`resyncRepo`),
`server/src/modules/repo-intel/repository.ts:204-234` (`tryGetIndexState` default
`degradedReason: 'index_failed'` only applies to a persisted degraded/failed row),
`server/src/modules/repo-intel/service.ts:188-202` (`getIndexState`'s no-row fallback:
`reason: 'no_data'`), `server/src/db/seed-project-context.ts`.

### 2026-10-03 — importing a `modules/_shared/*` pure helper from an adapter raises the `arch` warn count even though the helper is ring 1

`src/adapters/project-docs/index.ts` (ring 2) needs the same path-syntax check as
`modules/_shared/project-context/helpers.ts#checkDocPathSyntax` (D6: relative, no `..`,
no backslash, ends `.md`). Importing that helper from the adapter compiles and
typechecks fine, but `pnpm arch` adds a new `adapters-dont-know-modules` violation — the
rule is `from: src/adapters/` → `to: src/modules/`, with no carve-out for `_shared`. The
baseline (17 warnings) is a ceiling, not a target, so this one new edge fails the gate.
**Fix:** duplicate the handful of lines of pure logic inside the adapter instead of
importing across the boundary; it is cheap and keeps ring 2 from depending on ring 1.
**Evidence:** `server/src/adapters/project-docs/index.ts` (`syntaxOk`), `server/src/modules/_shared/project-context/helpers.ts` (`checkDocPathSyntax`), `server/.dependency-cruiser.cjs` (`adapters-dont-know-modules`).

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

### 2026-10-03 - `pnpm arch` stays at baseline while a ring-1 function takes a raw `Db`
depcruise checks import edges, and `_shared/agent-skills.ts` already imports the `Db` type, so a
new ring-1 function with a `db: Db` parameter (or a service field typed `Container['db']`) is
invisible to it. "arch 0 errors" does not prove a service avoids raw DB access. Reach agent-skill
data through `Container['agentSkills']` (the ring-2 `AgentSkillsRepository`), resolved in the constructor.
**Evidence:** server/src/modules/_shared/repository/agent-skills-port.repo.ts:15, server/src/modules/_shared/agent-skills.ts:78

### 2026-10-03 — a ring-2 class that needs both another ring-2 file's row-fetchers AND a ring-1 file's pure helpers goes in its own, third file

Fixing ARCH-7 (F8, project-context round 2) needed a `AgentSkillsRepository` that
implements the ring-1-declared `AgentSkillsPort`: it must call
`linkedSkillRowsForAgent(s)` (ring 2, `_shared/repository/agent-skills.repo.ts`) and then
`toSkillSet` (ring 1, `_shared/agent-skills.ts`, which itself imports the row-fetchers from
that same `.repo.ts`). Putting the class straight into `agent-skills.repo.ts` would have
made that file import back from `agent-skills.ts` — a two-file cycle, caught by
`no-circular` the moment it is added — because `agent-skills.ts` already imports from
`agent-skills.repo.ts`. Fix: a third, sibling file
(`_shared/repository/agent-skills-port.repo.ts`) that imports from both and is imported by
neither. The general rule: when a ring-2 implementation needs ring-1 pure logic, it cannot
live inside the same file ring-1 already depends on for its own data access — check `rg -n
"^import" <the ring-2 file ring-1 already imports>` before placing the new class, not after
`pnpm arch` flags it.
**Evidence:** `server/src/modules/_shared/repository/agent-skills-port.repo.ts`.

### 2026-10-03 — `ProjectDocsSource.list` surfacing a bare `ENOENT` for "checkout missing" (ARCH-3) forces every caller to re-derive the errno check

**Supersedes:** 2026-10-03 entry "detecting \"the checkout directory itself is gone\" from
a ring-1 service without giving `ProjectDocsSource` an `exists` method" — that approach
(service catches the adapter's thrown `ENOENT`, reads `(err as
NodeJS.ErrnoException).code`) is exactly what the architecture review flagged: a ring-1
service naming a Node errno is ring 1 knowing a ring-2 implementation detail, and it means
every future caller of `list()` has to remember to add the same `try/catch`. Fix: `list()`
now returns a discriminated union, `ProjectDocsListResult = { status: 'ok'; files; truncated
} | { status: 'root_missing' }` (added next to the existing `ProjectDocRead` union in
`@devdigest/shared`, so "missing root" is a first-class outcome of the port, not an
exception). `FsProjectDocsSource.list` is the only place that still touches
`NodeJS.ErrnoException` — it maps `ENOENT` on the initial `fs.access(root)` to `{ status:
'root_missing' }` internally and lets every other `fs` error propagate as a real throw.
`ProjectContextService.scan()` just checks `result.status === 'root_missing'`.
`MockProjectDocsSource` takes an `{ rootMissing }` constructor option to produce the same
outcome without touching a filesystem.
**Evidence:** `server/src/vendor/shared/adapters.ts` (`ProjectDocsListResult`),
`server/src/adapters/project-docs/index.ts` (`list`), `server/src/modules/project-context/service.ts` (`scan`).

### 2026-10-03 — detecting "the checkout directory itself is gone" from a ring-1 service without giving `ProjectDocsSource` an `exists` method

D5 defines "no checkout" as `repos.clone_path` null OR the directory missing on disk, but
`ProjectDocsSource` (D2) is fixed at exactly `list`/`read`/`matchesRoots` — no `node:fs` in
ring 1 to check directory existence directly, and adding a fourth port method widens an
interface three lanes already implement against (`FsProjectDocsSource`,
`MockProjectDocsSource`). Fix: `FsProjectDocsSource.list` calls `fs.access(root)` first and
lets `ENOENT` propagate; `ProjectContextService.scan()` wraps the `list()` call and
re-throws any `ENOENT`-coded error as `AppError('repository_not_synced', …, 409)`. This
keeps the existence check entirely inside the one adapter that is allowed `node:fs`, with
the service only inspecting an error code (no fs import needed there).
**Evidence:** `server/src/modules/project-context/service.ts` (`scan`), `server/src/adapters/project-docs/index.ts` (`list`).

### 2026-10-03 — a new ring-1 service needs another module's shared repository type without naming that module

A service that needs `container.reposRepo` (or `agentsRepo`/`reviewRepo` — the
cross-cutting repos the composition root builds, per the comment in
`platform/container.ts`) must not `import type { RepoRepository } from
'../repos/repository.js'`: that is exactly the "module importing another
module's repository.ts" anti-pattern dependency-cruiser's
`no-cross-module-internals` rule flags, even though the value itself flows
through `container`, not a direct import. The fix already in the codebase
(`modules/conventions/service.ts:65`) is to type the field with an indexed
access on `Container` itself — `private readonly reposRepo:
Container['reposRepo'];` — which resolves to the same `RepoRepository` type
without a second import site. `modules/smart-diff/service.ts` takes the
alternative route (a hand-written structural interface) when the consumer
only needs a few methods; the indexed-access form is less code when the whole
repository type is wanted.
**Evidence:** `server/src/modules/conventions/service.ts:65`,
`server/src/modules/project-context/service.ts:21`

### 2026-09-28 — a blast caller's `file:line` is correct and its GitHub link still opens unrelated code
Every repo-intel line number (`references.line`, `symbols.line`) belongs to the commit the
index was built from — `repo_index_state.lastIndexedSha`, a default-branch commit — never to
the PR head. A link pinned to `pr.head_sha` drifts as soon as the PR edits the caller's file:
live on shofulk/dev-digest, `getRepoMap → service.ts:409` is the `tryGetIndexState` call at
`c6af1e4`, but ~100 lines down (514) at the PR head, so the link opened unrelated code. Any
consumer that turns an indexed line into a URL or a diff anchor must pin it to the indexed
sha; `GET /pulls/:id/blast` returns it as `indexed_sha` (null when the map did not come from
the index), and the client falls back to `head_sha` only then.
**Evidence:** `server/src/modules/blast/service.ts:142`, `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/BlastRadiusCard/helpers.ts:61`

### 2026-09-28 — a dedupe key over `file|symbol|line` alone silently drops a real caller when one line reaches two changed symbols

`mapFacadeBlast`'s dedupe key was `${c.file}|${c.symbol}|${c.line}`, with no `viaSymbol` — so
one source line that calls two different changed symbols (e.g. `format(parse(x))` at
`ui.ts:12`, both `parse` and `format` changed in the same PR) produced two facade caller rows
with the *same* `file|symbol|line` but different `viaSymbol`. The dedupe set treated the
second as a duplicate of the first and dropped it, so only whichever symbol happened to be
grouped first in `fb.callers` kept that caller; the other symbol's `downstream` entry lost a
real caller (and, transitively, that caller file's endpoints/crons). The bug is invisible in
any fixture where each caller line reaches only one changed symbol — the common case — which
is exactly why it survived a first review pass. Fix: key on
`${c.viaSymbol}|${c.file}|${c.symbol}|${c.line}` instead, since dedupe is meant to be *within*
one symbol's caller group, not across groups. Any future caller-list dedupe key in this
module must include the grouping key it is nested under, not just the row's own identity
fields.
**Evidence:** `server/src/modules/blast/helpers.ts:76`, `server/test/blast-helpers.test.ts`
("a caller line reaching two changed symbols … is kept in both groups")

### 2026-09-28 — the per-symbol caller cap must apply to hop 1 BEFORE the hop-2 frontier is seeded, not just to the final combined list

`tryPersistentBlast` capped `allCallers` to `MAX_CALLERS_PER_SYMBOL` only once, after both
hops were collected. That caps the *output*, but the hop-2 frontier is seeded from ALL hop-1
callers, uncapped — so a changed symbol with (say) 500 direct callers fans out into a hop-2
query over up to 500 frontier files/names, all of which are computed and then thrown away
except the final 20. Besides the wasted query breadth, it also means which callers make the
final cut can depend on which unbounded hop-1 row happened to seed a matching hop-2 row,
rather than being determined purely by rank. Fix: sort hop-1 rows by rank descending and cap
to `MAX_CALLERS_PER_SYMBOL` per `viaSymbol` right after the declaring-file filter and BEFORE
building `hop1SymsByFile`/the frontier — only the capped rows seed hop 2 and are carried
forward as hop-1 callers. The existing "cap is global across hops" test (T2 test `(e)`) still
passes unchanged because its hop-1 count (18) is under the cap; a new test with 25 hop-1
callers of one symbol asserts the recorded `getResolvedCallers` hop-2 call args contain only
the top-20-by-rank frontier files (via an `onResolvedCallers` recorder in the fake repo,
added to `test/repo-intel-blast-persistent.test.ts`'s `buildService`).
**Evidence:** `server/src/modules/repo-intel/service.ts:354-368` (hop-1 build),
`server/test/repo-intel-blast-persistent.test.ts` ("(g) hop-1 is capped per symbol by rank
BEFORE seeding the hop-2 frontier")

### 2026-09-28 — validating an untrusted string against a Zod string-literal enum inside a ring-1 pure file, without importing the runtime schema

`modules/blast/helpers.ts` is ring-1 pure and imports `@devdigest/shared` types only (C1).
`deriveBlastStatus` receives `indexReason`/`facadeReason` as plain `string | null` (they
come from a jsonb `degradedReason` column and the facade's own untyped field) and needs to
narrow them to the contract's `BlastDegradedReason` literal union. `value as
BlastDegradedReason` compiles and always "succeeds", so an unrecognised stored string (a
typo, a future value, test data) would pass straight through instead of falling back.
Importing the real `BlastDegradedReason` Zod object from `@devdigest/shared` for
`.safeParse` would work but pulls a runtime value into a file that otherwise carries only
type imports. Fix used instead: a local `Set<BlastDegradedReason>` literal mirroring the
enum's five values, checked with `.has()` before the cast, falling back to a caller-supplied
default when the value is missing or unrecognised — keeps the type-only import and still
rejects garbage.

**Evidence:** `server/src/modules/blast/helpers.ts:143-176`,
`server/src/vendor/shared/contracts/brief.ts:99-106`

### 2026-09-28 — `repo-intel/types.ts` row types have two producers in `service.ts`, so widening one for a new field breaks the other silently until `typecheck` runs

Adding `depth`/`via` to `BlastCallerRow` (for the blast BFS hop-2 work) only needed the
persistent path (`tryPersistentBlast`/`expandHop`) to populate them, but the type is also
built by the unrelated ripgrep-fallback path in `getBlastRadius` (`callerRows.push({...})`,
no `depth`/`via`) — a second, easy-to-miss literal construction of the same row shape in the
same file. `pnpm typecheck` catches it (`TS2345: missing depth, via`), but only because both
producers live in `src/`, which `typecheck` compiles; a producer added only under `test/`
would not be caught (see the 2026-09-26 `tsc` entry above). Before widening any row type in
`repo-intel/types.ts` with a required field, `rg` the file for every literal that builds that
type — `service.ts` in particular has two independent code paths (persistent index, ripgrep
degraded fallback) that both construct `BlastCallerRow`/`BlastResult`.
**Evidence:** `server/src/modules/repo-intel/types.ts` (`BlastCallerRow`),
`server/src/modules/repo-intel/service.ts` (`tryPersistentBlast`, `getBlastRadius`)

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

### 2026-09-26 — `tsc --noEmit -p tsconfig.json` never sees `test/*.ts`, so a type error injected only into a test file is invisible to `pnpm typecheck`

`server/tsconfig.json` is `"include": ["src/**/*.ts"]` — `test/` is out of scope for the
compiler run `typecheck` invokes. `MockLLMProvider`'s constructor was typed
`id: 'openai' | 'anthropic'`, so `new MockLLMProvider('openrouter', …)` (needed to give the
S27 intent classifier its own mock, separate from the review's) is a real type error, but
`pnpm typecheck` stayed green because it never compiled the file containing it — only
`vitest` (esbuild, types stripped, no checking) ran it, so it also passed. Widened
`MockLLMProvider`'s `id` to include `'openrouter'` (`ContainerOverrides.llm` already allowed
it) rather than leave a test-only type hole. Any change that only touches `server/test/**`
needs its own read-through — `typecheck` will not catch a type mismatch there.
**Evidence:** `server/src/adapters/mocks.ts:59`, `server/tsconfig.json:23`,
`server/test/reviews.it.test.ts:139`

### 2026-09-26 — a grep-based probe (`rg -n '<banned-substring>' <dir>`) fails on a comment that merely NAMES the banned thing, not just on a real violation

Writing the C1 ring-purity guarantee ("`_shared/intent/*` never imports `db/rows.ts`") as an
explanatory code comment — `// forbids importing \`db/rows.ts\` here` — makes probe P6(b)
(`! rg -n 'db/rows|/repository/|platform/container' server/src/modules/_shared/intent`) fail,
because the probe cannot distinguish "this file imports X" from "this comment is ABOUT X".
Same trap hit P6(a) (`intent.repo`, `getIntentRow`, `toPrIntentRecord` named in doc comments
in files that don't call them) and P6(b) again (`platform/container.ts` named in a comment
explaining WHY it is never imported). Fix: describe the forbidden thing without its literal
path/identifier in any comment inside a directory a textual probe scans (e.g. "the
persistence row-type module" instead of `` `db/rows.ts` ``, "the DI container module" instead
of `` `platform/container.ts` ``). Write comments in a probed file as if the probe's exact
regex will run over them, because it will.
**Evidence:** `server/src/modules/_shared/intent/derive.ts` (header comment),
`server/src/modules/_shared/intent/helpers.ts` (header comment),
`docs/plans/intent-layer.plan.md` probe P6

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

### 2026-10-04 — `server/src/adapters/mocks.ts` and `db:seed` both broke a CI job that installs fewer deps than `server/`'s own
**Cause:** two independent CI jobs resolve `server/src/**` modules with a lighter dependency set than `pnpm --dir server install` gives you locally: (1) `reviewer-core.yml`'s `tests` job runs `npm ci` inside `reviewer-core/` only, and `reviewer-core/test/run.test.ts` / `run-project-context.test.ts` import `../../server/src/adapters/mocks.ts` directly — any runtime (non-type, non-relative) import added to `mocks.ts` must resolve from `reviewer-core/node_modules`, which it never does; (2) `e2e-web.yml`'s `browser flows` job runs `pnpm db:seed` in `server/` BEFORE its separate "Install reviewer-core deps" step, so anything `db:seed` imports that transitively pulls in `@devdigest/reviewer-core` (its `structured.ts` imports `openai`) crashes with `ERR_MODULE_NOT_FOUND` mid-seed.
**Signal:** `Cannot find module './lib/picomatch'` from a `reviewer-core/test/*.test.ts` that only imports `server/src/adapters/mocks.ts`; or `ERR_MODULE_NOT_FOUND: Cannot find package 'openai'` during `pnpm db:seed` pointing at `reviewer-core/src/llm/structured.ts`.
**Fix:** keep `mocks.ts` free of any runtime third-party import — reimplement the small amount of logic needed locally instead (e.g. a hand-rolled glob matcher instead of `picomatch`, parity-tested against the real `picomatch({ dot: false })` in a server-only test). Keep `src/db/seed-project-context.ts` free of any `@devdigest/reviewer-core` import — build the fixed demo string it needs as a literal, and pin it to the real function's output with a dedicated server test (`vitest` resolves the `@devdigest/reviewer-core` alias; `db:seed` does not).
**Evidence:** server/src/adapters/mocks.ts:1 (header comment), server/src/db/seed-project-context.ts:33, server/test/mocks-project-docs-matcher-parity.test.ts, server/test/seed-project-context.test.ts, .github/workflows/reviewer-core.yml, .github/workflows/e2e-web.yml:65-80

### 2026-10-03 - an `*.it.test.ts` error assertion on `res.json().message` can never pass
**Cause:** the app-wide error handler sends `{ error: { code, message, details } }`; there is no top-level `message`, and `.error` is an object.
**Signal:** `.toMatch()` throws a TypeError, or the test fails although the route returns the right status and text.
**Fix:** assert `res.json().error.message` (and `error.code`), as the other module tests do.
**Evidence:** server/src/app.ts:120, server/test/skills.it.test.ts:338

### 2026-09-25 — a pre-work LLM call sharing an injected mock provider silently steals `llm.calls[0]` from the review's own assertion

**Cause:** the intent layer's pre-work step (`run-executor.ts` `resolveIntent`, before the
per-agent loop) resolves its provider through `resolveUsableFeatureModel(review_intent, …)`.
With no workspace override and no `openrouter`/`anthropic` mock injected, it falls through
`CHEAP_CHOICES` to whichever provider IS injected — in `test/reviews.it.test.ts` that is the
same single `MockLLMProvider` instance the test passes as the review agent's own
`overrides.llm.openai`. The classifier's `completeStructured({schemaName:
'IntentClassification'})` call is recorded on that instance's `.calls` array BEFORE the
review's own `completeStructured({schemaName: 'Review'})` call, because it runs first.
**Signal:** a `.it.test.ts` doing `llm.calls.find(c => c.method === 'completeStructured')` to
inspect the review's own prompt gets the WRONG call — content that looks like an unrelated
prompt (here: `## PR` / `## Changed files` / `## Missing context`, the intent classifier's
sections) instead of `## Diff to review`. The classifier call itself throws inside the mock
(`MockLLMProvider fixture failed schema`, since the review fixture doesn't satisfy
`IntentClassification`) and is swallowed by `resolveIntent`'s catch — so the run still
completes `done`, which makes the failure look purely like a content mismatch, not a second
call existing at all.
**Fix:** not fixed in this iteration (a hard test-writing constraint deferred T5, the test
that is meant to give the classifier its own `overrides.llm.openrouter` mock — see
`server/.spec/intent-layer.spec.md`). Any test written from now on that asserts on
`MockLLMProvider.calls` for a review run must either inject a distinct provider for
`review_intent` (own mock, e.g. `overrides.llm.openrouter`) so the two calls land on
different `.calls` arrays, or filter `.calls` by `req.schemaName === 'Review'` instead of
taking the first `completeStructured` entry.
**Evidence:** `server/src/modules/reviews/run-executor.ts` (`resolveIntent`),
`server/src/modules/_shared/intent/deps.ts`, `server/test/reviews.it.test.ts:309`

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
