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
configuration and conventions (that is `CLAUDE.md`), or anything a linter or type-checker
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

## Open Questions

Things left unresolved, so the next session does not re-derive the same uncertainty.

<!-- newest first: open-questions -->
