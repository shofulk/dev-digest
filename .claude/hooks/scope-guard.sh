#!/usr/bin/env bash
# scope-guard.sh — shared PreToolUse hook, parametrized by profile, wired from the
# `hooks:` block of four subagent files: test-writer.md, architecture-reviewer.md,
# plan-verifier.md, doc-writer.md (.claude/agents/*.md), per docs/plans/review-agents.plan.md.
#
# Two axes, four call shapes:
#   scope-guard.sh write tests   — PreToolUse(Write|Edit|NotebookEdit) for test-writer
#   scope-guard.sh write docs    — PreToolUse(Write|Edit|NotebookEdit) for doc-writer
#   scope-guard.sh bash readonly — PreToolUse(Bash) for doc-writer
#   scope-guard.sh bash checks   — PreToolUse(Bash) for test-writer, architecture-reviewer,
#                                   plan-verifier
#   scope-guard.sh self-test     — path matrix + command matrix, exit 0 iff every case is right
#
# write modes resolve tool_input.file_path (or .notebook_path) against $CLAUDE_PROJECT_DIR
# (fallback: the hook JSON's own `cwd`, then `pwd`), collapse `..`, resolve symlinks on the
# nearest existing ancestor, and check the result against an ALLOW-LIST of globs (default
# deny — unlike implementer-guard.sh below, which is a deny-list over an otherwise-open Bash).
# bash modes tokenize tool_input.command and check every segment (recursing into
# `bash -c`/`sh -c`/`eval`) against a per-profile ALLOW-LIST of commands; anything not on the
# list is denied, including any command this file's author did not think of ("any unknown
# head" in the plan's Decisions section).
#
# FAIL-OPEN vs POLICY-DENY — these are different things and must not be confused:
#   - FAIL-OPEN (exit 0, warning on stderr): an INTERNAL error — stdin unreadable, the hook
#     JSON does not parse, $CLAUDE_PROJECT_DIR does not resolve. A guard that blocks every
#     call because of its own bug is worse than no guard (see implementer-guard.sh, same
#     rationale) — it gets disabled, and then there is no boundary at all.
#   - POLICY-DENY (exit 2, stderr names the rule): the input parsed fine and is simply
#     outside the allow-list — including a Write/Edit whose path could not be determined at
#     all (no file_path/notebook_path in tool_input). That is a real "no", not an error.
#
# TOKENIZER PROVENANCE: the shell tokenizer below (stripHeredocs / segments / tokens /
# VALUE_FLAGS / positional / shell-invoker recursion) is copied from the `blocked_rule`
# function in .claude/hooks/implementer-guard.sh, which copied it from the
# `matches_pr_command` function in .claude/hooks/pr-gate.sh. This is the THIRD copy of that
# tokenizer in this repo (tracked as a follow-up in the plan's Risks: "Third copy of the
# shell tokenizer" — consolidating into .claude/hooks/lib/ is out of scope here). A
# line-oriented regex over the raw command cannot tell a real invocation from a mention
# inside `echo`, a comment, or a heredoc body — see pr-gate.sh's header for the history of
# why that was replaced.
#
# BEST-EFFORT: an allow-list over Bash cannot see writes made by an ALLOWED program (a test
# writing fixture files, Vitest writing a new snapshot) — see the plan's Risks section. The
# prompt rule ("write tests, not production code") remains the primary control; this hook is
# a backstop, not a sandbox.
set -uo pipefail

SELF="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/$(basename "${BASH_SOURCE[0]:-$0}")"

warn() { printf 'scope-guard: %s\n' "$*" >&2; }
allow() { exit 0; }

block_msg() { # profile-kind, sub-profile, reason
  printf 'BLOCKED by scope-guard (%s %s): %s\n' "$1" "$2" "$3" >&2
  printf 'Allowed under `%s %s`: see the allow-lists in the header/body of %s\n' "$1" "$2" "$SELF" >&2
  printf 'Record the need under "Production changes needed" / "Proposed edits" in your report.\n' >&2
}

# ---------------------------------------------------------------------------------------
# bash_eval PROFILE MODE   (PROFILE = readonly|checks, MODE = json|raw)
#   MODE=json: stdin is the hook JSON; extracts tool_input.command.
#   MODE=raw:  stdin IS the command text (used directly by self-test, like
#              implementer-guard.sh's self-test feeds blocked_rule raw command strings).
# Exit codes: 0 = blocked (reason on stdout), 1 = allowed, 3 = internal error (fail-open;
# node already wrote the warning to stderr).
# ---------------------------------------------------------------------------------------
bash_eval() {
  node -e '
    const PROFILE = process.argv[1];
    const MODE = process.argv[2];
    let b = "";
    process.stdin.on("data", d => (b += d)).on("end", () => {
      let cmd;
      if (MODE === "json") {
        let j;
        try { j = JSON.parse(b); }
        catch {
          process.stderr.write("scope-guard: could not parse hook JSON on the bash path — allowing (fail-open)\n");
          process.exit(3);
        }
        cmd = String(j?.tool_input?.command ?? "");
      } else {
        cmd = String(b);
      }
      const r = evalCmd(cmd, PROFILE);
      if (r) { process.stdout.write(r); process.exit(0); }
      process.exit(1);
    });

    function evalCmd(cmd, profile) {
      let s = stripHeredocs(String(cmd));
      s = s.replace(/\\\r?\n/g, " ").replace(/\r?\n/g, ";");
      for (const seg of segments(s)) { const r = segVerdict(seg, profile); if (r) return r; }
      return null;
    }

    // A heredoc body is data, not a command.
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
        if (c === "#" && (cur === "" || /\s$/.test(cur))) {
          while (i < s.length && s[i] !== ";" && s[i] !== "\n") i++;
          continue;
        }
        // A fd-dup/close redirect (2>&1, >&2, 2>&-) embeds "&" right after ">" — that "&"
        // is not a command separator, unlike "&&", a background "&", or "&>file" (where
        // "&" precedes ">", not follows it).
        if (c === "&" && cur.endsWith(">") && /[0-9-]/.test(s[i + 1] || "")) { cur += c; continue; }
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

    // Flags that take a value, so the value is not mistaken for the subcommand/script.
    const VALUE_FLAGS = {
      git: ["-C", "-c", "--git-dir", "--work-tree"],
      pnpm: ["--dir", "-C", "--filter", "-F"],
      npm: ["--dir", "-C"],
    };

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

    // Redirection to anything but /dev/null or a fd dup (2>&1) is rejected, whether the
    // operator and target sit in one token (2>/dev/null) or two (> f, > /dev/null).
    function checkRedirection(t) {
      for (let i = 0; i < t.length; i++) {
        const v = t[i].v;
        const m = /^(\d*)(&>{1,2}|>{1,2})(.*)$/.exec(v);
        if (!m) continue;
        let target = m[3];
        if (target === "") target = i + 1 < t.length ? t[i + 1].v : "";
        if (target === "/dev/null" || /^&(?:\d+|-)$/.test(target)) continue;
        return "redirection" + (target ? " to `" + target + "`" : "") + " (only /dev/null or a fd dup like 2>&1 is allowed)";
      }
      return null;
    }

    // Rejected in ANY segment, regardless of profile — see the plan Decisions table.
    function preReject(t) {
      const r = checkRedirection(t);
      if (r) return r;
      for (const tok of t) {
        const v = tok.v;
        if (v === "--fix") return "`--fix`";
        if (v === "-u" || v === "--update") return "`-u`/`--update`";
        if (v === "--write") return "`--write`";
        if (v.indexOf("--output") === 0) return "`--output*`";
        if (v === "tee") return "`tee`";
        if (v === "xargs") return "`xargs`";
      }
      if (t.length && t[0].v.replace(/^.*\//, "") === "sort" && t.some(x => x.v === "-o")) return "`sort -o`";
      return null;
    }

    const READONLY_GIT = new Set(["status", "diff", "log", "show", "grep", "ls-files", "rev-parse", "merge-base", "blame", "cat-file"]);
    const READONLY_CMDS = new Set(["ls", "rg", "grep", "cat", "head", "tail", "wc", "diff", "cmp", "sort", "uniq", "cut", "tr", "jq", "stat", "file", "pwd", "cd", "echo", "printf", "test", "true", "basename", "dirname", "realpath", "which"]);
    const FIND_REJECT = new Set(["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprintf", "-fprint0", "-fls"]);

    // Heuristic, deliberately reject-leaning ("uncertain parse -> reject", per the plan):
    // a sed script that writes a file via a command-position w/W/e, or a substitution
    // trailing w/e flag (s/.../.../w or .../e), is rejected even without a full sed parser.
    function sedScriptUnsafe(script) {
      if (/(^|[;\n{])\s*(\d+|\$)?(,\s*(\d+|\$))?\s*[wWe](\s|$|;)/.test(script)) return true;
      if (/\/[a-zA-Z]*[we][a-zA-Z]*(\s|$|;)/.test(script)) return true;
      return false;
    }

    // pnpm/npm require --dir/-C before the script token — a bare `pnpm <script>` runs
    // against whatever directory the process happens to be in, which this policy does not
    // trust.
    function hasDirBeforeScript(rawArgs, tool) {
      const takes = VALUE_FLAGS[tool] ?? [];
      for (let i = 0; i < rawArgs.length; i++) {
        const v = rawArgs[i].v;
        if (v === "--dir" || v === "-C") return true;
        if (takes.includes(v)) { i++; continue; }
        if (v.startsWith("-")) continue;
        return false; // first positional (the script) reached before --dir/-C
      }
      return false;
    }

    function pnpmAllowed(rest, rawArgs) {
      let i = 0;
      if (rest[i] === "run") i++;
      if (rest[i] === "exec") {
        const target = rest[i + 1];
        if (target === "vitest") return rest[i + 2] === "run";
        if (target === "tsc") return rawArgs.some(x => x.v === "--noEmit");
        if (target === "eslint") return !rawArgs.some(x => x.v === "-o" || x.v === "--output-file" || x.v.indexOf("--output-file=") === 0);
        if (target === "depcruise") return !rawArgs.some(x => x.v === "-f" || x.v === "--output-to" || x.v.indexOf("--output-to=") === 0);
        return false;
      }
      return ["typecheck", "lint", "test", "arch"].includes(rest[i]);
    }

    function segVerdict(seg, profile) {
      const t = tokens(seg);
      let i = 0;
      // Leading VAR=value assignments: only CI= is accepted. Any other var name
      // (NODE_OPTIONS, GIT_*, PAGER, ...) is rejected outright, not silently skipped.
      while (i < t.length) {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(t[i].v);
        if (!m) break;
        if (m[1] !== "CI") return "leading `" + m[1] + "=` env assignment is not allowed (only `CI=` is accepted)";
        i++;
      }
      const body = t.slice(i);
      if (!body.length) return null; // blank segment (comment, trailing separator)

      const pr = preReject(body);
      if (pr) return "rejected: " + pr;

      const head = body[0].v.replace(/^.*\//, "");

      // A shell invoker runs its argument as a command — recurse into it once.
      if (["bash", "sh", "zsh", "dash", "eval"].includes(head)) {
        for (const a of body.slice(1)) if (!a.v.startsWith("-")) { const r = evalCmd(a.v, profile); if (r) return r; }
        return null;
      }

      if (head === "git") {
        const rawArgs = body.slice(1);
        // -c/--config-env sets arbitrary config (core.pager, diff.external, ...) for the
        // run — that is a program-execution hole, not a readonly git call.
        if (rawArgs.some(x => x.v === "-c" || x.v === "--config-env" || x.v.indexOf("--config-env=") === 0)) {
          return "`git -c`/`--config-env` (global config override) is not allowed";
        }
        if (rawArgs.some(x => x.v === "--ext-diff")) return "`git --ext-diff` is not allowed";
        const rest = positional(rawArgs, "git");
        if (rest[0] === "grep" && rawArgs.some(x => x.v === "-O" || x.v.indexOf("-O") === 0 || x.v === "--open-files-in-pager" || x.v.indexOf("--open-files-in-pager=") === 0)) {
          return "`git grep -O`/`--open-files-in-pager` is not allowed";
        }
        if (READONLY_GIT.has(rest[0])) return null;
        return "`git " + (rest[0] || "(none)") + "` is not in the readonly git allow-list (status/diff/log/show/grep/ls-files/rev-parse/merge-base/blame/cat-file)";
      }
      if (head === "find") {
        if (body.slice(1).some(x => FIND_REJECT.has(x.v))) return "`find` with -delete/-exec/-execdir/-ok/-okdir/-fprint*/-fls is not allowed";
        return null;
      }
      if (head === "sed") {
        const rest = body.slice(1);
        if (rest.some(x => x.v === "-i" || x.v.startsWith("-i") || x.v === "--in-place")) return "`sed -i`/`--in-place` is not allowed";
        if (rest.some(x => x.v === "-f" || x.v === "--file" || x.v.indexOf("--file=") === 0)) return "`sed -f`/`--file` is not allowed";
        if (rest.some(x => !x.v.startsWith("-") && sedScriptUnsafe(x.v))) {
          return "`sed` script may contain a w/W/e write command (uncertain parse — rejected)";
        }
        return null;
      }
      if (head === "rg" && body.slice(1).some(x => x.v === "--pre" || x.v.indexOf("--pre=") === 0)) {
        return "`rg --pre`/`--pre=...` is not allowed";
      }
      if (head === "sort" && body.slice(1).some(x => x.v === "--compress-program" || x.v.indexOf("--compress-program=") === 0)) {
        return "`sort --compress-program` is not allowed";
      }
      if (head === "file" && body.slice(1).some(x => x.v === "-C")) return "`file -C` is not allowed";
      if (READONLY_CMDS.has(head)) return null;

      if (profile === "checks") {
        if (head === "docker") {
          const rest = positional(body.slice(1), "docker");
          if (rest[0] === "info") return null;
          return "`docker` is only allowed as `docker info`";
        }
        if (head === "pnpm" || head === "npm") {
          const rawArgs = body.slice(1);
          if (!hasDirBeforeScript(rawArgs, head)) {
            return "`" + head + "` requires `--dir`/`-C` before the script — a bare `" + head + " " + rawArgs.map(x => x.v).join(" ") + "` is rejected";
          }
          const rest = positional(rawArgs, head);
          if (pnpmAllowed(rest, rawArgs)) return null;
          return "`" + head + " " + rest.join(" ") + "` is not typecheck/lint/test/arch, nor an allowed exec target (vitest run, tsc --noEmit, depcruise without -f/--output-to, eslint without -o/--output-file)";
        }
      }

      return "`" + head + "` is not in the `" + profile + "` allow-list";
    }
  ' "$1" "$2"
}

# ---------------------------------------------------------------------------------------
# write_eval PROFILE   (PROFILE = tests|docs); stdin = the hook JSON.
# Exit codes: 0 = blocked (reason on stdout), 1 = allowed, 3 = internal error (fail-open;
# node already wrote the warning to stderr).
# ---------------------------------------------------------------------------------------
write_eval() {
  node -e '
    const path = require("path");
    const fs = require("fs");
    const PROFILE = process.argv[1];
    let b = "";
    process.stdin.on("data", d => (b += d)).on("end", () => {
      try { main(); }
      catch (e) {
        process.stderr.write("scope-guard: internal error on the write path (" + (e && e.message) + ") — allowing (fail-open)\n");
        process.exit(3);
      }
    });

    function main() {
      let j;
      try { j = JSON.parse(b); }
      catch {
        process.stderr.write("scope-guard: could not parse hook JSON on the write path — allowing (fail-open)\n");
        process.exit(3);
      }

      const filePath = j?.tool_input?.file_path ?? j?.tool_input?.notebook_path ?? null;
      if (!filePath) {
        process.stdout.write("no resolvable file_path/notebook_path in tool_input");
        process.exit(0); // policy: an unresolvable path is a "no", not an internal error
      }

      const cwdFromJson = typeof j?.cwd === "string" ? j.cwd : null;
      const base = process.env.CLAUDE_PROJECT_DIR || cwdFromJson || process.cwd();
      let baseReal;
      try { baseReal = fs.realpathSync(base); }
      catch {
        process.stderr.write("scope-guard: could not resolve project root `" + base + "` — allowing (fail-open)\n");
        process.exit(3);
      }

      const logical = path.isAbsolute(filePath) ? path.normalize(filePath) : path.resolve(base, filePath);
      const real = realpathNearest(logical);

      if (real !== baseReal && real.indexOf(baseReal + path.sep) !== 0) {
        process.stdout.write("path resolves outside the repo (" + real + ")");
        process.exit(0);
      }

      let rel = path.relative(path.resolve(base), logical).split(path.sep).join("/");
      if (rel === "" || /^(\.\.)(\/|$)/.test(rel)) {
        process.stdout.write("path escapes the repo (" + rel + ")");
        process.exit(0);
      }

      // Check both the logical path (what the tool_input said) and the symlink-resolved
      // path on the nearest existing ancestor (what actually gets written) — a symlink
      // planted under an allowed dir that points at a denied one must not slip through on
      // the logical name alone.
      let relReal = path.relative(baseReal, real).split(path.sep).join("/");
      if (relReal === "" || /^(\.\.)(\/|$)/.test(relReal)) relReal = null;

      const policy = PROFILE === "tests" ? testsPolicy : docsPolicy;
      const verdict = policy(rel) || (relReal !== null ? policy(relReal) : null);
      if (verdict) { process.stdout.write(verdict); process.exit(0); }
      process.exit(1);
    }

    // Resolve symlinks on the nearest existing ancestor — the target file itself usually
    // does not exist yet (Write is about to create it).
    function realpathNearest(p) {
      try { return fs.realpathSync(p); }
      catch {
        const parent = path.dirname(p);
        if (parent === p) return p;
        return path.join(realpathNearest(parent), path.basename(p));
      }
    }

    function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

    function globToRegExp(glob) {
      let re = "", i = 0;
      while (i < glob.length) {
        const c = glob[i];
        if (c === "*" && glob[i + 1] === "*") {
          if (glob[i + 2] === "/") { re += "(?:.*/)?"; i += 3; }
          else { re += ".*"; i += 2; }
        } else if (c === "*") {
          re += "[^/]*"; i += 1;
        } else if (c === "{") {
          const end = glob.indexOf("}", i);
          const opts = glob.slice(i + 1, end).split(",").map(escapeRe);
          re += "(?:" + opts.join("|") + ")"; i = end + 1;
        } else if ("\\^$.|?+()[]".indexOf(c) !== -1) {
          re += "\\" + c; i += 1;
        } else {
          re += c; i += 1;
        }
      }
      return new RegExp("^" + re + "$");
    }

    function matchAny(rel, globs) { return globs.some(g => globToRegExp(g).test(rel)); }

    // Fixtures are allowed only inside the test dirs themselves (rev 3 decision) — there is
    // deliberately no **/fixtures/** or **/__fixtures__/** glob.
    const TESTS_ALLOW = [
      "{server,client,reviewer-core}/**/*.test.{ts,tsx}",
      "server/test/**",
      "reviewer-core/test/**",
      "client/src/test/**",
      "{server,client,reviewer-core}/**/__tests__/**",
      "{server,client,reviewer-core}/**/__snapshots__/**",
      "e2e/specs/*.flow.json",
    ];
    const TESTS_DENY = [
      "*/src/vendor/**",
      "server/clones/**",
      "node_modules/**",
      "server/src/adapters/mocks.ts",
      "server/src/db/seed.ts",
      "e2e/lib/**",
      "e2e/run.ts",
      "**/vitest.config.ts",
      "**/package.json",
      "**/pnpm-lock.yaml",
      "**/package-lock.json",
      "**/yarn.lock",
    ];
    function testsPolicy(rel) {
      if (matchAny(rel, TESTS_DENY)) return "`" + rel + "` matches a denied path (vendor mirror, server/clones, mocks.ts, seed.ts, e2e harness, config or lockfile)";
      if (matchAny(rel, TESTS_ALLOW)) return null;
      return "`" + rel + "` is outside the test-writer scope (*.test.{ts,tsx} in server/client/reviewer-core, server/test/**, reviewer-core/test/**, client/src/test/**, e2e/specs/*.flow.json)";
    }

    const DOCS_ALLOW = [
      "README.md",
      "{server,client,reviewer-core,e2e}/README.md",
      "{server,client,reviewer-core,e2e}/.doc/**/*.md",
      "docs/**/*.md",
    ];
    const DOCS_DENY = [
      "docs/plans/**",
      "docs/skills/**",
      "**/.spec/**",
      "**/AGENTS.md",
      "**/CLAUDE.md",
      "**/INSIGHTS.md",
      ".claude/**",
      "*/src/vendor/**",
      "server/clones/**",
    ];
    function docsPolicy(rel) {
      // docs/agent-prompts/** is denied except its own README.md (runtime prompts mirrored to the DB).
      if (rel === "docs/agent-prompts/README.md") return null;
      if (rel.indexOf("docs/agent-prompts/") === 0) return "`" + rel + "` — docs/agent-prompts/** is denied except docs/agent-prompts/README.md";
      if (matchAny(rel, DOCS_DENY)) return "`" + rel + "` matches a denied path (.spec, AGENTS.md, CLAUDE.md, INSIGHTS.md, .claude/, vendor mirror, server/clones)";
      if (matchAny(rel, DOCS_ALLOW)) return null;
      return "`" + rel + "` is outside the doc-writer scope (root/<pkg> README.md, <pkg>/.doc/**/*.md, docs/**/*.md)";
    }
  ' "$1"
}

# ---------------------------------------------------------------------------------------
self_test() {
  local fails=0
  ROOT=$(git -C "$(dirname "$SELF")" rev-parse --show-toplevel 2>/dev/null) || ROOT=$(cd "$(dirname "$SELF")/../.." && pwd)
  export CLAUDE_PROJECT_DIR="$ROOT"

  # name, profile, raw command, expected (0 = blocked, 1 = allowed)
  runb() {
    local got
    printf '%s' "$3" | bash_eval "$2" raw >/dev/null
    got=$?
    if [ "$got" = "$4" ]; then printf 'ok    %s\n' "$1"
    else printf 'FAIL  %s (want=%s got=%s)\n' "$1" "$4" "$got"; fails=$((fails + 1)); fi
  }

  # name, profile, file_path, expected (0 = blocked, 1 = allowed)
  runw() {
    local got
    printf '{"tool_input":{"file_path":"%s"}}' "$3" | write_eval "$2" >/dev/null
    got=$?
    if [ "$got" = "$4" ]; then printf 'ok    %s\n' "$1"
    else printf 'FAIL  %s (want=%s got=%s)\n' "$1" "$4" "$got"; fails=$((fails + 1)); fi
  }

  # name, profile, raw JSON body, expected (0 = blocked, 1 = allowed)
  runw_json() {
    local got
    printf '%s' "$3" | write_eval "$2" >/dev/null
    got=$?
    if [ "$got" = "$4" ]; then printf 'ok    %s\n' "$1"
    else printf 'FAIL  %s (want=%s got=%s)\n' "$1" "$4" "$got"; fails=$((fails + 1)); fi
  }

  # -- T1: write tests, allowed --
  runw "T1 client test"        tests "client/src/app/agents/_components/AgentCard/AgentCard.test.tsx" 1
  runw "T1 server it.test"     tests "server/test/x.it.test.ts"                                       1
  runw "T1 server test helper" tests "server/test/helpers/pg.ts"                                      1
  runw "T1 reviewer-core test" tests "reviewer-core/test/run.test.ts"                                 1
  runw "T1 e2e flow"           tests "e2e/specs/08-x.flow.json"                                       1
  runw "T1 client test setup"  tests "client/src/test/setup.ts"                                       1

  # -- T2: write tests, blocked (rev 3: fixtures only under the test dirs) --
  runw "T2 src fixtures"       tests "server/src/fixtures/x.json"          0
  runw "T2 server src"         tests "server/src/app.ts"                   0
  runw "T2 mocks.ts"           tests "server/src/adapters/mocks.ts"        0
  runw "T2 seed.ts"            tests "server/src/db/seed.ts"               0
  runw "T2 vendor test"        tests "client/src/vendor/shared/x.test.ts"  0
  runw "T2 e2e run.ts"         tests "e2e/run.ts"                         0
  runw "T2 vitest.config"      tests "client/vitest.config.ts"            0
  runw "T2 traversal"          tests "server/test/../src/app.ts"          0
  runw "T2 outside repo"       tests "/etc/hosts"                         0
  runw_json "T2 no file_path"  tests '{"tool_input":{}}'                  0
  runw "T2 test fixtures ok"   tests "server/test/fixtures/x.json"        1

  # -- T3: write docs, allowed --
  runw "T3 server README"      docs "server/README.md"                    1
  runw "T3 client .doc"        docs "client/.doc/query-keys.md"           1
  runw "T3 agent-prompts readme" docs "docs/agent-prompts/README.md"      1
  runw "T3 docs topic"         docs "docs/some-topic.md"                  1

  # -- T4: write docs, blocked --
  runw "T4 .spec"              docs "server/.spec/x.spec.md"              0
  runw "T4 AGENTS.md"          docs "AGENTS.md"                           0
  runw "T4 CLAUDE.md"          docs "client/CLAUDE.md"                    0
  runw "T4 INSIGHTS.md"        docs "INSIGHTS.md"                         0
  runw "T4 plans"              docs "docs/plans/x.plan.md"                0
  runw "T4 agent-prompts other" docs "docs/agent-prompts/security-reviewer.md" 0
  runw "T4 .claude"            docs ".claude/agents/README.md"            0
  runw "T4 non-md src"         docs "server/src/app.ts"                   0
  runw "T4 non-md docs"        docs "docs/x.png"                         0

  # -- T5: bash readonly, allowed --
  runb "T5 git diff"           readonly "git diff --stat"                 1
  runb "T5 rg"                 readonly "rg -n foo server/src"             1
  runb "T5 sed -n"             readonly "sed -n 1,20p f"                   1
  runb "T5 find name"          readonly "find . -name '*.md'"              1
  runb "T5 cat devnull"        readonly "cat f 2>/dev/null"                1

  # -- T5: bash readonly, blocked --
  runb "T5 echo redirect"      readonly "echo x > f"                      0
  runb "T5 sed -i"             readonly "sed -i s/a/b/ f"                 0
  runb "T5 tee"                readonly "tee f"                           0
  runb "T5 rm"                 readonly "rm f"                            0
  runb "T5 git checkout"       readonly "git checkout -- f"               0
  runb "T5 git commit"         readonly "git commit -m x"                 0
  runb "T5 shell invoker push" readonly "bash -c \"git push\""            0
  runb "T5 find delete"        readonly "find . -delete"                  0
  runb "T5 pnpm test"          readonly "pnpm test"                       0
  runb "T5 xargs rm"           readonly "xargs rm"                        0
  runb "T5 git diff output"    readonly "git diff --output=f"             0

  # -- T6: bash checks, allowed --
  runb "T6 pnpm arch"          checks "pnpm --dir server arch"                                              1
  runb "T6 CI test"            checks "CI=1 pnpm --dir client test"                                         1
  runb "T6 exec vitest run"    checks "pnpm --dir server exec vitest run --exclude '**/*.it.test.ts'"       1
  runb "T6 docker info"        checks "docker info"                                                          1
  runb "T6 pnpm arch 2>&1"     checks "pnpm --dir server arch 2>&1"                                          1

  # -- fd-dup / fd-close redirects: allowed (fix round 1) --
  runb "fix1 git diff stat 2>&1"   readonly "git diff --stat 2>&1"        1
  runb "fix1 git diff 2>&1 pipe"   readonly "git diff 2>&1 | head"        1
  runb "fix1 ls devnull 2>&1"      readonly "ls >/dev/null 2>&1"          1

  # -- fd-dup lookalikes that stay blocked (fix round 1) --
  runb "fix1 amp-gt file"          readonly "git diff &> out"             0
  runb "fix1 gt-amp file"          readonly "git diff >& out"             0
  runb "fix1 dup then file"        readonly "git diff 2>&1 > out"         0

  # -- T6: bash checks, blocked --
  runb "T6 lint --fix"         checks "pnpm --dir client lint --fix"          0
  runb "T6 vitest -u"          checks "pnpm --dir client exec vitest run -u"  0
  runb "T6 db:migrate"         checks "pnpm --dir server db:migrate"          0
  runb "T6 db:generate"        checks "pnpm --dir server db:generate"         0
  runb "T6 pnpm add"           checks "pnpm --dir client add x"               0
  runb "T6 pnpm dev"           checks "pnpm --dir server dev"                 0
  runb "T6 docker compose"     checks "docker compose up -d"                  0
  runb "T6 chained push"       checks "pnpm test && git push"                 0

  # -- T7: heredocs/mentions do not trigger; garbage stdin fails open --
  runb "T7 echo mention"       readonly "echo \"then git push\""              1
  runb "T7 comment mention"    readonly "# git commit later"                  1
  runb "T7 heredoc body"       checks "cat <<'EOF'
git push
EOF"                                                                          1

  local out rc
  out=$(printf 'garbage' | bash_eval readonly json 2>&1)
  rc=$?
  if [ "$rc" = 3 ] && [ -n "$out" ]; then printf 'ok    %s\n' "T7 garbage stdin fail-open (bash json path)"
  else printf 'FAIL  %s (rc=%s out=%s)\n' "T7 garbage stdin fail-open (bash json path)" "$rc" "$out"; fails=$((fails + 1)); fi

  out=$(printf 'garbage' | write_eval tests 2>&1)
  rc=$?
  if [ "$rc" = 3 ] && [ -n "$out" ]; then printf 'ok    %s\n' "T7 garbage stdin fail-open (write json path)"
  else printf 'FAIL  %s (rc=%s out=%s)\n' "T7 garbage stdin fail-open (write json path)" "$rc" "$out"; fails=$((fails + 1)); fi

  out=$(printf 'garbage' | "$SELF" bash readonly 2>&1)
  rc=$?
  if [ "$rc" = 0 ] && [ -n "$out" ]; then printf 'ok    %s\n' "T7 garbage stdin fail-open (full dispatch)"
  else printf 'FAIL  %s (rc=%s out=%s)\n' "T7 garbage stdin fail-open (full dispatch)" "$rc" "$out"; fails=$((fails + 1)); fi

  # -- T10 (S8 hardening): bash checks, (a) pnpm/npm require --dir/-C before the script --
  runb "T10 exec tsc noEmit"       checks "pnpm --dir server exec tsc --noEmit"                1
  runb "T10 CI client test"        checks "CI=1 pnpm --dir client test"                         1
  runb "T10 bare pnpm script"      checks "pnpm test"                                           0
  runb "T10 exec tsc no noEmit"    checks "pnpm --dir server exec tsc"                          0
  runb "T10 eslint -o"             checks "pnpm --dir client exec eslint -o out.txt src"        0
  runb "T10 depcruise -f"          checks "pnpm --dir server exec depcruise src -f out.txt"     0
  runb "T10 env prefix not CI"     checks "NODE_OPTIONS=--require=x pnpm --dir server test"     0

  # -- T10 (S8 hardening): bash readonly, (c) per-head flag checks --
  runb "T10 rg --pre"              readonly "rg --pre ./x foo"                                  0
  runb "T10 rg --pre="             readonly "rg --pre=./x foo"                                  0
  runb "T10 git -c pager"          readonly "git -c core.pager=x log"                            0
  runb "T10 git -c diff.external"  readonly "git -c diff.external=x diff"                        0
  runb "T10 git --ext-diff"        readonly "git diff --ext-diff"                                 0
  runb "T10 git grep -O"           readonly "git grep -Ox foo"                                    0
  runb "T10 git grep --open-files" readonly "git grep --open-files-in-pager=x foo"                0
  runb "T10 sed w command"         readonly "sed -n 'w out' f"                                    0
  runb "T10 sed s///w flag"        readonly "sed 's/a/b/w out' f"                                 0
  runb "T10 sed e command"         readonly "sed '1e id' f"                                       0
  runb "T10 sed -f"                readonly "sed -f s.sed f"                                      0
  runb "T10 sort --compress-program" readonly "sort --compress-program=x f"                       0
  runb "T10 file -C"               readonly "file -C f"                                           0
  runb "T10 GIT_EXTERNAL_DIFF env" readonly "GIT_EXTERNAL_DIFF=x git diff"                        0
  runb "T10 sed -n still allowed"  readonly "sed -n 1,20p f"                                      1
  runb "T10 git 2>&1 pipe still allowed" readonly "git diff 2>&1 | head"                          1

  # -- T10 (S8 hardening): (f) docs/skills/** denied --
  runw "T10 docs/skills denied"    docs "docs/skills/readme.md"                                  0

  # -- T10 (S8 hardening): (e) write policy checked on the symlink-resolved path too --
  SYMLINK_REL="server/test/.scope-guard-symlink-test-$$"
  ln -s "$ROOT/server/src" "$ROOT/$SYMLINK_REL" 2>/dev/null
  if [ -L "$ROOT/$SYMLINK_REL" ]; then
    runw "T10 symlink escapes to src" tests "$SYMLINK_REL/app.ts" 0
    rm -f "$ROOT/$SYMLINK_REL"
  else
    printf 'FAIL  %s (could not create the test symlink)\n' "T10 symlink escapes to src"
    fails=$((fails + 1))
  fi

  printf '\n%s failing case(s)\n' "$fails"
  [ "$fails" = 0 ]
}

# ---------------------------------------------------------------------------------------
case "${1:-}" in
  write)
    SUB="${2:-}"
    case "$SUB" in
      tests|docs) ;;
      *) warn "unknown write profile '$SUB' — allowing"; allow ;;
    esac
    RAW=$(cat) || allow
    REASON=$(printf '%s' "$RAW" | write_eval "$SUB"); RC=$?
    case "$RC" in
      1) allow ;;
      3) allow ;; # node already warned on stderr (fail-open)
      0) block_msg "write" "$SUB" "$REASON"; exit 2 ;;
      *) warn "internal error (exit $RC) on the write path — allowing"; allow ;;
    esac
    ;;
  bash)
    SUB="${2:-}"
    case "$SUB" in
      readonly|checks) ;;
      *) warn "unknown bash profile '$SUB' — allowing"; allow ;;
    esac
    RAW=$(cat) || allow
    REASON=$(printf '%s' "$RAW" | bash_eval "$SUB" json); RC=$?
    case "$RC" in
      1) allow ;;
      3) allow ;; # node already warned on stderr (fail-open)
      0) block_msg "bash" "$SUB" "$REASON"; exit 2 ;;
      *) warn "internal error (exit $RC) on the bash path — allowing"; allow ;;
    esac
    ;;
  self-test) self_test ;;
  *) warn "unknown mode '${1:-}' — allowing"; allow ;;
esac
