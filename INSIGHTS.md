# INSIGHTS — repo root

Empirical findings that belong to no single package: cross-package behaviour, `scripts/`,
Docker, CI and tooling. Things that cost time to discover and that the code does not say
out loud. Written and read by the `engineering-insights` skill — read this
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

Not for: anything scoped to one package (use that package's `INSIGHTS.md`), stable
configuration and conventions (that is `AGENTS.md`), or anything a linter or type-checker
already catches.

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

### 2026-09-16 — `WEB_PORT` is one variable with two consumers; setting it on one side gives CORS errors

`WEB_PORT` drives both the port `client`'s `pnpm dev` binds (`next dev -p ${WEB_PORT:-3000}`
— npm runs scripts through `sh`, so the expansion happens there, no extra tooling needed)
and the API's CORS allow-origin (`config.webOrigin` = `http://localhost:$WEB_PORT`,
`server/src/platform/config.ts:77`). Changing it only in `client/.env` moves the web app but
leaves the API allowing the old origin, and the failure surfaces as a browser CORS error with
nothing wrong in either log. `scripts/dev.sh` therefore resolves it once and `export`s it, so
both processes inherit the same value; `scripts/e2e.sh` already did the same thing for its own
ports. Verify with `curl -H 'Origin: http://localhost:<port>' http://localhost:3001/repos` —
`access-control-allow-origin` must echo the port back.
**Evidence:** `server/src/platform/config.ts:77`

## Tool & Library Notes

Quirks of dependencies, CLIs and the toolchain.

<!-- newest first: tool-and-library-notes -->

### 2026-09-20 — lint is a CI gate, not only a local one

**Supersedes:** the closing clause of "there is a linter now…" (2026-09-20) — "The CI
workflows still run `typecheck` and `vitest` only, so lint is a local-and-`pr-self-review`
gate until a workflow picks it up." A workflow has picked it up: `client.yml`,
`server-unit.yml` and `reviewer-core.yml` run `lint` between `typecheck` and the tests, and
`e2e-web.yml` runs `npm run lint` after its `npm ci`. `server-integration.yml` deliberately
does not — `server-unit.yml` already lints that package, and the integration lane's time
belongs to Postgres.

Severity there encodes STATE, the convention `.dependency-cruiser.cjs` already used: `error`
= clean today, `warn` = known violations named in an `OUTSTANDING` comment on the rule.
`lint` exits non-zero on errors only, so the baseline (`client` 0/13, the other three 0/0) is
visible without being a permanent red build; a rising warning count is the regression signal.
`typescript-eslint` runs **without** type-aware rules, so floating promises and unsafe-`any`
are still uncaught — enabling `recommended-type-checked` is a separate, noisier step.
**Evidence:** `.github/workflows/server-unit.yml:68`, `TESTING.md`

### 2026-09-20 — `pnpm add` dies with ERR_PNPM_UNEXPECTED_STORE: the PATH pnpm is older than the one that built `node_modules`

`node_modules` in `client/` and `server/` was installed by **pnpm 12.4.2** (store v11),
while the pnpm on PATH here is **10.34.5** (store v10), and pnpm refuses to link across
store majors — the message says "reinstall your dependencies with pnpm install", which is a
much bigger hammer than the situation needs. The version that built a package is recorded in
`<pkg>/node_modules/.modules.yaml` under `packageManager` (and `storeDir`); read it and drive
that exact version instead: `cd <pkg> && npx -y pnpm@12.4.2 add -D …`. `pnpm --dir <pkg>`
from the repo root is equivalent for scripts but still uses the PATH binary, so it hits the
same wall.

Two consequences worth knowing before touching dependencies:

- A pnpm-12-written `pnpm-lock.yaml` stays `lockfileVersion: '9.0'` and **CI's pnpm 10
  (`pnpm/action-setup@v4`, `version: 10`) installs it with `--frozen-lockfile` cleanly** —
  verified by copying `package.json` + the lockfile into a temp dir and running the real
  thing, which is the only check that proves it. pnpm 12 does re-resolve peers, so the diff
  is much larger than the packages added (`simple-git` → `simple-git(supports-color@7.2.0)`
  and so on); that churn is expected, not a mistake.
- pnpm 12 writes a `pnpm-workspace.yaml` stub next to the package listing every ignored
  build script as `<pkg>: set this to true or false`, and exits non-zero with
  `ERR_PNPM_IGNORED_BUILDS` **after** the packages are already added. The install succeeded;
  do not re-run it in a loop chasing the exit code.

**Evidence:** `client/node_modules/.modules.yaml:1208`

### 2026-09-20 — there is no linter in this repo, so every `eslint-disable` comment in the source is decorative

No ESLint, Biome or Prettier exists in any of the four packages — no config file, no
dependency, no `lint` script — and the five CI workflows run only `typecheck` and `vitest`.
Three files nevertheless carry `eslint-disable … react-hooks/exhaustive-deps`
(`client/src/lib/hooks/reviews.ts:212`, `ReviewRunAccordion.tsx:60`,
`ConfigTab.tsx:39`), which reads as "this rule was considered and waived" when in fact the
rule has never run against this code. Two consequences: the whole `react-hooks` class of bug
(stale closures, missing deps, conditional hooks) is caught by nothing, and the boilerplate
line in every `INSIGHTS.md` — "not anything a linter or type-checker already catches" — today
means the type-checker alone. Before trusting a suppression comment here, check whether the
tool that would honour it is installed; `find . -name 'eslint*' | grep -v node_modules`
returns nothing.
**Evidence:** `client/src/lib/hooks/reviews.ts:212`

### 2026-09-20 — there is a linter now: eslint in all four packages, `pnpm --dir <pkg> lint`

**Supersedes:** "there is no linter in this repo, so every `eslint-disable` comment in the
source is decorative" (2026-09-20, above). Each package now carries an `eslint.config.*`
(`.mjs` in `client/`, `.js` in the other three) and a `lint` script; `pnpm --dir server lint`
and `pnpm --dir client lint` both exit 0 on the current tree. The `eslint-disable
react-hooks/exhaustive-deps` comments in `client/` are therefore load-bearing from now on —
removing one is a real rule, not decoration. The CI workflows still run `typecheck` and
`vitest` only, so lint is a local-and-`pr-self-review` gate until a workflow picks it up.
**Evidence:** `server/eslint.config.js`, `client/eslint.config.mjs`

### 2026-09-20 — a `PreToolUse` hook on `Bash` runs on *every* Bash call, and a gate hook must fail open

`.claude/hooks/pr-gate.sh` (the `pr-self-review` gate) is registered as `PreToolUse` /
matcher `Bash`, and Claude Code has no finer matcher than the tool name — the script is
spawned before every single Bash command, not just the `gh pr create` it cares about. So the
first thing it does after reading stdin is a `grep -Eq 'gh[^"]*pr[^"]*(create|merge|ready)'`
on the raw JSON and exits 0 on a miss; the `node` JSON parse only happens on a hit. Without
that bail-out every `ls` in the session pays two node starts.

Second, and more important: the script exits 0 (allow) on *any* internal error — not a repo,
unreadable state file, unknown verdict, garbage stdin. Only a known-bad verdict exits 2. A
gate hook that blocks every `gh` command when it breaks does not get debugged, it gets
deleted, and then there is no gate at all. Verdicts are `pass` / `blocked` / `inconclusive`,
and `inconclusive` (a check could not run) is kept separate from `blocked` (your code is
wrong) for the same reason.

Caveat when editing the hook: Claude Code only watches directories that already had a
settings file when the session started, so creating `.claude/settings.json` mid-session does
not arm the hook until `/hooks` is opened once or the session restarts.
**Evidence:** `.claude/hooks/pr-gate.sh:96`, `.claude/settings.json`

### 2026-09-20 — `AGENTS.md` alone does not feed Claude Code; the three-line `CLAUDE.md` next to it is load-bearing

Claude Code reads `AGENTS.md` natively only from **2.1.277** (2.1.272 was installed here when
the repo was migrated), and even after that the default `claude-md-or-agents-md` mode makes a
`CLAUDE.md` anywhere in the working directory or above **suppress** `AGENTS.md` entirely, while
a nested `AGENTS.md` loads only if that directory has no `CLAUDE.md` of its own. The setting
that reads both, `pluginConfigs["agents-md@builtin"].options.instructionFiles`, is honoured
only in user, policy and `--settings` files — it cannot be committed, so it can never be relied
on for anyone but the person who set it. Hence the shape here: `AGENTS.md` is the single source
of truth and each one has a `CLAUDE.md` beside it whose whole body is a bare `@AGENTS.md`
import (inlined at launch, path resolved relative to the importing file, works in nested files
too). The import must sit on its own line and outside backticks — inside a code span it stays
literal and the instructions silently vanish. A symlink is the wrong tool for this: Edit/Write
refuse to write through one, and git checks it out as a text file on Windows without
`core.symlinks`. Verify a change to this wiring headlessly rather than by reasoning about it —
`claude -p` from inside a package, asking for a rule that exists only in that package's
`AGENTS.md`, proves the import actually expanded.
**Evidence:** `CLAUDE.md:6`

### 2026-09-16 — changing the compose port mapping does not move an already-created container

A container's published port is baked in at *create* time. Editing `docker-compose.yml`
(now `${DEVDIGEST_PG_PORT:-5432}:5432`) and re-running `docker start` — which is what
`scripts/dev.sh` does for an existing `devdigest-postgres` — keeps the old mapping, so
`DATABASE_URL` silently points at a port nothing listens on and migrate fails with a
connection refusal rather than anything about ports. `dev.sh` now compares the container's
actual `.NetworkSettings.Ports` host port against the requested one and `docker rm -f`s it
when they differ; the named volume `devdigest_pgdata` is not touched, so the data survives.
**Evidence:** `scripts/dev.sh:85`

## Recurring Errors & Fixes

Errors seen more than once, each with the signal that identifies it.

<!-- newest first: recurring-errors-and-fixes -->

### 2026-09-16 — `EADDRINUSE` on :3001 right after Ctrl-C, with nothing visibly running

**Cause:** two bugs stacked in `scripts/dev.sh`. (1) Bash **defers a trap handler until the
running foreground command returns** — the script blocked in `(cd client && pnpm dev)`, which
never returns, so `cleanup()` was never reached on Ctrl-C *or* SIGTERM. (2) Even when it ran,
`kill $SERVER_PID` targeted the `(cd server && pnpm dev)` **subshell**; under it sit
pnpm → tsx → node, and it is the bottom node that holds the port. Reaping the subshell orphans
that node, which outlives the terminal.
**Signal:** the API keeps logging after the script printed "shutting down"; the next run dies
with `EADDRINUSE` while `ps` shows nothing obvious. `lsof -nP -iTCP:3001 -sTCP:LISTEN` finds it.
**Fix:** both dev servers run as background jobs; the script polls them in a loop and leaves as
soon as *either* exits, and `cleanup()` walks the tree with `pgrep -P` recursively, TERM then
KILL. Neither `wait` form works here: bare `wait` blocks until *every* job exits, so a client
that dies on its own hangs the script with the API still up, and `wait -n` — which would be
right — is an **invalid option on macOS's bash 3.2**, failing silently into the bare form. The
loop's `sleep` is a background job that is waited on, not a foreground `sleep`, or the trap is
deferred for its whole duration by the same rule. Do **not** reach for `set -m` instead — job
control moves the foreground job into its own process group and changes where Ctrl-C lands.
Verify all four paths, not just Ctrl-C: SIGTERM, a real Ctrl-C through a pty, the client
exiting on its own, and `--no-client`. Signalling a backgrounded script does not test SIGINT at
all, because a non-interactive shell sets it to ignore for background jobs. A leftover
`next/dist/telemetry/detached-flush.js` is Next's own detached flush, holds no port, and exits
on its own; and killing an intermediate process with `-9` reparents its children away from
`pgrep -P`, so test teardown that way and the tree walk cannot reach them.
**Evidence:** `scripts/dev.sh:210`

## Session Notes

Dated summaries of sessions worth remembering as a whole.

<!-- newest first: session-notes -->

### 2026-09-17 — findings by severity, from the PR header to the PR list

Built the L01 findings surfaces in one session, client-first and then server: severity
counters with click-to-filter in the PR header (`?severity=` in the URL, `visibleFindings`
as the single filter point), then the FINDINGS column on the PR list with a lazily-fetched
popover per severity. Specs written before the code
(`client/.spec/severity-counters.spec.md`, `client/.spec/findings-column.spec.md`).

Four things worth carrying forward, each written up in the package files:

- The first **runtime** import from the `@devdigest/shared` barrel broke `next dev` on every
  route while `typecheck` and vitest stayed green — import the contract file directly
  (`client/INSIGHTS.md`). Corollary, and the reason this session cost more than it should:
  green tests do not prove the app boots. Load one route.
- A popover in the PR list must be `position: fixed` (the list card clips it) — and must
  **not** close on `scroll`, which was my own first answer and broke its inner scrolling
  (`client/INSIGHTS.md`, with the superseding entry).
- `findings` carries no `workspace_id`, so every aggregation over it joins `reviews` for
  tenancy; neither FK column was indexed (`server/INSIGHTS.md`).
- `git log --all --grep` found a previous, reverted implementation of the same column
  (`97b6edc`) whose server diff was a ready-made reference for the aggregation idiom — the
  habit the existing `server/INSIGHTS.md` entry recommends, paying off on the first try.

**Evidence:** `client/.spec/findings-column.spec.md`

## Open Questions

Things left unresolved, so the next session does not re-derive the same uncertainty.

<!-- newest first: open-questions -->
