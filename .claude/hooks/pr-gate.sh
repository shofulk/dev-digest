#!/usr/bin/env bash
# pr-gate.sh — the enforcement half of the `pr-self-review` skill.
#
# Modes:
#   state-path            print the state-file path for the current branch+worktree
#   check                 Claude Code PreToolUse hook: reads the hook JSON on stdin,
#                         blocks a PR-opening/merging gh command unless a fresh pass exists
#   gate                  same decision, no stdin — used by .git/hooks/pre-push
#   status                human-readable one-liner about the current verdict
#   self-test             run the matcher case matrix (exit 0 = every case correct)
#
# FAIL-OPEN BY DESIGN (plan §13.1): a broken gate that blocks every gh command is worse
# than a missed review — it gets deleted, and then there is no gate at all. Any internal
# error here exits 0 with a warning. Only a *known* bad verdict exits 2.
#
# The command matcher lives in node, not in a grep. A line-oriented regex over the raw
# command cannot tell a real invocation from a mention of one inside `echo`, and every
# separator (`;` `&` `|` parens), a path prefix, a quoted flag value and a backslash
# continuation each defeated the regex this replaces — 9 of 12 cases wrong, which is why
# `self-test` exists and why it ships with the hook.
set -uo pipefail

warn() { printf 'pr-gate: %s\n' "$*" >&2; }
allow() { exit 0; }
block() { printf '%s\n' "$1" >&2; exit 2; }

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { warn "not a git repo — allowing"; allow; }
cd "$ROOT" || allow

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || allow
HEAD_SHA=$(git rev-parse HEAD 2>/dev/null) || allow
# Worktree discriminator: the same branch can be checked out in two worktrees.
WT=$(printf '%s' "$PWD" | shasum | cut -c1-7)
# The branch name is HASHED, not flattened: `feat/x` and `feat-x` flatten to one key, and a
# detached HEAD has no name at all, so two branches could share a state file and pass on
# each other's verdict whenever they sit on the same commit.
BRANCH_KEY=$(printf '%s' "$BRANCH" | shasum | cut -c1-7)
SAFE_BRANCH=$(printf '%s' "${BRANCH//\//-}" | tr -cd 'A-Za-z0-9._-' | cut -c1-40)
STATE="$ROOT/.pr-review/${SAFE_BRANCH:-detached}-${BRANCH_KEY}--${WT}.json"

state_path() { mkdir -p "$ROOT/.pr-review" 2>/dev/null; printf '%s\n' "$STATE"; }

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
Run the pr-self-review skill first. It reviews the local change set against this repo's
skills and writes $rel. Nothing else will unblock this command." ;;
    unreadable)
      warn "state file $rel is unreadable — allowing (fail-open)"; allow ;;
    pass|override)
      if [ "$head" != "$HEAD_SHA" ]; then
        block "BLOCKED by pr-self-review: the last review was for commit ${head:0:8}, HEAD is now ${HEAD_SHA:0:8}.
Commits landed after the review. Re-run the pr-self-review skill."
      fi
      # A pass carrying criticals is a corrupt or hand-edited verdict, never a real one.
      if [ "$verdict" = "pass" ] && [ "$crit" != "0" ]; then
        block "BLOCKED by pr-self-review: $rel says verdict=pass with critical=$crit.
That state is self-contradictory — re-run the review rather than trusting it."
      fi
      [ "$verdict" = "override" ] && warn "passing on a recorded override — see $rel"
      allow ;;
    blocked)
      block "BLOCKED by pr-self-review: $crit critical finding(s) on this branch.
${msg:-See the report.} Report: ${rel%.json}.md
Fix them, re-run with --fix, or record an explicit exception with --override \"<reason>\".
Do not open or merge this PR until it passes." ;;
    inconclusive)
      block "BLOCKED by pr-self-review: the review could not complete, so nothing is known about this branch.
${msg:-A check could not run.} Report: ${rel%.json}.md
This is not a finding about your code — make the check runnable and re-run the review." ;;
    *)
      warn "unknown verdict '$verdict' in $rel — allowing (fail-open)"; allow ;;
  esac
}

# Reads a command string on stdin; exits 0 when it really invokes the gated subcommands.
matches_pr_command() {
  node -e '
    const VERBS = ["create", "merge", "ready"];
    const TOOL = "g" + "h";
    let b = "";
    process.stdin.on("data", d => (b += d)).on("end", () => process.exit(hit(b) ? 0 : 1));

    function hit(cmd) {
      let s = stripHeredocs(String(cmd));
      s = s.replace(/\\\r?\n/g, " ").replace(/\r?\n/g, ";");
      for (const seg of segments(s)) if (isGated(seg)) return true;
      return false;
    }

    // A heredoc body is data, not a command: `cat <<EOF ... EOF` carries text, not calls.
    function stripHeredocs(s) {
      return s.replace(/<<-?\s*(["\x27]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^\s*\2\s*$/gm, " ");
    }

    // Split on the separators that open a new command position, honouring quotes.
    function segments(s) {
      const out = []; let cur = "", q = null;
      for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (q) { cur += c; if (c === q) q = null; continue; }
        if (c === "\x27" || c === "\"") { q = c; cur += c; continue; }
        if (c === "#" && (cur === "" || /\s$/.test(cur))) {        // comment runs to end of segment
          while (i < s.length && s[i] !== ";" && s[i] !== "\n") i++;
          continue;
        }
        if (";&|(){}".includes(c)) { out.push(cur); cur = ""; continue; }
        cur += c;
      }
      out.push(cur);
      return out;
    }

    function tokens(seg) {
      const out = []; let cur = "", q = null, quoted = false;
      for (const c of seg) {
        if (q) { if (c === q) q = null; else cur += c; continue; }
        if (c === "\x27" || c === "\"") { q = c; quoted = true; continue; }
        if (/\s/.test(c)) { if (cur || quoted) { out.push({ v: cur, quoted }); cur = ""; quoted = false; } continue; }
        cur += c;
      }
      if (cur || quoted) out.push({ v: cur, quoted });
      return out;
    }

    function isGated(seg) {
      const t = tokens(seg);
      // drop leading env assignments and privilege/prefix wrappers
      while (t.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0].v) ||
             ["sudo", "command", "env", "nice", "time"].includes(t[0].v))) t.shift();
      if (!t.length) return false;
      const head = t[0].v.replace(/^.*\//, "");                    // strip a path prefix
      // a shell invoker runs its argument as a command — recurse into it once
      if (["bash", "sh", "zsh", "dash", "eval"].includes(head)) {
        return t.slice(1).some(a => !a.v.startsWith("-") && hit(a.v));
      }
      if (head !== TOOL) return false;
      const rest = t.slice(1).filter(a => !a.v.startsWith("-"));   // flags dropped
      const i = rest.findIndex(a => a.v === "p" + "r");
      return i !== -1 && VERBS.includes(rest[i + 1]?.v ?? "");
    }
  '
}

self_test() {
  local g p c m fails=0
  g='g'"h"; p='p'"r"; c='cre'"ate"; m='me'"rge"
  run() {                       # name, command, expected (0 = gated, 1 = not gated)
    local got; printf '%s' "$2" | matches_pr_command; got=$?
    if [ "$got" = "$3" ]; then printf 'ok    %s\n' "$1"
    else printf 'FAIL  %s (want=%s got=%s)\n' "$1" "$3" "$got"; fails=$((fails + 1)); fi
  }
  run "plain"              "$g $p $c"                    0
  run "trailing semicolon" "$g $p $c; echo done"         0
  run "trailing ampersand" "$g $p $c&"                   0
  run "subshell"           "($g $p $c)"                  0
  run "shell invoker"      "bash -c \"$g $p $c\""        0
  run "absolute path"      "/opt/homebrew/bin/$g $p $c"  0
  run "quoted flag value"  "$g --repo \"o/r\" $p $c"     0
  run "line continuation"  "$g $p \\
  $c"                                                    0
  run "merge subcommand"   "$g $p $m 5 --squash"         0
  run "env prefix"         "PAGER= $g $p $c"             0
  run "after a push"       "git push && $g $p $c"        0
  run "echo mention"       "echo \"run $g $p $c later\"" 1
  run "comment mention"    "# $g $p $c"                  1
  run "heredoc body"       "cat <<'EOF'
$g $p $c
EOF"                                                     1
  run "unrelated command"  "git status"                  1
  run "other subcommand"   "$g issue list"               1
  run "non-gated verb"     "$g $p list"                  1
  printf '\n%s failing case(s)\n' "$fails"
  [ "$fails" = 0 ]
}

case "${1:-check}" in
  state-path) state_path ;;
  gate)       decide ;;
  self-test)  self_test ;;
  status)
    raw=$(read_state)
    printf 'branch=%s head=%s state=%s verdict=%s\n' \
      "$BRANCH" "${HEAD_SHA:0:8}" "${STATE#"$ROOT"/}" "${raw%%|*}" ;;
  check)
    RAW=$(cat) || allow
    # Cheap bail-out: this hook runs before EVERY Bash call, so skip the node start when the
    # payload cannot possibly be one of these commands. Correctness never lives in the fast
    # path — the needle is a bare literal with no character class a quote could defeat.
    printf '%s' "$RAW" | grep -Fq 'gh' || allow
    CMD=$(printf '%s' "$RAW" | node -e '
      let b = "";
      process.stdin.on("data", d => b += d).on("end", () => {
        try { const j = JSON.parse(b); process.stdout.write(String(j?.tool_input?.command ?? "")); }
        catch { process.stdout.write(""); }
      });
    ' 2>/dev/null) || allow
    printf '%s' "$CMD" | matches_pr_command || allow
    decide ;;
  *) warn "unknown mode '${1:-}' — allowing"; allow ;;
esac
