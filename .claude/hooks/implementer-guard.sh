#!/usr/bin/env bash
# implementer-guard.sh — PreToolUse(Bash) hook scoped to the `implementer` subagent
# (wired from the `hooks:` block of .claude/agents/implementer.md, not from settings.json).
#
# The implementer writes code and runs checks; committing, pushing, touching pull requests
# and migrating the dev database belong to the main session and the user. Blocked:
#   git commit | git push          — history is the user's call, after review
#   gh pr <any verb>               — PRs go through /pr-self-review, not the implementer
#   pnpm|npm|yarn … db:migrate     — the server never migrates on its own (AGENTS.md)
#   tsx src/db/migrate.ts          — the same, bypassing the script name
#   drizzle-kit migrate | push     — the same, bypassing the script entirely
#
# Modes:
#   check      hook mode: reads the hook JSON on stdin, exits 2 on a blocked command
#   self-test  run the matcher case matrix (exit 0 = every case correct)
#
# FAIL-OPEN BY DESIGN, like pr-gate.sh: a broken guard that blocks every Bash call makes
# the implementer useless and gets deleted. Any internal error exits 0 with a warning.
# The tokenizer is the one pr-gate.sh uses, for the same reason: a regex over the raw
# command cannot tell a real invocation from a mention inside `echo` or a heredoc.
set -uo pipefail

warn() { printf 'implementer-guard: %s\n' "$*" >&2; }
allow() { exit 0; }

# Reads a command string on stdin; prints the rule it breaks and exits 0, or exits 1.
blocked_rule() {
  node -e '
    let b = "";
    process.stdin.on("data", d => (b += d)).on("end", () => {
      const r = hit(b);
      if (r) { process.stdout.write(r); process.exit(0); }
      process.exit(1);
    });

    function hit(cmd) {
      let s = stripHeredocs(String(cmd));
      s = s.replace(/\\\r?\n/g, " ").replace(/\r?\n/g, ";");
      for (const seg of segments(s)) { const r = rule(seg); if (r) return r; }
      return null;
    }

    function stripHeredocs(s) {
      return s.replace(/<<-?\s*(["\x27]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^\s*\2\s*$/gm, " ");
    }

    function segments(s) {
      const out = []; let cur = "", q = null;
      for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (q) { cur += c; if (c === q) q = null; continue; }
        if (c === "\x27" || c === "\"") { q = c; cur += c; continue; }
        if (c === "#" && (cur === "" || /\s$/.test(cur))) {
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

    // Flags that take a value, so the value is not mistaken for the subcommand.
    const VALUE_FLAGS = { git: ["-C", "-c", "--git-dir", "--work-tree"], pnpm: ["--dir", "-C", "--filter", "-F"] };

    function positional(t, tool) {
      const takes = VALUE_FLAGS[tool] ?? [];
      const out = [];
      for (let i = 0; i < t.length; i++) {
        const v = t[i].v;
        if (takes.includes(v)) { i++; continue; }
        if (v.startsWith("-")) continue;
        out.push(v);
      }
      return out;
    }

    function rule(seg) {
      const t = tokens(seg);
      while (t.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0].v) ||
             ["sudo", "command", "env", "nice", "time"].includes(t[0].v))) t.shift();
      if (!t.length) return null;
      const head = t[0].v.replace(/^.*\//, "");
      if (["bash", "sh", "zsh", "dash", "eval"].includes(head)) {
        for (const a of t.slice(1)) if (!a.v.startsWith("-")) { const r = hit(a.v); if (r) return r; }
        return null;
      }
      const rest = positional(t.slice(1), head);
      if (head === "git" && ["commit", "push"].includes(rest[0])) return "git " + rest[0];
      if (head === "gh" && rest[0] === "pr") return "gh pr";
      if (["pnpm", "npm", "yarn"].includes(head) && rest.includes("db:migrate")) return "db:migrate";
      if (["tsx", "node", "npx"].includes(head) && rest.some(a => /(^|\/)db\/migrate\.ts$/.test(a))) return "db:migrate";
      const dk = rest.indexOf("drizzle-kit");
      if (head === "drizzle-kit" && ["migrate", "push"].includes(rest[0])) return "drizzle-kit " + rest[0];
      if (dk !== -1 && ["migrate", "push"].includes(rest[dk + 1])) return "drizzle-kit " + rest[dk + 1];
      return null;
    }
  '
}

self_test() {
  local fails=0
  run() {                       # name, command, expected (0 = blocked, 1 = allowed)
    local got; printf '%s' "$2" | blocked_rule >/dev/null; got=$?
    if [ "$got" = "$3" ]; then printf 'ok    %s\n' "$1"
    else printf 'FAIL  %s (want=%s got=%s)\n' "$1" "$3" "$got"; fails=$((fails + 1)); fi
  }
  run "git commit"             "git commit -m wip"                         0
  run "git push"               "git push origin HEAD"                      0
  run "git -C commit"          "git -C server commit -am x"                0
  run "chained commit"         "pnpm --dir server test && git commit -m x" 0
  run "gh pr create"           "gh pr create --fill"                       0
  run "gh pr view"             "gh pr view 7"                              0
  run "pnpm db:migrate"        "pnpm --dir server db:migrate"              0
  run "pnpm run db:migrate"    "pnpm run db:migrate"                       0
  run "tsx migrate"            "cd server && tsx src/db/migrate.ts"        0
  run "drizzle-kit push"       "pnpm exec drizzle-kit push"                0
  run "shell invoker"          "bash -c \"git push\""                      0
  run "git status"             "git status"                                1
  run "git diff"               "git diff --stat"                           1
  run "git log commit word"    "git log --grep commit"                     1
  run "db:generate"            "pnpm --dir server db:generate"             1
  run "server tests"           "pnpm --dir server test"                    1
  run "echo mention"           "echo \"then git push\""                    1
  run "comment mention"        "# git commit later"                        1
  run "heredoc body"           "cat <<'EOF'
git push
EOF"                                                                       1
  run "gh issue"               "gh issue list"                             1
  printf '\n%s failing case(s)\n' "$fails"
  [ "$fails" = 0 ]
}

case "${1:-check}" in
  self-test) self_test ;;
  check)
    RAW=$(cat) || allow
    CMD=$(printf '%s' "$RAW" | node -e '
      let b = "";
      process.stdin.on("data", d => b += d).on("end", () => {
        try { const j = JSON.parse(b); process.stdout.write(String(j?.tool_input?.command ?? "")); }
        catch { process.stdout.write(""); }
      });
    ' 2>/dev/null) || { warn "could not parse hook input — allowing (fail-open)"; allow; }
    RULE=$(printf '%s' "$CMD" | blocked_rule) || allow
    printf 'BLOCKED by implementer-guard: `%s` is outside the implementer'"'"'s remit.\n' "$RULE" >&2
    printf 'Commits, pushes, pull requests and migrations are done by the main session after review.\n' >&2
    printf 'Record what is needed under "Open issues" in the Implementation Report and continue.\n' >&2
    exit 2 ;;
  *) warn "unknown mode '${1:-}' — allowing"; allow ;;
esac
