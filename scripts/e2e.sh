#!/usr/bin/env bash
#
# DevDigest hermetic e2e — run the browser flows against a fully isolated,
# freshly-seeded stack on ALTERNATE ports, so it never touches your dev DB and
# can run alongside a dev stack that's already up.
#
#   ./scripts/e2e.sh
#   E2E_PG_PORT=5440 E2E_API_PORT=3201 E2E_WEB_PORT=3200 ./scripts/e2e.sh
#   ./scripts/e2e.sh --probe-isolation   # prove a planted key stays invisible, no flows
#
# Mirrors what .github/workflows/e2e-web.yml does, but with an ephemeral
# Postgres (no persistent volume → empty every run, so the seeded demo repo
# acme/payments-api is the ONLY repo and the home redirect lands on it).
#
# Exits with the e2e run's status. On success, failure, or Ctrl-C it tears down
# the API/web child processes AND removes the isolated Postgres container.
#
# Isolation: the API runs with an empty per-run HOME and blank provider/GitHub
# keys, and the web builds into client/.next-e2e. Before any flow, the script
# checks GET /settings/secrets-status is all false. --probe-isolation plants a
# key in a fake developer HOME and env, proves a control API sees it, then
# proves the isolated API does not. It starts neither the web nor the flows.
#
# NOTE: this is a LOCAL convenience. CI brings up its own stack and calls the
# pure runner (`cd e2e && npm test`) directly — this script is not used in CI.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# --- config (all overridable; defaults dodge the dev stack on 5432/3000/3001) ---
PG_CONTAINER="${E2E_PG_CONTAINER:-devdigest-e2e-postgres}"
PG_PORT="${E2E_PG_PORT:-5433}"
PG_IMAGE="${E2E_PG_IMAGE:-pgvector/pgvector:pg16}"
PG_DB="${E2E_PG_DB:-devdigest}"
PG_USER="${E2E_PG_USER:-devdigest}"
PG_PASS="${E2E_PG_PASS:-devdigest}"
API_PORT="${E2E_API_PORT:-3101}"
WEB_PORT="${E2E_WEB_PORT:-3100}"

# Exported BEFORE any tsx/next spawn. dotenv (used by migrate/seed/config) does
# not override already-set env, so these win over server/.env's :5432 / :3001
# without touching the file. WEB_PORT must be exported too: the API derives its
# CORS allow-origin (config.webOrigin) from it. 127.0.0.1 (not localhost) avoids
# an IPv6 ::1 vs published-IPv4 mismatch against the container.
export DATABASE_URL="postgres://${PG_USER}:${PG_PASS}@127.0.0.1:${PG_PORT}/${PG_DB}"
export API_PORT WEB_PORT
export NEXT_PUBLIC_API_BASE="http://localhost:${API_PORT}"
export E2E_BASE_URL="http://localhost:${WEB_PORT}"

PROBE_ISOLATION=0
case "${1:-}" in
  "") : ;;
  --probe-isolation) PROBE_ISOLATION=1 ;;
  *) echo "unknown argument: $1 (usage: ./scripts/e2e.sh [--probe-isolation])"; exit 2 ;;
esac

log()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }

# --- prerequisites -----------------------------------------------------------
command -v docker >/dev/null || { echo "docker not found"; exit 1; }
command -v pnpm   >/dev/null || { echo "pnpm not found (npm i -g pnpm)"; exit 1; }
command -v agent-browser >/dev/null || \
  warn "agent-browser not found — install once: npm i -g agent-browser && agent-browser install"

# --- teardown trap (installed before we create or start anything) -----------
SERVER_PID=""
WEB_PID=""
# Initialised empty so `cleanup`'s `rm -rf "$CLONE_DIR"` is a safe no-op (under
# `set -u`) if a prerequisite check above exits before CLONE_DIR is assigned.
CLONE_DIR=""
# Same idea for the per-run HOME of the API and the --probe-isolation fake home.
E2E_HOME=""
PROBE_HOME=""
# `next dev` rewrites the tracked client/next-env.d.ts to point at its distDir
# (.next-e2e). Its original bytes are saved before the web starts and put back
# here, so a run never leaves a diff in the checkout.
NEXT_ENV_SAVED=""
# Recursively kill a process and all its descendants. `pnpm exec tsx` / `next dev`
# spawn the real listener as a GRANDCHILD, so a plain `kill $PID` + `pkill -P`
# leaves it orphaned (port stays bound). Walk the tree leaves-first instead.
kill_tree() {
  local pid="$1"
  [ -n "$pid" ] || return 0
  local kid
  for kid in $(pgrep -P "$pid" 2>/dev/null || true); do kill_tree "$kid"; done
  kill "$pid" 2>/dev/null || true
}
cleanup() {
  local code=$?
  log "tearing down hermetic e2e stack"
  kill_tree "$WEB_PID"
  kill_tree "$SERVER_PID"
  [ -n "$NEXT_ENV_SAVED" ] && cp "$NEXT_ENV_SAVED" client/next-env.d.ts 2>/dev/null || true
  # Backstop: reap whatever still holds the ISOLATED ports (never the dev stack's
  # 3000/3001 — only the alt ports this script started).
  for port in "$WEB_PORT" "$API_PORT"; do
    local pids
    pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
    [ -n "$pids" ] && kill $pids 2>/dev/null || true
  done
  docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$CLONE_DIR" "$E2E_HOME" "$PROBE_HOME" "$NEXT_ENV_SAVED" 2>/dev/null || true
  exit "$code"
}
trap cleanup EXIT INT TERM

# A fresh temp dir per run, created AFTER the trap (so an early exit never
# leaks it) and BEFORE the seed, so `db:seed`'s D10 demo checkout
# (server/src/db/seed-project-context.ts) writes its fixtures into an
# isolated tree instead of the developer's real DEVDIGEST_CLONE_DIR (default
# ~/.devdigest/workspace, or server/.env's ./clones). Removed on teardown.
# NOTE: this does NOT relax seed-project-context.ts's "write only when the
# demo folder is absent" idempotency rule (D10) — a fresh, never-before-seen
# dir just means that check always finds the folder absent and always writes,
# which is the point: every hermetic run gets its own fixtures.
CLONE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/devdigest-e2e-clone.XXXXXX")"
export DEVDIGEST_CLONE_DIR="$CLONE_DIR"

# Per-run empty HOME for the API process ONLY, so os.homedir() and with it
# config.secretsPath (~/.devdigest/secrets.json) point at an empty dir and the
# developer's saved keys are never read. pnpm, docker and agent-browser keep the
# real HOME (the API launches through ./node_modules/.bin/tsx, not pnpm, for the
# same reason). Created after the trap, removed in cleanup.
E2E_HOME="$(mktemp -d "${TMPDIR:-/tmp}/devdigest-e2e-home.XXXXXX")"
mkdir -p "$E2E_HOME/.devdigest"

# Every API launch uses this array. The provider and GitHub keys are set EMPTY,
# not unset: dotenv never overrides a variable that is already set, so an empty
# value stops server/.env from filling it, and the container treats an empty key
# as absent. NODE_ENV=test switches off ONLY the global 120 req/min per-IP rate
# limit (server/src/app.ts): the whole suite drives one browser from one IP and
# crosses that budget within a minute (flow 13's results page rendered "Couldn't
# load this run"). LOG_LEVEL=info keeps the request log test mode would silence.
API_ENV=(
  "HOME=$E2E_HOME"
  "OPENAI_API_KEY="
  "ANTHROPIC_API_KEY="
  "OPENROUTER_API_KEY="
  "GITHUB_TOKEN="
  "GITHUB_PAT="
  "NODE_ENV=test"
  "LOG_LEVEL=info"
)

# wait_api_healthy: block until /health answers, or fail if the API process died.
wait_api_healthy() {
  local up=0
  for _ in $(seq 1 60); do
    curl -fsS "http://localhost:${API_PORT}/health" >/dev/null 2>&1 && { up=1; break; }
    kill -0 "$SERVER_PID" 2>/dev/null || { echo "API process exited before becoming healthy"; exit 1; }
    sleep 1
  done
  [ "$up" -eq 1 ] || { echo "API never became healthy on :$API_PORT"; exit 1; }
}

# stop_api: stop the API we started and wait until it is gone (frees the port).
stop_api() {
  kill_tree "$SERVER_PID"
  wait "$SERVER_PID" 2>/dev/null || true
  SERVER_PID=""
}

secrets_status() { curl -fsS "http://localhost:${API_PORT}/settings/secrets-status"; }

# --- fresh isolated Postgres (ephemeral: --rm, no named volume) --------------
log "starting isolated Postgres '$PG_CONTAINER' on :$PG_PORT (ephemeral)"
docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
docker run -d --rm --name "$PG_CONTAINER" \
  -e POSTGRES_USER="$PG_USER" \
  -e POSTGRES_PASSWORD="$PG_PASS" \
  -e POSTGRES_DB="$PG_DB" \
  -p "${PG_PORT}:5432" \
  --health-cmd="pg_isready -U $PG_USER -d $PG_DB" \
  --health-interval=5s --health-timeout=5s --health-retries=10 \
  "$PG_IMAGE" >/dev/null

log "waiting for Postgres to be healthy"
status="starting"
for _ in $(seq 1 60); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$PG_CONTAINER" 2>/dev/null || echo "starting")"
  [ "$status" = "healthy" ] && break
  sleep 1
done
[ "$status" = "healthy" ] || { echo "isolated Postgres did not become healthy in time"; exit 1; }
log "Postgres healthy"

# --- install deps (only if missing) ------------------------------------------
install_if_needed() {
  if [ ! -d "$1/node_modules" ]; then
    log "installing deps in $1"
    (cd "$1" && pnpm install)
  fi
}
install_if_needed server
install_if_needed client
# reviewer-core's RAW source is imported by the API at runtime (tsconfig alias);
# without its deps the API crashes at boot with ERR_MODULE_NOT_FOUND. It uses npm.
[ -d reviewer-core/node_modules ] || { log "installing deps in reviewer-core"; (cd reviewer-core && npm ci); }

# --- migrate + seed the ISOLATED db ------------------------------------------
# Hard guard: never let migrate/seed run against anything but the isolated port.
case "$DATABASE_URL" in
  *":${PG_PORT}/"*) : ;;
  *) echo "refusing: DATABASE_URL is not on :$PG_PORT ($DATABASE_URL)"; exit 1 ;;
esac
log "applying migrations (isolated db)"
(cd server && pnpm db:migrate)
log "seeding demo data (isolated db)"
(cd server && pnpm db:seed)

# --- --probe-isolation: prove the isolation holds against a planted key -----
if [ "$PROBE_ISOLATION" -eq 1 ]; then
  PROBE_HOME="$(mktemp -d "${TMPDIR:-/tmp}/devdigest-e2e-probe.XXXXXX")"
  mkdir -p "$PROBE_HOME/.devdigest"
  ( umask 077; printf '{"OPENAI_API_KEY":"sk-e2e-probe"}\n' > "$PROBE_HOME/.devdigest/secrets.json" )
  chmod 600 "$PROBE_HOME/.devdigest/secrets.json"

  log "probe 1/2: control API with the planted key must SEE it"
  (cd server && exec env "HOME=$PROBE_HOME" "OPENAI_API_KEY=sk-e2e-probe" \
    NODE_ENV=test LOG_LEVEL=info ./node_modules/.bin/tsx src/server.ts) &
  SERVER_PID=$!
  wait_api_healthy
  control="$(secrets_status)"
  stop_api
  case "$control" in
    *'"openai":true'*) : ;;
    *) echo "probe broken: the control API did not see the planted key ($control)"; exit 1 ;;
  esac

  log "probe 2/2: isolated API, same parent environment, must see NO key"
  (cd server && HOME="$PROBE_HOME" OPENAI_API_KEY=sk-e2e-probe \
    exec env "${API_ENV[@]}" ./node_modules/.bin/tsx src/server.ts) &
  SERVER_PID=$!
  wait_api_healthy
  isolated="$(secrets_status)"
  stop_api
  case "$isolated" in
    *true*) echo "e2e isolation broken: the API sees a configured key ($isolated)"; exit 1 ;;
  esac
  log "isolation probe passed: the planted key stays invisible"
  exit 0
fi

# --- API on :$API_PORT -------------------------------------------------------
# tsx directly (not `pnpm start`, which needs a build; not `tsx watch`, to avoid
# a mid-suite watcher restart), through env "${API_ENV[@]}" (see above).
log "starting API on :$API_PORT"
(cd server && exec env "${API_ENV[@]}" ./node_modules/.bin/tsx src/server.ts) &
SERVER_PID=$!
log "waiting for API /health"
wait_api_healthy
log "API healthy"

# Hard check before any flow: the API must see no configured key (flow 13 starts
# real runs and is only model-free on a keyless API).
log "checking the API sees no configured key"
status_body="$(secrets_status)"
case "$status_body" in
  *true*) echo "e2e isolation broken: the API sees a configured key ($status_body)"; exit 1 ;;
esac

# --- web on :$WEB_PORT (next dev → reads NEXT_PUBLIC_API_BASE from env) -------
# DEVDIGEST_NEXT_DIST_DIR (read by client/next.config.mjs) gives this web its own
# client/.next-e2e, so a `pnpm --dir client dev` running from the same checkout
# keeps client/.next and the two never clobber each other.
log "starting web on :$WEB_PORT"
NEXT_ENV_SAVED="$(mktemp -t devdigest-e2e-next-env.XXXXXX)"
cp client/next-env.d.ts "$NEXT_ENV_SAVED"
(cd client && DEVDIGEST_NEXT_DIST_DIR=.next-e2e pnpm exec next dev -p "$WEB_PORT") &
WEB_PID=$!
log "waiting for web :$WEB_PORT"
web_up=0
for _ in $(seq 1 60); do
  curl -fsS "http://localhost:${WEB_PORT}" >/dev/null 2>&1 && { web_up=1; break; }
  kill -0 "$WEB_PID" 2>/dev/null || { echo "web process exited before becoming reachable"; exit 1; }
  sleep 1
done
[ "$web_up" -eq 1 ] || { echo "web never became reachable on :$WEB_PORT"; exit 1; }
log "web up"

# --- run the flows; propagate the exit code through the trap -----------------
log "running e2e flows against $E2E_BASE_URL"
set +e
(cd e2e && npm test)
E2E_CODE=$?
set -e
exit "$E2E_CODE"
