#!/usr/bin/env bash
# One run of the package checks for a feature, recorded once and reused by every later
# reader (plan-verifier, architecture-reviewer, /pr-self-review) while the tree is unchanged.
#
#   .claude/scripts/checks.sh run <feature> [--quick] [--force] <pkg>...
#   .claude/scripts/checks.sh status <feature>       # fresh | stale | missing  (exit 0 only when fresh)
#   .claude/scripts/checks.sh fingerprint
#
# run     typecheck · lint · (server) arch · unit tests · (server, full mode) *.it.test.ts —
#         every command's full log goes to .harness/checks/<feature>.logs/, the record to
#         .harness/checks/<feature>.md, and stdout gets one line per command plus the failure
#         excerpt of the first failing command. Nothing else reaches the agent's context.
#         --quick skips *.it.test.ts (the implementer's mode); the main-session gate runs full.
#         A record that is fresh, passing and at least as complete as asked is reused, not re-run
#         (--force re-runs anyway).
# The fingerprint is HEAD plus every tracked and untracked change outside *.md and .harness/,
# so INSIGHTS, docs and plans edited after the run do not make it stale.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel)" || exit 2
cd "$ROOT" || exit 2
DIR=.harness/checks

fingerprint() {
  {
    git rev-parse HEAD
    git diff HEAD --binary -- . ':(exclude)*.md' ':(exclude).harness'
    git ls-files --others --exclude-standard -z -- . ':(exclude)*.md' ':(exclude).harness' |
      xargs -0 -I{} sh -c 'printf "%s " "$1"; git hash-object "$1"' _ {}
  } | shasum -a 256 | cut -c1-16
}

field() { sed -n "s/^\*\*$2:\*\* //p" "$1" | head -1; }

status() {
  local rec="$DIR/$1.md"
  [ -f "$rec" ] || { echo missing; return 1; }
  if [ "$(field "$rec" Fingerprint)" = "$(fingerprint)" ]; then echo fresh; return 0; fi
  echo stale; return 1
}

# Print the useful part of a failing log: vitest's failure section, else the last 40 lines.
excerpt() {
  local plain; plain="$(sed 's/\x1b\[[0-9;]*m//g' "$1")"
  if grep -q 'Failed Tests' <<<"$plain"; then
    sed -n '/Failed Tests/,/Test Files/p' <<<"$plain" | head -60
  else
    tail -n 40 <<<"$plain"
  fi
}

run() {
  local feature="" quick=0 force=0 pkgs=()
  for a in "$@"; do
    case "$a" in
      --quick) quick=1 ;;
      --force) force=1 ;;
      *) if [ -z "$feature" ]; then feature="$a"; else pkgs+=("$a"); fi ;;
    esac
  done
  [ -n "$feature" ] && [ ${#pkgs[@]} -gt 0 ] || { echo "usage: checks.sh run <feature> [--quick] [--force] <pkg>..." >&2; exit 2; }

  local rec="$DIR/$feature.md" logs="$DIR/$feature.logs" mode=full
  [ $quick = 1 ] && mode=quick
  if [ $force = 0 ] && status "$feature" >/dev/null; then
    local had; had="$(field "$rec" Mode)"
    if [ "$(field "$rec" Result)" = pass ] && { [ "$had" = full ] || [ $mode = quick ]; } &&
       [ "$(field "$rec" Packages)" = "${pkgs[*]}" ]; then
      echo "reused: $rec is fresh (fingerprint $(field "$rec" Fingerprint), mode $had) — not re-run"
      return 0
    fi
  fi

  mkdir -p "$logs"
  local fp; fp="$(fingerprint)"
  local rows=() failed=0 first_fail=""
  local docker=0
  docker info >/dev/null 2>&1 && docker=1

  for p in "${pkgs[@]}"; do
    [ -f "$p/package.json" ] || { echo "unknown package: $p" >&2; exit 2; }
    local cmds=("typecheck|pnpm --dir $p typecheck" "lint|pnpm --dir $p lint")
    case "$p" in
      server)
        cmds+=("arch|pnpm --dir server arch"
               "unit|pnpm --dir server exec vitest run --exclude **/*.it.test.ts")
        if [ $mode = full ]; then
          if [ $docker = 1 ]; then cmds+=("it|pnpm --dir server exec vitest run .it.test")
          else rows+=("| \`pnpm --dir server exec vitest run .it.test\` | skipped | Docker not available |"); fi
        fi ;;
      client|reviewer-core|mcp-server) cmds+=("unit|pnpm --dir $p test") ;;
      e2e) ;; # flows need a running stack: manual acceptance, never here
    esac
    for c in "${cmds[@]}"; do
      local name="${c%%|*}" cmd="${c#*|}" log="$logs/$p-${c%%|*}.log"
      local t0=$SECONDS
      # Run without a shell so the --exclude glob reaches vitest unexpanded.
      read -r -a argv <<<"$cmd"
      CI=1 "${argv[@]}" >"$log" 2>&1
      local rc=$? secs=$((SECONDS - t0))
      local result=pass
      [ $rc -ne 0 ] && { result=fail; failed=1; [ -z "$first_fail" ] && first_fail="$log"; }
      local summary
      # Strip ANSI colour codes; keep vitest's "Tests N passed" line or depcruise's counts.
      summary="$(sed 's/\x1b\[[0-9;]*m//g' "$log" |
        grep -E '^ +Tests +[0-9]|dependency violations|no dependency violations' | tail -1 | sed 's/^ *//')"
      rows+=("| \`$cmd\` | $result (exit $rc, ${secs}s) | ${summary:-—} |")
      printf '%-4s %-55s %ss %s\n' "$result" "$cmd" "$secs" "$summary"
    done
  done

  local verdict=pass; [ $failed = 1 ] && verdict=fail
  {
    echo "# Checks: $feature"
    echo
    echo "**Fingerprint:** $fp"
    echo "**HEAD:** $(git rev-parse --short HEAD)"
    echo "**Mode:** $mode"
    echo "**Packages:** ${pkgs[*]}"
    echo "**Result:** $verdict"
    echo "**Ran at:** $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo
    echo "| Command | Result | Summary |"
    echo "|---------|--------|---------|"
    printf '%s\n' "${rows[@]}"
    echo
    echo "Logs: \`$logs/\`. Reuse this record only while \`.claude/scripts/checks.sh status $feature\` prints \`fresh\`."
  } >"$rec"

  echo "record: $rec ($verdict, fingerprint $fp)"
  if [ -n "$first_fail" ]; then
    echo "--- first failure: $first_fail"
    excerpt "$first_fail"
    return 1
  fi
}

case "${1:-}" in
  run) shift; run "$@" ;;
  status) [ -n "${2:-}" ] || { echo "usage: checks.sh status <feature>" >&2; exit 2; }; status "$2" ;;
  fingerprint) fingerprint ;;
  *) echo "usage: checks.sh run|status|fingerprint …" >&2; exit 2 ;;
esac
