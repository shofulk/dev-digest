#!/usr/bin/env bash
#
# DevDigest local bootstrap — bring the whole stack up from zero.
#
#   ./scripts/dev.sh              # full: docker → migrate → seed → server + client
#   ./scripts/dev.sh --no-seed    # skip the demo seed
#   ./scripts/dev.sh --no-client  # run only Postgres + API (no Next.js)
#   ./scripts/dev.sh --db-only    # just Postgres + migrate + seed, then exit
#
# Postgres host port: DEVDIGEST_PG_PORT (env) > server/.env > 5432. 5432 is
# often taken by a local/other-project Postgres, so:
#
#   DEVDIGEST_PG_PORT=5435 ./scripts/dev.sh     # one-off
#   echo 'DEVDIGEST_PG_PORT=5435' >> server/.env  # persistent
#
# The port drives both the compose port mapping and the DATABASE_URL exported to
# migrate/seed/dev. Export DATABASE_URL yourself to point at some other database
# entirely -- an already-set DATABASE_URL is never overwritten.
#
# Web (Next.js) host port: WEB_PORT (env) > client/.env > 3000, same shape:
#
#   WEB_PORT=3002 ./scripts/dev.sh
#
# It must be exported rather than left to client/.env, because the API derives
# its CORS allow-origin (config.webOrigin = http://localhost:$WEB_PORT) from the
# same variable -- set it in one place only, or the browser gets a CORS error.
#
# Idempotent: re-running installs only what's missing, migrations and seed
# both upsert. Ctrl-C stops the dev servers and leaves Postgres running.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CONTAINER="devdigest-postgres"
RUN_SEED=1
RUN_CLIENT=1
DB_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --no-seed)   RUN_SEED=0 ;;
    --no-client) RUN_CLIENT=0 ;;
    --db-only)   DB_ONLY=1 ;;
    -h|--help)   sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

log()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }

# --- prerequisites -----------------------------------------------------------
command -v docker >/dev/null || { echo "docker not found"; exit 1; }
command -v pnpm   >/dev/null || { echo "pnpm not found (npm i -g pnpm)"; exit 1; }

# --- env files ---------------------------------------------------------------
for dir in server client; do
  if [ ! -f "$dir/.env" ] && [ -f "$dir/.env.example" ]; then
    cp "$dir/.env.example" "$dir/.env"
    warn "created $dir/.env from .env.example — add your API keys (OPENAI/ANTHROPIC/GITHUB_TOKEN) in server/.env"
  fi
done

# --- Postgres host port ------------------------------------------------------
# Precedence: exported env > server/.env > 5432. dotenv (used by migrate/seed and
# the server itself) does not override already-set env, so exporting DATABASE_URL
# here wins over server/.env without touching the file. An externally set
# DATABASE_URL wins over both and disables the port plumbing entirely.
PG_PORT="${DEVDIGEST_PG_PORT:-$(sed -n 's/^[[:space:]]*DEVDIGEST_PG_PORT[[:space:]]*=[[:space:]]*\([0-9]\{1,\}\).*/\1/p' server/.env 2>/dev/null | tail -1)}"
PG_PORT="${PG_PORT:-5432}"
export DEVDIGEST_PG_PORT="$PG_PORT"   # consumed by docker-compose.yml

if [ -n "${DATABASE_URL:-}" ]; then
  warn "DATABASE_URL is already set in the environment — using it as-is (ignoring DEVDIGEST_PG_PORT=$PG_PORT)"
else
  export DATABASE_URL="postgres://devdigest:devdigest@127.0.0.1:${PG_PORT}/devdigest"
  [ "$PG_PORT" = "5432" ] || log "Postgres host port: $PG_PORT"
fi

# --- API port (read only, for the banner and the pre-flight check) -----------
# The server reads API_PORT from its own .env via dotenv; this is just so the
# script can name the port and fail early instead of letting the API die three
# lines into a successful-looking boot.
API_PORT="${API_PORT:-$(sed -n 's/^[[:space:]]*API_PORT[[:space:]]*=[[:space:]]*\([0-9]\{1,\}\).*/\1/p' server/.env 2>/dev/null | tail -1)}"
API_PORT="${API_PORT:-3001}"

# --- web host port -----------------------------------------------------------
# Same precedence. Exported, not left to client/.env, because the API reads
# WEB_PORT too (config.webOrigin) -- one variable drives both sides, so the CORS
# origin can never drift from the port the web app actually listens on.
WEB_PORT="${WEB_PORT:-$(sed -n 's/^[[:space:]]*WEB_PORT[[:space:]]*=[[:space:]]*\([0-9]\{1,\}\).*/\1/p' client/.env 2>/dev/null | tail -1)}"
WEB_PORT="${WEB_PORT:-3000}"
export WEB_PORT
[ "$WEB_PORT" = "3000" ] || log "web host port: $WEB_PORT"

# --- Postgres ----------------------------------------------------------------
# The container name is fixed (container_name: devdigest-postgres), so if one is
# already running (possibly under another compose project) we reuse it instead
# of failing on a name conflict. If it exists but is stopped, start it; else
# create it via compose.
state="$(docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "missing")"

# An existing container has its port mapping baked in at create time; if it does
# not match what we are about to hand migrate/seed, recreate it rather than
# silently pointing DATABASE_URL at a port nothing listens on -- or, worse,
# failing to start on a conflict with the stale mapping.
#
# Read HostConfig.PortBindings, NOT NetworkSettings.Ports: the latter is empty
# for a container that is merely created/exited, which is exactly the case this
# check exists for.
if [ "$state" != "missing" ]; then
  mapped="$(docker inspect -f '{{range $p, $conf := .HostConfig.PortBindings}}{{range $conf}}{{.HostPort}}{{end}}{{end}}' "$CONTAINER" 2>/dev/null || true)"
  if [ -n "$mapped" ] && [ "$mapped" != "$PG_PORT" ]; then
    warn "$CONTAINER publishes :$mapped but this run wants :$PG_PORT — recreating it (the data volume is kept)"
    docker rm -f "$CONTAINER" >/dev/null
    state="missing"
  fi
fi

# Pre-flight the host port so a conflict fails here with a usable message rather
# than as a compose bind error.
if [ "$state" = "missing" ] && lsof -nP -iTCP:"$PG_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port $PG_PORT is already in use by something else." >&2
  echo "pick a free one: DEVDIGEST_PG_PORT=<port> ./scripts/dev.sh" >&2
  exit 1
fi

case "$state" in
  running) log "Postgres container already running — reusing it" ;;
  exited|created) log "starting existing Postgres container"; docker start "$CONTAINER" >/dev/null ;;
  *)       log "starting Postgres on :$PG_PORT (docker compose up -d)"; docker compose up -d ;;
esac

log "waiting for Postgres to be healthy"
for _ in $(seq 1 60); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo "starting")"
  [ "$status" = "healthy" ] && break
  sleep 1
done
[ "${status:-}" = "healthy" ] || { echo "Postgres did not become healthy in time"; exit 1; }
log "Postgres healthy"

# --- install deps (only if missing) ------------------------------------------
install_if_needed() {
  if [ ! -d "$1/node_modules" ]; then
    log "installing deps in $1"
    (cd "$1" && pnpm install)
  fi
}
install_if_needed server
[ "$DB_ONLY" -eq 0 ] && [ "$RUN_CLIENT" -eq 1 ] && install_if_needed client
# reviewer-core's RAW source is imported by the API at runtime (tsconfig alias);
# without its deps the API crashes at boot with ERR_MODULE_NOT_FOUND. It uses npm.
[ -d reviewer-core/node_modules ] || { log "installing deps in reviewer-core"; (cd reviewer-core && npm ci); }

# --- migrate + seed ----------------------------------------------------------
# Fail early on a busy port: migrations, seed and a full API boot are a long way
# to walk before EADDRINUSE, and when only the API loses the race the run still
# *looks* fine -- the web app comes up and every request it makes fails.
if [ "$DB_ONLY" -eq 0 ]; then
  for pf in "api:$API_PORT" "web:$WEB_PORT"; do
    what="${pf%%:*}"; port="${pf##*:}"
    [ "$what" = "web" ] && [ "$RUN_CLIENT" -eq 0 ] && continue
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 || continue
    echo "port $port is already in use — the $what cannot start there." >&2
    lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | tail -n +2 | sed 's/^/  /' >&2
    if [ "$what" = "web" ]; then
      echo "pick a free one: WEB_PORT=<port> ./scripts/dev.sh" >&2
    else
      echo "set API_PORT in server/.env, or stop whatever is holding it." >&2
    fi
    exit 1
  done
fi

log "applying migrations"
(cd server && pnpm db:migrate)

if [ "$RUN_SEED" -eq 1 ]; then
  log "seeding demo data"
  (cd server && pnpm db:seed)
fi

if [ "$DB_ONLY" -eq 1 ]; then
  log "DB ready. Postgres is running; server/client not started (--db-only)."
  exit 0
fi

# --- dev servers -------------------------------------------------------------
SERVER_PID=""
CLIENT_PID=""

# `(cd server && pnpm dev) &` gives us the PID of the SUBSHELL. Under it sit
# pnpm -> tsx -> node, and it is the node at the bottom that holds :$API_PORT.
# Signalling the subshell alone reaps the subshell and orphans that node, which
# survives the script and makes the NEXT run fail with EADDRINUSE on a port
# nothing visible is using. So walk the tree and signal children first.
kill_tree() {
  _sig="$1" _pid="$2"
  for _child in $(pgrep -P "$_pid" 2>/dev/null); do kill_tree "$_sig" "$_child"; done
  kill "-$_sig" "$_pid" 2>/dev/null || true
}

cleanup() {
  trap - EXIT INT TERM                 # never re-enter this on a second Ctrl-C
  [ -n "$SERVER_PID$CLIENT_PID" ] || exit 0
  log "shutting down dev servers (Postgres stays up; stop it with: docker compose down)"
  for _p in $CLIENT_PID $SERVER_PID; do kill_tree TERM "$_p"; done
  # Give the listeners time to close, then insist. Without the second pass a
  # still-shutting-down node can outlive the script by a second or two, which is
  # exactly long enough to break an immediate re-run.
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    _alive=""
    for _p in $CLIENT_PID $SERVER_PID; do kill -0 "$_p" 2>/dev/null && _alive=1; done
    [ -n "$_alive" ] || break
    sleep 0.3
  done
  for _p in $CLIENT_PID $SERVER_PID; do kill_tree KILL "$_p"; done
  exit 0
}
trap cleanup EXIT INT TERM

log "starting API on :$API_PORT (server)"
(cd server && pnpm dev) &
SERVER_PID=$!

if [ "$RUN_CLIENT" -eq 1 ]; then
  log "starting web on :$WEB_PORT (client) — Ctrl-C to stop both"
  (cd client && pnpm dev) &
  CLIENT_PID=$!
else
  log "API running on :$API_PORT (PID $SERVER_PID) — Ctrl-C to stop"
fi

# Watch both jobs and leave as soon as EITHER exits, so cleanup() takes the
# other one down with it. Neither `wait` form does that here:
#   * bare `wait` blocks until EVERY job exits, so a client that dies on its own
#     (a busy port, a syntax error) would hang the script with the API still up
#     -- the orphan this rewrite exists to prevent;
#   * `wait -n` would be right, but macOS ships bash 3.2, where it is an invalid
#     option; the failure is silent, falling through to the bare form above.
# The sleep runs as a background job that is waited on rather than in the
# foreground: bash defers a trap handler until the running foreground command
# returns, so a foreground `sleep 1` would sit on Ctrl-C for up to a second.
while :; do
  for _p in $SERVER_PID $CLIENT_PID; do
    kill -0 "$_p" 2>/dev/null || break 2
  done
  sleep 1 &
  wait $! 2>/dev/null || true
done
