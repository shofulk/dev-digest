#!/usr/bin/env bash
# pr-gate.sh — the enforcement half of the `pr-self-review` skill.
#
# Modes:
#   state-path            print the state-file path for the current branch+worktree
#   check                 Claude Code PreToolUse hook: reads the hook JSON on stdin,
#                         blocks `gh pr create|merge|ready` unless a fresh pass exists
#   gate                  same decision, no stdin — used by .git/hooks/pre-push
#   status                human-readable one-liner about the current verdict
#
# FAIL-OPEN BY DESIGN (plan §13.1): a broken gate that blocks every `gh` command is worse
# than a missed review — it gets deleted, and then there is no gate at all. Any internal
# error here exits 0 with a warning. Only a *known* bad verdict exits 2.
set -uo pipefail

warn() { printf 'pr-gate: %s\n' "$*" >&2; }
allow() { exit 0; }
block() { printf '%s\n' "$1" >&2; exit 2; }

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { warn "not a git repo — allowing"; allow; }
cd "$ROOT" || allow

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || allow
HEAD_SHA=$(git rev-parse HEAD 2>/dev/null) || allow
# worktree discriminator: the same branch can be checked out in two worktrees (plan §13.7)
WT=$(printf '%s' "$PWD" | shasum | cut -c1-7)
SAFE_BRANCH=${BRANCH//\//-}
STATE="$ROOT/.pr-review/${SAFE_BRANCH}--${WT}.json"

state_path() { printf '%s\n' "$STATE"; }

# Prints: <verdict>|<head>|<criticals>|<message>
read_state() {
  [ -f "$STATE" ] || { printf 'missing|||\n'; return; }
  node -e '
    const fs = require("fs");
    try {
      const s = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const v = String(s.verdict ?? "missing");
      process.stdout.write([v, s.head ?? "", s.critical ?? "?", s.message ?? ""].join("|"));
    } catch { process.stdout.write("unreadable|||"); }
  ' "$STATE" 2>/dev/null || printf 'unreadable|||\n'
}

decide() {
  local raw verdict head crit msg rel
  raw=$(read_state)
  verdict=${raw%%|*}; raw=${raw#*|}
  head=${raw%%|*};    raw=${raw#*|}
  crit=${raw%%|*};    msg=${raw#*|}
  rel=${STATE#"$ROOT"/}

  case "$verdict" in
    missing)
      block "BLOCKED by pr-self-review: this branch has not been self-reviewed.
Run /pr-self-review first. It reviews the local change set against this repo's skills and
writes $rel. Nothing else will unblock this command." ;;
    unreadable)
      warn "state file $rel is unreadable — allowing (fail-open)"; allow ;;
    pass|override)
      if [ "$head" != "$HEAD_SHA" ]; then
        block "BLOCKED by pr-self-review: the last review was for commit ${head:0:8}, HEAD is now ${HEAD_SHA:0:8}.
Commits landed after the review. Run /pr-self-review again."
      fi
      [ "$verdict" = "override" ] && warn "passing on a recorded override — see $rel"
      allow ;;
    blocked)
      block "BLOCKED by pr-self-review: $crit critical finding(s) on this branch.
${msg:-See the report.} Report: ${rel%.json}.md
Fix them, or re-run with /pr-self-review --fix, or record an explicit exception with
/pr-self-review --override \"<reason>\". Do not open or merge this PR until it passes." ;;
    inconclusive)
      block "BLOCKED by pr-self-review: the review could not complete, so nothing is known about this branch.
${msg:-A check could not run.} Report: ${rel%.json}.md
This is not a finding about your code — make the check runnable and re-run /pr-self-review." ;;
    *)
      warn "unknown verdict '$verdict' in $rel — allowing (fail-open)"; allow ;;
  esac
}

case "${1:-check}" in
  state-path) state_path ;;
  gate)       decide ;;
  status)
    raw=$(read_state)
    printf 'branch=%s head=%s state=%s verdict=%s\n' \
      "$BRANCH" "${HEAD_SHA:0:8}" "${STATE#"$ROOT"/}" "${raw%%|*}" ;;
  check)
    RAW=$(cat) || allow
    # cheap bail-out first: most Bash calls have nothing to do with PRs, and this hook
    # runs on every one of them — do not pay for a node start unless the text looks relevant
    printf '%s' "$RAW" | grep -Eq 'gh[^"]*pr[^"]*(create|merge|ready)' || allow
    CMD=$(printf '%s' "$RAW" | node -e '
      let b = "";
      process.stdin.on("data", d => b += d).on("end", () => {
        try { const j = JSON.parse(b); process.stdout.write(String(j?.tool_input?.command ?? "")); }
        catch { process.stdout.write(""); }
      });
    ' 2>/dev/null) || allow
    # only PR-opening / merging commands are gated; everything else passes untouched
    printf '%s' "$CMD" | grep -Eq '(^|[;&|[:space:]])gh([[:space:]]+[^;&|]*)?[[:space:]]+pr[[:space:]]+(create|merge|ready)([[:space:]]|$)' || allow
    decide ;;
  *) warn "unknown mode '${1:-}' — allowing"; allow ;;
esac
