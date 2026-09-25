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
#   - FAIL-OPEN (exit 0, warning on stderr): an INTERNAL RUNTIME error — stdin unreadable,
#     the hook JSON does not parse, $CLAUDE_PROJECT_DIR does not resolve. A guard that
#     blocks every call because of its own bug is worse than no guard (see
#     implementer-guard.sh, same rationale) — it gets disabled, and then there is no
#     boundary at all.
#   - POLICY-DENY (exit 2, stderr names the rule): the input parsed fine and is simply
#     outside the allow-list — including a Write/Edit whose path could not be determined at
#     all (no file_path/notebook_path in tool_input). That is a real "no", not an error.
#     An UNKNOWN mode or profile argument (e.g. "write test" instead of "write tests") is
#     also POLICY-DENY, not fail-open: the argument comes from an agent's own frontmatter,
#     not from runtime input, so it is a configuration fault, and failing closed makes it
#     loud on the first call instead of silently disarming that agent's whole guard.
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
#
# CWD (S19): every CHECKS_EXACT entry and every pnpm --dir value is a relative path, so its
# meaning depends on the working directory the command actually runs in. `cd` used to be on
# the readonly allow-list, which `checks` inherits, so `cd server/clones/<repo> && pnpm --dir
# server test` re-pointed both onto an untrusted clone. Fix: `cd` (and pushd/popd/builtin/
# command, which were never allow-listed to begin with) is no longer a known head in either
# profile — a `cd` anywhere in a segment, including inside `bash -c`/`( ... )`, is an unknown
# head and blocks the whole command. That alone does not catch a cwd the Bash tool already
# had *before* the command started (e.g. inherited from earlier session state); for that the
# `bash` dispatch resolves the project root ($CLAUDE_PROJECT_DIR, else $SELF/../..; neither
# resolving is an internal error, fail-open) and passes it to bash_eval, which compares the
# hook JSON's own `cwd` field (fallback: the hook process's own cwd) against that root. A
# mismatch, or a cwd that fails to resolve, is a POLICY-DENY ("run from the repo root") for
# the two cwd-dependent checks only — a `CHECKS_EXACT` hit and any `pnpm`/`npm` segment;
# read-only heads (git diff, rg, ...) do not change meaning with the cwd and are unaffected.
# `raw` mode (self-test only) takes an explicit cwd argument that defaults to the project
# root, so every pre-S19 `runb` row keeps its old meaning. `git -C`/`--git-dir*`/
# `--work-tree*` are rejected for the same reason — they point git at another tree — and a
# `pnpm --dir=...`/attached `-C<path>`/`--prefix*` token is rejected outright, since it slips
# a second, unvalidated directory value past the `--dir`/`-C` check above.
#
# ARGUMENT ALLOWLISTS (S20): the `exec`/script-form flag checks used to be per-program
# denylists (reject `-o`, reject `--config`, ...) over programs with a wide CLI surface, and
# three concrete shapes passed anyway: script forms forward their arguments verbatim (`pnpm
# --dir server test --config src/db/seed.ts` becomes `vitest run --config ...`), `exec vitest
# run --reporter=./x.js` loads a reporter BY PATH, and `exec depcruise --webpack-config`/
# `exec eslint -f ./fmt.js` load a webpack config or formatter as code. Fix: `typecheck`/
# `lint`/`arch` take no trailing argument at all; `test` and `exec vitest run` take only the
# vitest allowlist (positional filters, `--exclude`, `-t`/`--testNamePattern`, `--reporter`
# with a built-in name, `--passWithNoTests`, `--silent`); `exec tsc` takes `--noEmit`
# (required) and `-p`/`--project`; `exec depcruise` takes a path under `src`, `--config`/`-c`
# pinned to `.dependency-cruiser.cjs`, `-T err|err-long|text`, `--include-only`; `exec eslint`
# takes a path, `--max-warnings <n>`, `-f`/`--format stylish|json`. A positional path argument
# is rejected if absolute, if any `/`-segment is `..`, or if any segment is `clones` — the
# same untrusted-clone concern as the cwd/`--dir` rules above. Widening any of these is one
# table edit plus a T15 self-test case, never a switch back to a denylist.
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
# bash_eval PROFILE MODE ROOT [CWD]   (PROFILE = readonly|checks, MODE = json|raw)
#   MODE=json: stdin is the hook JSON; extracts tool_input.command and tool_input's sibling
#              top-level `cwd` field (fallback: this node process's own cwd).
#   MODE=raw:  stdin IS the command text (used directly by self-test, like
#              implementer-guard.sh's self-test feeds blocked_rule raw command strings).
#              CWD, if given, is the cwd to check against ROOT; if omitted it defaults to
#              ROOT itself, so every pre-S19 self-test row keeps its old meaning.
#   ROOT is the already-resolved project root (S19 cwd rule); an empty ROOT means the
#   caller could not resolve one and this call should not have happened (fail-open already
#   handled by the caller) — treated here as "cwd never matches", i.e. cwd-dependent checks
#   are rejected, never silently allowed.
# Exit codes: 0 = blocked (reason on stdout), 1 = allowed, 3 = internal error (fail-open;
# node already wrote the warning to stderr).
# ---------------------------------------------------------------------------------------
bash_eval() {
  node -e '
    const fs = require("fs");
    const PROFILE = process.argv[1];
    const MODE = process.argv[2];
    const ROOT = process.argv[3] || "";
    const EXPLICIT_CWD = process.argv[4];
    let b = "";
    process.stdin.on("data", d => (b += d)).on("end", () => {
      let cmd;
      let cwdInfo;
      if (MODE === "json") {
        let j;
        try { j = JSON.parse(b); }
        catch {
          process.stderr.write("scope-guard: could not parse hook JSON on the bash path — allowing (fail-open)\n");
          process.exit(3);
        }
        cmd = String(j?.tool_input?.command ?? "");
        const inputCwd = typeof j?.cwd === "string" ? j.cwd : null;
        cwdInfo = resolveCwd(inputCwd !== null ? inputCwd : process.cwd(), ROOT);
      } else {
        cmd = String(b);
        cwdInfo = resolveCwd(EXPLICIT_CWD !== undefined ? EXPLICIT_CWD : ROOT, ROOT);
      }
      const r = evalCmd(cmd, PROFILE, cwdInfo);
      if (r) { process.stdout.write(r); process.exit(0); }
      process.exit(1);
    });

    // A candidate cwd matches the project root only if both resolve and are the same real
    // path. An unresolvable root, an unresolvable candidate, or a real mismatch are all
    // "does not match" -- this is a POLICY question for the cwd-dependent checks, never an
    // internal error (the root itself was already validated fail-open by the caller).
    function resolveCwd(candidate, root) {
      if (!root) return { ok: false, matches: false, value: String(candidate) };
      let rootReal;
      try { rootReal = fs.realpathSync(root); } catch { return { ok: false, matches: false, value: String(candidate) }; }
      let real;
      try { real = fs.realpathSync(String(candidate)); }
      catch { return { ok: false, matches: false, value: String(candidate) }; }
      return { ok: true, matches: real === rootReal, value: real };
    }

    function evalCmd(cmd, profile, cwdInfo) {
      const raw = String(cmd);
      if (hasCommandSub(heredocAwareScrub(raw))) {
        return "rejected: command substitution (a \x60backtick\x60 or $(...) outside single quotes) is not allowed";
      }
      let s = stripHeredocs(raw);
      s = s.replace(/\\\r?\n/g, " ").replace(/\r?\n/g, ";");
      for (const seg of segments(s)) { const r = segVerdict(seg, profile, cwdInfo); if (r) return r; }
      return null;
    }

    // A heredoc body is data, not a command.
    function stripHeredocs(s) {
      return s.replace(/<<-?\s*(["\x27]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^\s*\2\s*$/gm, " ");
    }

    // A backtick or $( outside single quotes is command substitution; single quotes make
    // it inert, double quotes do not (bash still expands $(...) inside double quotes).
    function hasCommandSub(s) {
      let q = null;
      for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (q) { if (c === q) q = null; continue; }
        if (c === "\x27") { q = c; continue; }
        if (c === "\x60") return true;
        if (c === "$" && s[i + 1] === "(") return true;
      }
      return false;
    }

    // Quoted-delimiter heredoc bodies (<<\x27EOF\x27 / <<"EOF") are inert data — drop them
    // so a literal $(...) or backtick inside does not false-positive. Unquoted-delimiter
    // bodies (<<EOF) are expanded by bash, so they stay in the scan; checked before
    // stripHeredocs removes them.
    function heredocAwareScrub(s) {
      return s.replace(/<<-?\s*(["\x27]?)([A-Za-z_][A-Za-z0-9_]*)\1([\s\S]*?)^\s*\2\s*$/gm, function (m, q, word, body) {
        return q ? " " : " " + body;
      });
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
      // `-o` also arrives attached (`-oout.txt`) or clustered (`-ro out.txt`).
      if (t.length && t[0].v.replace(/^.*\//, "") === "sort" && t.slice(1).some(x => /^-[^-]/.test(x.v) && x.v.slice(1).indexOf("o") !== -1)) return "`sort -o`";
      return null;
    }

    const READONLY_GIT = new Set(["status", "diff", "log", "show", "grep", "ls-files", "rev-parse", "merge-base", "blame", "cat-file"]);
    // "cd" (and pushd/popd/builtin/command, never allow-listed) is deliberately absent:
    // a head that re-points every later relative path is not a read-only command (S19).
    const READONLY_CMDS = new Set(["ls", "rg", "grep", "cat", "head", "tail", "wc", "diff", "cmp", "sort", "uniq", "cut", "tr", "jq", "stat", "file", "pwd", "echo", "printf", "test", "true", "basename", "dirname", "realpath", "which"]);
    const FIND_REJECT = new Set(["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprintf", "-fprint0", "-fls"]);

    // Heuristic, deliberately reject-leaning ("uncertain parse -> reject", per the plan):
    // a sed script that writes a file via a command-position w/W/e, or a substitution
    // trailing w/e flag (s/.../.../w or .../e), is rejected even without a full sed parser.
    function sedScriptUnsafe(script) {
      if (/(^|[;\n{])\s*(\d+|\$)?(,\s*(\d+|\$))?\s*[wWe](\s|$|;)/.test(script)) return true;
      if (/\/[a-zA-Z]*[we][a-zA-Z]*(\s|$|;)/.test(script)) return true;
      return false;
    }

    // A --dir=..., attached -C<path>, or --prefix* token slips a second, unvalidated
    // directory value past the exact-token check in dirValues() below (S19; pnpm treats
    // --dir=X the same as --dir X, and --prefix is npm equivalent of --dir). Rejected
    // outright rather than parsed, since no prompt needs these spellings (C3).
    function hasBadDirToken(rawArgs) {
      return rawArgs.some(function (x) {
        const v = x.v;
        return v.indexOf("--dir=") === 0 || (v.indexOf("-C") === 0 && v !== "-C") || v.indexOf("--prefix") === 0;
      });
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

    // Only the four package names -- --dir/-C pointing anywhere else (server/clones/<x>,
    // an absolute path) is a way to run an untrusted or production script (C3, S15).
    const ALLOWED_DIRS = new Set(["server", "client", "reviewer-core", "e2e"]);

    // Every --dir/-C value in the segment, in order.
    function dirValues(rawArgs) {
      const out = [];
      for (let i = 0; i < rawArgs.length; i++) {
        const v = rawArgs[i].v;
        if (v === "--dir" || v === "-C") {
          if (i + 1 < rawArgs.length) out.push(rawArgs[i + 1].v);
          i++;
        }
      }
      return out;
    }

    // S20: argument ALLOWLISTS, not per-flag denylists — a denylist over a program with a
    // wide CLI surface only closes the holes its author thought of (vitest --reporter=./x.js,
    // depcruise --webpack-config, eslint -f ./fmt.js all load JS and passed the old --config/
    // -o denylist). A relative path arg is checked once, shared by every target below.
    function pathArgOk(v) {
      if (v.indexOf("/") === 0) return false; // absolute
      const segs = v.split("/");
      if (segs.indexOf("..") !== -1) return false;
      if (segs.indexOf("clones") !== -1) return false;
      return true;
    }

    // "--flag=value" splits into ["--flag", "value"]; a bare token stays ["token", null].
    function splitFlagValue(tok) {
      const eq = tok.indexOf("=");
      if (tok.indexOf("--") === 0 && eq !== -1) return [tok.slice(0, eq), tok.slice(eq + 1)];
      return [tok, null];
    }

    const VITEST_REPORTERS = new Set(["default", "basic", "verbose", "dot", "tap", "tap-flat", "json"]);

    // Shared by the `test` script form and `exec vitest run`: positional filters, --exclude,
    // -t/--testNamePattern, --reporter (built-in name only), --passWithNoTests, --silent.
    function vitestArgsOk(tokens) {
      for (let i = 0; i < tokens.length; i++) {
        const v = tokens[i];
        if (v.indexOf("-") !== 0) { if (!pathArgOk(v)) return false; continue; }
        const parts = splitFlagValue(v); const flag = parts[0]; const inline = parts[1];
        if (flag === "--passWithNoTests" || flag === "--silent") { if (inline !== null) return false; continue; }
        if (flag === "--exclude" || flag === "-t" || flag === "--testNamePattern") {
          if (inline !== null) continue;
          i++; if (i >= tokens.length) return false; continue;
        }
        if (flag === "--reporter") {
          const val = inline !== null ? inline : tokens[++i];
          if (!val || !VITEST_REPORTERS.has(val)) return false;
          continue;
        }
        return false;
      }
      return true;
    }

    // `exec tsc` takes --noEmit (required) and -p/--project <path>.
    function tscArgsOk(tokens) {
      let hasNoEmit = false;
      for (let i = 0; i < tokens.length; i++) {
        const v = tokens[i];
        const parts = splitFlagValue(v); const flag = parts[0]; const inline = parts[1];
        if (flag === "--noEmit") { if (inline !== null) return false; hasNoEmit = true; continue; }
        if (flag === "-p" || flag === "--project") {
          const val = inline !== null ? inline : tokens[++i];
          if (!val || !pathArgOk(val)) return false;
          continue;
        }
        return false;
      }
      return hasNoEmit;
    }

    // `exec depcruise` takes positional paths under src, --config/-c (only the repo config
    // file — it loads as code), -T err|err-long|text, --include-only <re>.
    function depcruiseArgsOk(tokens) {
      for (let i = 0; i < tokens.length; i++) {
        const v = tokens[i];
        if (v.indexOf("-") !== 0) {
          if (!pathArgOk(v) || (v !== "src" && v.indexOf("src/") !== 0)) return false;
          continue;
        }
        const parts = splitFlagValue(v); const flag = parts[0]; const inline = parts[1];
        if (flag === "--config" || flag === "-c") {
          const val = inline !== null ? inline : tokens[++i];
          if (val !== ".dependency-cruiser.cjs") return false;
          continue;
        }
        if (flag === "-T") {
          const val = inline !== null ? inline : tokens[++i];
          if (!val || ["err", "err-long", "text"].indexOf(val) === -1) return false;
          continue;
        }
        if (flag === "--include-only") {
          if (inline !== null) continue;
          i++; if (i >= tokens.length) return false; continue;
        }
        return false;
      }
      return true;
    }

    // `exec eslint` takes positional paths, --max-warnings <n>, -f/--format stylish|json.
    function eslintArgsOk(tokens) {
      for (let i = 0; i < tokens.length; i++) {
        const v = tokens[i];
        if (v.indexOf("-") !== 0) { if (!pathArgOk(v)) return false; continue; }
        const parts = splitFlagValue(v); const flag = parts[0]; const inline = parts[1];
        if (flag === "--max-warnings") {
          const val = inline !== null ? inline : tokens[++i];
          if (!val || !/^\d+$/.test(val)) return false;
          continue;
        }
        if (flag === "-f" || flag === "--format") {
          const val = inline !== null ? inline : tokens[++i];
          if (!val || ["stylish", "json"].indexOf(val) === -1) return false;
          continue;
        }
        return false;
      }
      return true;
    }

    // Raw token strings, in order, with the --dir/-C flag and its value removed — unlike
    // positional() below this keeps every other flag and its value, since pnpmAllowed needs
    // the exact trailing argument shape to run through the allowlists above.
    function stripDirTokens(rawArgs) {
      const out = [];
      for (let i = 0; i < rawArgs.length; i++) {
        const v = rawArgs[i].v;
        if (v === "--dir" || v === "-C") { i++; continue; }
        out.push(v);
      }
      return out;
    }

    // A redirection token (checked safe already by preReject/checkRedirection before this
    // branch runs) is shell syntax, not a script argument — drop it (and its separate
    // target token, e.g. "> /dev/null") before counting trailing arguments.
    function stripRedir(tokens) {
      const out = [];
      for (let i = 0; i < tokens.length; i++) {
        const v = tokens[i];
        const m = /^(\d*)(&>{1,2}|>{1,2})(.*)$/.exec(v);
        if (m) { if (m[3] === "" && i + 1 < tokens.length) i++; continue; }
        out.push(v);
      }
      return out;
    }

    function pnpmAllowed(rawArgs, dirs) {
      const stripped = stripRedir(stripDirTokens(rawArgs));
      let i = 0;
      if (stripped[i] === "run") i++;
      const e2eOnly = dirs.length > 0 && dirs.every(function (d) { return d === "e2e"; });
      if (stripped[i] === "exec") {
        if (e2eOnly) return false; // e2e allows only typecheck/lint, never exec
        const target = stripped[i + 1];
        const rest = stripped.slice(i + 2);
        if (target === "vitest") return rest[0] === "run" && vitestArgsOk(rest.slice(1));
        if (target === "tsc") return tscArgsOk(rest);
        if (target === "eslint") return eslintArgsOk(rest);
        if (target === "depcruise") return depcruiseArgsOk(rest);
        return false;
      }
      const script = stripped[i];
      const trailing = stripped.slice(i + 1);
      if (script === "test" && !e2eOnly) return vitestArgsOk(trailing);
      const noArgScripts = e2eOnly ? ["typecheck", "lint"] : ["typecheck", "lint", "arch"];
      return noArgScripts.includes(script) && trailing.length === 0;
    }

    // Exact allowed hook self-checks, checks profile only (S15(f)) -- matched before the
    // shell-invoker recursion below, so `bash -n <path>` is not treated as a recursive
    // command over its own path argument, and `<hook> self-test` is not treated as an
    // unknown head. No prefix/suffix match, no other .claude/hooks/ script.
    const CHECKS_EXACT = new Set([
      "bash -n .claude/hooks/scope-guard.sh",
      "bash -n .claude/hooks/implementer-guard.sh",
      ".claude/hooks/scope-guard.sh self-test",
      ".claude/hooks/implementer-guard.sh self-test",
    ]);

    function segVerdict(seg, profile, cwdInfo) {
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

      const canonical = body.map(function (x) { return x.v; }).join(" ");
      if (profile === "checks" && CHECKS_EXACT.has(canonical)) {
        if (cwdInfo && cwdInfo.ok && cwdInfo.matches) return null;
        return "run from the repo root (cwd: " + (cwdInfo ? cwdInfo.value : "unknown") + ")";
      }

      const pr = preReject(body);
      if (pr) return "rejected: " + pr;

      const head = body[0].v.replace(/^.*\//, "");

      // A shell invoker runs its argument as a command — recurse into it once.
      // With no command argument it reads its program from stdin (`cat x.sh | bash`,
      // `bash < x.sh`), which this parser cannot see, so that shape is rejected; so is
      // any flag beyond -c/-e/-u/-x (e.g. --rcfile, -s, -i, -l load or read other code).
      if (["bash", "sh", "zsh", "dash", "eval"].includes(head)) {
        const args = stripRedir(body.slice(1).map(function (x) { return x.v; }));
        if (body.slice(1).some(function (x) { return /^\d*</.test(x.v); })) return "`" + head + "` with input redirection (program read from a file) is not allowed";
        const bad = args.find(function (v) { return v.startsWith("-") && !/^-[ceux]+$/.test(v); });
        if (bad) return "`" + head + " " + bad + "` is not allowed (only -c/-e/-u/-x)";
        const cmds = args.filter(function (v) { return !v.startsWith("-"); });
        if (!cmds.length) return "`" + head + "` without a command argument reads its program from stdin — not allowed";
        for (const c of cmds) { const r = evalCmd(c, profile, cwdInfo); if (r) return r; }
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
        // -C/--git-dir/--work-tree point git at another tree entirely — the same class of
        // hole as `cd` (S19): a PR repo under server/clones/** can carry an embedded
        // config that loads on `git -C <that dir> ...`.
        if (rawArgs.some(x => x.v === "-C" || x.v.indexOf("--git-dir") === 0 || x.v.indexOf("--work-tree") === 0)) {
          return "`git -C`/`--git-dir`/`--work-tree` (pointing at another tree) is not allowed";
        }
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
        // Short flags cluster (`-ni`, `-Ei`) and BSD/macOS spells in-place `-I`, so any
        // short-flag token carrying i/I/f is rejected, not only a leading `-i`.
        if (rest.some(x => x.v.indexOf("--in-place") === 0 || (/^-[^-]/.test(x.v) && /[iI]/.test(x.v.slice(1))))) return "`sed -i`/`-I`/`--in-place` (also clustered, e.g. `-ni`) is not allowed";
        if (rest.some(x => /^-[^-]/.test(x.v) && x.v.slice(1).indexOf("f") !== -1)) return "`sed -f`/`--file` is not allowed";
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
      // POSIX `uniq [in [out]]` writes its second operand; allow at most one operand.
      if (head === "uniq") {
        const a = stripRedir(body.slice(1).map(function (x) { return x.v; }));
        let operands = 0;
        for (let i = 0; i < a.length; i++) {
          if (["-f", "-s", "-w"].includes(a[i])) { i++; continue; }
          if (!a[i].startsWith("-")) operands++;
        }
        if (operands > 1) return "`uniq <in> <out>` writes a file — pass at most one input operand";
      }
      if (READONLY_CMDS.has(head)) return null;

      if (profile === "checks") {
        if (head === "docker") {
          const rest = positional(body.slice(1), "docker");
          if (rest[0] === "info") return null;
          return "`docker` is only allowed as `docker info`";
        }
        // npm dropped (S19): its -C means --prefix, it has no --dir, so the --dir
        // guarantee below never held for it, and no prompt uses it (C3).
        if (head === "pnpm") {
          const rawArgs = body.slice(1);
          if (!(cwdInfo && cwdInfo.ok && cwdInfo.matches)) {
            return "run from the repo root (cwd: " + (cwdInfo ? cwdInfo.value : "unknown") + ")";
          }
          if (hasBadDirToken(rawArgs)) {
            return "`--dir=...`/attached `-C<path>`/`--prefix*` is not allowed — use `--dir <pkg>` as separate tokens";
          }
          if (!hasDirBeforeScript(rawArgs, head)) {
            return "`" + head + "` requires `--dir`/`-C` before the script — a bare `" + head + " " + rawArgs.map(x => x.v).join(" ") + "` is rejected";
          }
          const dirs = dirValues(rawArgs);
          if (dirs.some(function (d) { return !ALLOWED_DIRS.has(d); })) {
            return "`--dir`/`-C` must be exactly one of server, client, reviewer-core, e2e";
          }
          if (pnpmAllowed(rawArgs, dirs)) return null;
          return "`" + head + "` script/exec form or its trailing arguments are not in the allowlist (typecheck/lint/arch take no arguments; test/exec vitest run take the vitest arg allowlist; exec tsc/depcruise/eslint take their own — see the header)";
        }
      }

      return "`" + head + "` is not in the `" + profile + "` allow-list";
    }
  ' "$1" "$2" "${3:-}" "${4:-}"
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

  # name, profile, raw command, expected (0 = blocked, 1 = allowed), [cwd] — cwd defaults
  # to $ROOT (S19), so every pre-S19 row keeps its old meaning.
  runb() {
    local got
    printf '%s' "$3" | bash_eval "$2" raw "$ROOT" "${5:-$ROOT}" >/dev/null
    got=$?
    if [ "$got" = "$4" ]; then printf 'ok    %s\n' "$1"
    else printf 'FAIL  %s (want=%s got=%s)\n' "$1" "$4" "$got"; fails=$((fails + 1)); fi
  }

  # name, bash profile, command, cwd-field value ("none" = omit the cwd key), expected exit
  # code from full dispatch (0 = allowed, 2 = blocked) — S19's json-mode cwd guard, built
  # through node so the JSON is well-formed regardless of the command text.
  runj() {
    local got body
    body=$(node -e '
      const cmd = process.argv[1];
      const cwd = process.argv[2];
      const obj = { tool_input: { command: cmd } };
      if (cwd !== "none") obj.cwd = cwd;
      process.stdout.write(JSON.stringify(obj));
    ' "$3" "$4")
    printf '%s' "$body" | "$SELF" bash "$2" >/dev/null 2>&1
    got=$?
    if [ "$got" = "$5" ]; then printf 'ok    %s\n' "$1"
    else printf 'FAIL  %s (want=%s got=%s)\n' "$1" "$5" "$got"; fails=$((fails + 1)); fi
  }

  # name, bash profile, command, directory to run the hook process itself from, expected
  # exit code — exercises the "no cwd field, fall back to the hook process's own cwd" path.
  runj_hostcwd() {
    local got
    (cd "$4" 2>/dev/null && printf '{"tool_input":{"command":"%s"}}' "$3" | "$SELF" bash "$2" >/dev/null 2>&1)
    got=$?
    if [ "$got" = "$5" ]; then printf 'ok    %s\n' "$1"
    else printf 'FAIL  %s (want=%s got=%s)\n' "$1" "$5" "$got"; fails=$((fails + 1)); fi
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

  # name, mode, sub-profile, expected exit code — full dispatch (through "$SELF"), for the
  # unknown mode/profile fail-closed rows (S15(e)); stdin is irrelevant, the mode check runs
  # first. S21 tightens this: a block for another reason no longer counts as a pass — the
  # exit code AND the "misconfigured scope-guard" stderr text must both match, so `rund`
  # actually proves the fail-closed path fired, not just that something exited 2.
  rund() {
    local got out
    out=$(printf '{}' | "$SELF" "$2" "$3" 2>&1)
    got=$?
    if [ "$got" = "$4" ] && { [ "$got" != "2" ] || printf '%s' "$out" | grep -q "misconfigured scope-guard"; }; then
      printf 'ok    %s\n' "$1"
    else
      printf 'FAIL  %s (want=%s got=%s out=%s)\n' "$1" "$4" "$got" "$out"; fails=$((fails + 1))
    fi
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

  # -- T12 (S15 security fixes): (a) --dir/-C restricted to the four packages, e2e limited --
  runb "T12 depcruise -T ok"       checks "pnpm --dir server exec depcruise src --config .dependency-cruiser.cjs -T err-long" 1
  runb "T12 e2e typecheck ok"      checks "pnpm --dir e2e typecheck"                                                          1
  runb "T12 reviewer-core test ok" checks "pnpm --dir reviewer-core test"                                                     1
  runb "T12 dir clones"            checks "pnpm --dir server/clones/x/y test"                                                 0
  runb "T12 dir tmp"               checks "pnpm --dir /tmp test"                                                              0
  runb "T12 dir two values"        checks "pnpm --dir server --dir /tmp test"                                                 0
  runb "T12 e2e test blocked"      checks "pnpm --dir e2e test"                                                               0

  # -- T12: (b) vitest/depcruise/eslint config flags rejected --
  runb "T12 vitest --config"       checks "pnpm --dir server exec vitest run --config src/db/seed.ts"                        0
  runb "T12 vitest -c"             checks "pnpm --dir server exec vitest run -c x.ts"                                         0
  runb "T12 vitest --root"         checks "pnpm --dir server exec vitest run --root clones/x"                                 0
  runb "T12 eslint -c"             checks "pnpm --dir client exec eslint -c x.mjs src"                                        0
  runb "T12 depcruise output-type" checks "pnpm --dir server exec depcruise src --config .dependency-cruiser.cjs --output-type err-long" 0
  runb "T12 depcruise output-to"   checks "pnpm --dir server exec depcruise src -T err-long --output-to x"                    0
  runb "T12 depcruise bad config"  checks "pnpm --dir server exec depcruise src --config other.cjs"                           0
  runb "T12 depcruise init"        checks "pnpm --dir server exec depcruise --init"                                           0

  # -- T12: (c) command substitution rejected outside single quotes, incl. unquoted heredoc bodies --
  runb "T12 rg single-quoted"      checks "rg -n '\$(foo)' f"                                                                 1
  runb "T12 quoted heredoc ok"     checks "cat <<'EOF'
\$(x)
EOF"                                                                                                                          1
  runb "T12 backtick echo"         readonly "echo \`rm f\`"                                                                  0
  runb "T12 dollar-paren dq"       readonly "echo \"\$(rm f)\""                                                              0
  runb "T12 unquoted heredoc"      readonly "cat <<EOF
\$(rm f)
EOF"                                                                                                                          0

  # -- T12: (f) exact hook self-tests / bash -n, checks profile only --
  runb "T12 bash -n scope-guard"      checks "bash -n .claude/hooks/scope-guard.sh"                     1
  runb "T12 bash -n implementer-guard" checks "bash -n .claude/hooks/implementer-guard.sh"               1
  runb "T12 self-test scope-guard"    checks ".claude/hooks/scope-guard.sh self-test"                    1
  runb "T12 self-test implementer"    checks ".claude/hooks/implementer-guard.sh self-test"              1
  runb "T12 bash -n tmp"              checks "bash -n /tmp/x.sh"                                          0
  runb "T12 scope-guard bash checks"  checks ".claude/hooks/scope-guard.sh bash checks"                   0
  runb "T12 pr-gate self-test"        checks ".claude/hooks/pr-gate.sh self-test"                         0
  runb "T12 bash -n readonly only"    readonly "bash -n .claude/hooks/scope-guard.sh"                     0

  # -- T12: (e) unknown mode/profile fails closed (misconfigured), full dispatch --
  rund "T12 bash check typo"       bash check      2
  rund "T12 write test typo"       write test      2
  rund "T12 nonsense mode"         nonsense ""     2

  # -- T14 (S19 cwd rule): cd/pushd/builtin/git -C exploit shapes, raw (cwd = root) --
  runb "T14 cd clones then self-test"   checks "cd server/clones/x && .claude/hooks/scope-guard.sh self-test"          0
  runb "T14 cd clones then pnpm test"   checks "cd server/clones/x && pnpm --dir server test"                          0
  runb "T14 subshell cd then pnpm"      checks "(cd server && pnpm --dir server test)"                                 0
  runb "T14 bash -c cd then pnpm"       checks "bash -c \"cd server && pnpm --dir server test\""                       0
  runb "T14 pushd"                      checks "pushd server"                                                         0
  runb "T14 builtin cd"                 checks "builtin cd server"                                                    0
  runb "T14 pnpm --dir= second value"   checks "pnpm --dir server --dir=server/clones/x test"                         0
  runb "T14 pnpm attached -C"           checks "pnpm -Cserver/clones/x --dir server test"                             0
  runb "T14 pnpm --prefix="             checks "pnpm --dir server --prefix=clones/x test"                             0
  runb "T14 npm dropped"                checks "npm --dir server test"                                                0
  runb "T14 git -C"                     checks "git -C server/clones/x status"                                       0
  runb "T14 git --git-dir="             checks "git --git-dir=server/clones/x/.git log"                               0
  runb "T14 git --work-tree="           checks "git --work-tree=server/clones/x diff"                                 0
  runb "T14 readonly cd"                readonly "cd server"                                                          0
  runb "T14 readonly bare cd"           readonly "cd"                                                                 0
  runb "T14 readonly git -C"            readonly "git -C server log"                                                  0
  runb "T14 pnpm arch still allowed"    checks "pnpm --dir server arch"                                               1
  runb "T14 git diff still allowed"     readonly "git diff --stat"                                                    1

  # -- T14: json-mode cwd guard (runj builds the hook JSON with node) --
  runj "T14 json cwd root allows self-test"      checks ".claude/hooks/scope-guard.sh self-test" "$ROOT"        0
  runj "T14 json cwd root allows arch"           checks "pnpm --dir server arch"                  "$ROOT"        0
  runj "T14 json cwd server blocks self-test"    checks ".claude/hooks/scope-guard.sh self-test" "$ROOT/server" 2
  runj "T14 json cwd server blocks arch"         checks "pnpm --dir server arch"                  "$ROOT/server" 2
  runj "T14 json cwd server blocks bash -n"      checks "bash -n .claude/hooks/implementer-guard.sh" "$ROOT/server" 2
  runj "T14 json cwd server allows git diff"     checks "git diff --stat"                          "$ROOT/server" 0
  runj "T14 json cwd missing blocks arch"        checks "pnpm --dir server arch"                  "$ROOT/does-not-exist-xyz-19" 2

  TMPCWD=$(mktemp -d) || TMPCWD=""
  if [ -n "$TMPCWD" ]; then
    runj "T14 json cwd mktemp blocks pnpm test" checks "pnpm --dir server test" "$TMPCWD" 2
    rm -rf "$TMPCWD"
  else
    printf 'FAIL  %s (could not create the mktemp cwd)\n' "T14 json cwd mktemp blocks pnpm test"
    fails=$((fails + 1))
  fi

  # -- T14: no `cwd` field in the JSON falls back to the hook process's own cwd --
  runj_hostcwd "T14 no cwd field, hostcwd root allows self-test"   checks ".claude/hooks/scope-guard.sh self-test" "$ROOT"        0
  runj_hostcwd "T14 no cwd field, hostcwd server blocks self-test" checks ".claude/hooks/scope-guard.sh self-test" "$ROOT/server" 2

  # -- T14: CLAUDE_PROJECT_DIR unset falls back to the root resolved from $SELF --
  out=$( (unset CLAUDE_PROJECT_DIR; cd "$ROOT" && printf '{"tool_input":{"command":".claude/hooks/scope-guard.sh self-test"}}' | "$SELF" bash checks) 2>&1 )
  rc=$?
  if [ "$rc" = "0" ]; then printf 'ok    %s\n' "T14 CLAUDE_PROJECT_DIR unset, root via SELF"
  else printf 'FAIL  %s (rc=%s out=%s)\n' "T14 CLAUDE_PROJECT_DIR unset, root via SELF" "$rc" "$out"; fails=$((fails + 1)); fi

  # -- T14: full dispatch blocks with the "run from the repo root" message on stderr --
  out=$( (cd "$ROOT/server" && printf '{"tool_input":{"command":".claude/hooks/scope-guard.sh self-test"}}' | "$SELF" bash checks) 2>&1 )
  rc=$?
  if [ "$rc" = "2" ] && printf '%s' "$out" | grep -q "run from the repo root"; then
    printf 'ok    %s\n' "T14 full dispatch cwd server blocked with message"
  else
    printf 'FAIL  %s (rc=%s out=%s)\n' "T14 full dispatch cwd server blocked with message" "$rc" "$out"; fails=$((fails + 1))
  fi

  # -- T15 (S20 argument allowlists): checks allows --
  runb "T15 test bare"                checks "pnpm --dir server test"                                              1
  runb "T15 test CI"                  checks "CI=1 pnpm --dir client test"                                         1
  runb "T15 test path filter"         checks "pnpm --dir server test test/x.test.ts"                               1
  runb "T15 exec vitest run -t"       checks "pnpm --dir server exec vitest run test/x.test.ts -t 'name'"          1
  runb "T15 exec vitest reporter"     checks "pnpm --dir server exec vitest run --reporter=verbose"                1
  runb "T15 exec tsc noEmit -p"       checks "pnpm --dir server exec tsc --noEmit -p tsconfig.json"                1
  runb "T15 exec eslint max-warn"     checks "pnpm --dir client exec eslint src --max-warnings 0"                  1
  runb "T15 exec depcruise -T"        checks "pnpm --dir server exec depcruise src --config .dependency-cruiser.cjs -T err-long" 1

  # -- T15: checks blocks --
  runb "T15 test --config"            checks "pnpm --dir server test --config src/db/seed.ts"                      0
  runb "T15 test --root"              checks "pnpm --dir server test --root clones/x"                              0
  runb "T15 lint -c"                  checks "pnpm --dir client lint -c x.mjs"                                     0
  runb "T15 arch --config"            checks "pnpm --dir server arch --config x.cjs"                               0
  runb "T15 typecheck extra arg"      checks "pnpm --dir server typecheck --generateTrace t"                       0
  runb "T15 vitest reporter path"     checks "pnpm --dir server exec vitest run --reporter=./x.js"                 0
  runb "T15 vitest pool path"         checks "pnpm --dir server exec vitest run --pool=./x.js"                     0
  runb "T15 vitest path in clones"    checks "pnpm --dir server exec vitest run clones/x"                          0
  runb "T15 vitest path traversal"    checks "pnpm --dir server exec vitest run ../client"                        0
  runb "T15 depcruise webpack-config" checks "pnpm --dir server exec depcruise src --webpack-config w.js"          0
  runb "T15 depcruise cache"          checks "pnpm --dir server exec depcruise src --cache"                        0
  runb "T15 depcruise bad -T"         checks "pnpm --dir server exec depcruise src -T dot"                         0
  runb "T15 eslint formatter path"    checks "pnpm --dir client exec eslint -f ./fmt.js src"                       0
  runb "T15 eslint path in clones"    checks "pnpm --dir server exec eslint clones/x/a.js"                         0
  runb "T15 tsc extra flag"           checks "pnpm --dir server exec tsc --noEmit --generateCpuProfile p"          0

  # -- T17 (S25): stdin-fed shells and write flags the rev 6 verifier found --
  runb "T17 pipe into bash"           readonly "cat server/clones/x/y.sh | bash"                                  0
  runb "T17 pipe into sh (checks)"    checks   "printf hi | sh"                                                   0
  runb "T17 bash -s"                  readonly "cat x.sh | bash -s"                                               0
  runb "T17 bash < file"              readonly "bash < server/clones/x/y.sh"                                      0
  runb "T17 bash --rcfile"            readonly "bash --rcfile x.sh -c true"                                       0
  runb "T17 bash -c still recursed"   readonly "bash -c \"git status --short\""                                   1
  runb "T17 bash -c bad inner"        readonly "bash -c \"git push\""                                             0
  runb "T17 sed -I (BSD in-place)"    readonly "sed -I .bak s/a/b/ f"                                             0
  runb "T17 sed -ni cluster"          readonly "sed -ni s/a/b/p f"                                                0
  runb "T17 sed -nf cluster"          readonly "sed -nf s.sed f"                                                  0
  runb "T17 sed -nE still allowed"    readonly "sed -nE 1,5p f"                                                   1
  runb "T17 sort -o attached"         readonly "sort -oout.txt f"                                                 0
  runb "T17 sort -ro cluster"         checks   "sort -ro out.txt f"                                               0
  runb "T17 sort -rn still allowed"   readonly "sort -rn f"                                                       1
  runb "T17 uniq in out"              readonly "uniq f out.txt"                                                   0
  runb "T17 uniq -f N in out"         readonly "uniq -f 1 f out.txt"                                              0
  runb "T17 uniq one operand allowed" readonly "uniq -c f"                                                        1
  runb "T17 sort | uniq allowed"      readonly "sort f | uniq -c"                                                 1

  # -- T10 (S8 hardening) / S16: write policy checked on the symlink-resolved path too --
  # A throwaway fake project root (mktemp -d), not the real repo tree, so a crashed run
  # can no longer leave a stray symlink under server/test/. write_eval computes both the
  # logical and symlink-resolved relative path from CLAUDE_PROJECT_DIR, so pointing that
  # at the fake root exercises the same resolution without touching the repo at all.
  FAKE_ROOT=$(mktemp -d) || FAKE_ROOT=""
  if [ -n "$FAKE_ROOT" ]; then
    trap 'rm -rf "$FAKE_ROOT"' RETURN
    mkdir -p "$FAKE_ROOT/server/test" "$FAKE_ROOT/server/src"
    ln -s ../src "$FAKE_ROOT/server/test/link"
    CLAUDE_PROJECT_DIR="$FAKE_ROOT" runw "T10 symlink escapes to src" tests "server/test/link/app.ts" 0
    CLAUDE_PROJECT_DIR="$FAKE_ROOT" runw "T10 symlink positive control" tests "server/test/x.test.ts" 1
    rm -rf "$FAKE_ROOT"
    trap - RETURN
  else
    printf 'FAIL  %s (could not create the fake project root)\n' "T10 symlink escapes to src"
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
      *) block_msg "write" "$SUB" "misconfigured scope-guard: unknown write profile '$SUB' (expected tests|docs) — a configuration fault in the calling agent's frontmatter, not a runtime error"; exit 2 ;;
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
      *) block_msg "bash" "$SUB" "misconfigured scope-guard: unknown bash profile '$SUB' (expected readonly|checks) — a configuration fault in the calling agent's frontmatter, not a runtime error"; exit 2 ;;
    esac
    # Project root for the S19 cwd guard: $CLAUDE_PROJECT_DIR, else this hook's own repo.
    # Neither resolving is an INTERNAL error (fail-open), never the input cwd itself.
    ROOT_FOR_CALL="${CLAUDE_PROJECT_DIR:-}"
    if [ -z "$ROOT_FOR_CALL" ]; then ROOT_FOR_CALL="$(cd "$(dirname "$SELF")/../.." 2>/dev/null && pwd)"; fi
    if [ -z "$ROOT_FOR_CALL" ]; then
      warn "could not resolve the project root for the cwd guard — allowing (fail-open)"
      allow
    fi
    RAW=$(cat) || allow
    REASON=$(printf '%s' "$RAW" | bash_eval "$SUB" json "$ROOT_FOR_CALL"); RC=$?
    case "$RC" in
      1) allow ;;
      3) allow ;; # node already warned on stderr (fail-open)
      0) block_msg "bash" "$SUB" "$REASON"; exit 2 ;;
      *) warn "internal error (exit $RC) on the bash path — allowing"; allow ;;
    esac
    ;;
  self-test) self_test ;;
  *) block_msg "mode" "${1:-}" "misconfigured scope-guard: unknown mode '${1:-}' (expected write|bash|self-test) — a configuration fault in the calling agent's frontmatter, not a runtime error"; exit 2 ;;
esac
