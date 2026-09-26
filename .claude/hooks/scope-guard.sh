#!/usr/bin/env bash
# scope-guard.sh — shared PreToolUse hook, parametrized by profile, wired from the
# `hooks:` block of six subagent files: test-writer.md, architecture-reviewer.md,
# plan-verifier.md, doc-writer.md, retro-writer.md, harness-analyst.md
# (.claude/agents/*.md), per docs/plans/review-agents.plan.md,
# docs/plans/retro-agent.plan.md and docs/plans/harness-retros.plan.md.
#
# Two axes, six call shapes:
#   scope-guard.sh write tests    — PreToolUse(Write|Edit|NotebookEdit) for test-writer
#   scope-guard.sh write docs     — PreToolUse(Write|Edit|NotebookEdit) for doc-writer
#   scope-guard.sh write retro    — PreToolUse(Write|Edit|NotebookEdit) for retro-writer
#   scope-guard.sh write analysis — PreToolUse(Write|Edit|NotebookEdit) for harness-analyst
#   scope-guard.sh bash readonly  — PreToolUse(Bash) for doc-writer, retro-writer,
#                                    harness-analyst
#   scope-guard.sh bash checks    — PreToolUse(Bash) for test-writer, architecture-reviewer,
#                                    plan-verifier
#   scope-guard.sh self-test      — path matrix + command matrix, exit 0 iff every case is right
#
# RETRO (write retro): scope is exactly .harness/retros/<feature>.retro.md, one allow glob
# with no nesting (.harness/retros/*.retro.md, not **/*.retro.md), plus named denies for
# the old location docs/plans/*.retro.md, docs/plans/*.plan.md and **/INSIGHTS.md so a
# block explains itself. Append-only is mechanical, not a list of forbidden edits: `Write`
# only when the target does not exist yet, `Edit` only when `old_string` is exactly one of
# the two marker lines, `new_string` starts with that marker followed by a newline and
# contains it exactly once, and `replace_all` is not `true` — see retroPolicy below.
# `write docs` is untouched: it still denies all of docs/plans/** (retro files included),
# so the two profiles cannot both claim the same path. The file name must not start with a
# dot (no empty or hidden name) — retro and analysis only, one shared predicate below.
#
# ANALYSIS (write analysis): scope is exactly .harness/analysis/<date>.md, one allow glob
# with no nesting, plus named denies for .harness/retros/**, .claude/**, AGENTS.md,
# CLAUDE.md and INSIGHTS.md (harness files change only through the main session after the
# user's decision). Write-once, not append-only: `Write` only when the target does not
# exist yet; every other tool (`Edit`, `NotebookEdit`, a missing `tool_name`) is blocked, so
# a written analysis file never drifts. Neither `write docs` nor `write tests` allows
# anything under `.harness/**` (both deny it by default — no path in either allow list
# starts with `.harness/`), so the four write profiles never claim the same path. The file
# name must not start with a dot (no empty or hidden name) — same shared predicate as
# retro, above.
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
# RESOLVER (P5): one resolver (RESOLVER_JS below, holding the only `function
# realpathNearest`) judges every path either evaluator touches — write targets, pnpm path
# arguments, `--dir`/`-C` values, the path inside a `CHECKS_EXACT` command. It counts only
# symlink hops against its hop limit, never parent steps, and returns a failure marker
# instead of throwing on a loop or a too-deep chain. A path it cannot resolve is a
# POLICY-DENY ("path could not be resolved"), never fail-open.
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
# EXIT PROTOCOL (P5): both evaluators allow by exiting exactly one code, SG_ALLOW_RC (42,
#   defined once below and never re-typed), for "allowed" and for both fail-open cases
#   above, always after their stderr warning. A deny writes its reason to stdout and exits
#   0 from node. The dispatcher below allows only on SG_ALLOW_RC; exit 0 blocks with the
#   reason, and any other evaluator exit is denied — node's uncaught-exception code 1, the
#   old fail-open code 3, 127 for a missing node, and 128+n for a kill all block loudly
#   instead of allowing.
#
# TOKENIZER PROVENANCE: the shell tokenizer below (stripHeredocs / segments / tokens /
# VALUE_FLAGS / shell-invoker recursion) is copied from the `blocked_rule`
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
# is rejected if it starts with `~` or contains `$`, `*`, `?` or `[`, or if absolute; otherwise
# it is resolved through the shared resolver (RESOLVER) against `<root>/<dir>` and must land
# inside that resolved directory and outside the resolved `<root>/server/clones` — a symlink
# planted under the package dir that points into `server/clones` (or elsewhere) is judged on
# where it actually points, not on its lexical spelling. The same resolver requires each
# `--dir`/`-C` value to resolve to exactly `<rootReal>/<name>`, and requires the path inside a
# `CHECKS_EXACT` command to resolve to exactly `<rootReal>/.claude/hooks/<file>`. Widening any
# of these is one table edit plus a T15/P5 self-test case, never a switch back to a denylist.
#
# PER-HEAD ARGUMENT GRAMMAR (P4): every head admitted by `bash readonly`/`bash checks` (git
# subcommands included) is judged by one grammar table — `HEAD_ARGS` for plain commands,
# `GIT_ARGS` per git subcommand — instead of a per-spelling patch list (`sort -o`, `sed -i`,
# `rg --pre`, ... one denylist entry per bypass found). Each table entry states: boolean
# short flags (checked as a cluster), value short flags (attached or the next token), exact
# long flags only (an abbreviated long, e.g. `--out=` for `--output=`, is rejected — no
# prefix match), and an operand policy. `find` and `sed` do not fit that shape and get their
# own small checker (`findArgsOk`, `sedArgsOk`); `sed` in particular admits only `-n`/`-nE`/
# `-En` with one `N,Mp`/`$p` script, so a write command (`w`/`W`/`e`) can never parse as that
# script at all. A head is a bare command name — one containing `/` is rejected outright,
# except the literal `CHECKS_EXACT` strings. A shell invoker (`bash`/`sh`/`zsh`/`dash`) is
# admitted only as exactly `-c <program>`, recursed into once; `eval` has no `-c` and joins
# all of its operands with one space into the single command it evaluates. Widening a head
# grammar is one table edit plus one `P4` allowed row and one blocked row, never a switch
# back to a denylist.
#
# LEXER (P4): the grammar above judges tokens the tokenizer already understands — the
# tokenizer itself only understands single/double quoting, nothing more. A word the
# tokenizer does not model is rejected, checked before any other rule (CHECKS_EXACT
# included) and at every recursion depth (`bash -c`, `eval`): a `\`-escape or a `$`
# outside single quotes (covering `\-flag`, `$'…'`, `$"…"`, `$VAR`, `${VAR}` and any `$`
# inside double quotes — single-quoted text stays literal in bash, so `\`/`$` there are
# fine), a segment made only of `NAME=value` assignments (a leading assignment prefix is
# admitted only as the exact token `CI=1`, immediately followed by a command), and a word
# holding an unquoted glob character at any position — S13/rev 4 replaces the earlier
# leading-character rule: an unquoted `*`, `?` or `[` anywhere in the word is rejected,
# whatever precedes it (a literal, an empty quote pair such as `''*`, or another quoted
# part), because such a glob can expand to a `-`-leading file name; quote concatenation
# does not reset the flag, and a glob character inside quotes stays unaffected. It also
# holds an unquoted `>`/`<` glued to the middle of a word, outside the leading
# digit*+operator prefix (`2>&1`, `>>`, `<`) the redirection checks below already model —
# the tokenizer only splits on whitespace, so a redirection with no surrounding space
# (`f>g`, `x</dev/tcp/h/80`) would otherwise reach them as one unrecognised operand
# instead of a redirection token; a quoted `>`/`<` stays literal data. Widening
# the lexer is not a table edit — it is a change to what the
# tokenizer itself understands, and is out of scope here (O3).
set -uo pipefail

SELF="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/$(basename "${BASH_SOURCE[0]:-$0}")"

# The single explicit allow code (see the EXIT PROTOCOL block above). Both node -e
# evaluators below read it from the environment and exit with it for "allowed" and for a
# fail-open; the dispatcher case blocks compare against it, never a re-typed literal.
SG_ALLOW_RC=42
export SG_ALLOW_RC

warn() { printf 'scope-guard: %s\n' "$*" >&2; }
allow() { exit 0; }

block_msg() { # profile-kind, sub-profile, reason
  printf 'BLOCKED by scope-guard (%s %s): %s\n' "$1" "$2" "$3" >&2
  printf 'Allowed under `%s %s`: see the allow-lists in the header/body of %s\n' "$1" "$2" "$SELF" >&2
  printf 'Record the need under "Production changes needed" / "Proposed edits" in your report.\n' >&2
}

# ---------------------------------------------------------------------------------------
# RESOLVER_JS (P5): the ONE resolver, spliced at the head of both the bash_eval and the
# write_eval node -e programs by variable reference. It requires fs and path to already be
# required by the program it is spliced into. It counts a hop only when it follows a
# symlink, never on a plain parent step, and returns null (a failure marker) instead of
# throwing on a loop or a chain over the hop limit, so a deep non-existent path never
# fails open the way a throw-based resolver did.
# ---------------------------------------------------------------------------------------
RESOLVER_JS='
    function realpathNearest(p, depth) {
      depth = depth || 0;
      if (depth > 40) return null;
      try { return fs.realpathSync(p); }
      catch {
        let st = null;
        try { st = fs.lstatSync(p); } catch {}
        if (st && st.isSymbolicLink()) {
          let target; try { target = fs.readlinkSync(p); } catch { return null; }
          return realpathNearest(path.resolve(path.dirname(p), target), depth + 1);
        }
        const parent = path.dirname(p);
        if (parent === p) return p;
        const r = realpathNearest(parent, depth);
        if (r === null) return null;
        return path.join(r, path.basename(p));
      }
    }

    // Requires a resolved ROOT (rootReal) already in scope where called. relPath resolves
    // to exactly rootReal/relPath -- a symlink anywhere in that chain that lands somewhere
    // else, or a resolver failure, both count as "does not resolve".
    function resolvesToExact(rootReal, relPath) {
      if (!rootReal) return false;
      const expect = path.join(rootReal, relPath);
      const actual = realpathNearest(expect);
      return actual !== null && actual === expect;
    }
'

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
# Exit codes (P5/S13): 0 = blocked (reason on stdout), SG_ALLOW_RC = allowed, also
# SG_ALLOW_RC for the internal-error fail-open (node already wrote the warning to stderr).
# Any other exit (node's own uncaught-exception code 1, a kill, a missing node) is denied by
# the dispatcher below, never treated as allowed.
# ---------------------------------------------------------------------------------------
bash_eval() {
  node -e "$RESOLVER_JS"'
    const fs = require("fs");
    const path = require("path");
    const ALLOW_RC = Number(process.env.SG_ALLOW_RC);
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
          process.exit(ALLOW_RC);
        }
        cmd = String(j?.tool_input?.command ?? "");
        const inputCwd = typeof j?.cwd === "string" ? j.cwd : null;
        cwdInfo = resolveCwd(inputCwd !== null ? inputCwd : process.cwd(), ROOT);
      } else {
        cmd = String(b);
        cwdInfo = resolveCwd(EXPLICIT_CWD !== undefined ? EXPLICIT_CWD : ROOT, ROOT);
      }
      // Any exception while evaluating a parsed command is a POLICY-DENY, never the default
      // uncaught-exception exit of node (exit 1, which is NOT SG_ALLOW_RC, so an uncaught
      // exception is already denied by the dispatcher exit protocol) and never fail-open.
      let r;
      try { r = evalCmd(cmd, PROFILE, cwdInfo, ROOT); }
      catch (e) {
        r = "internal error while evaluating the command (" + (e && e.message) + ") — denied";
      }
      if (r) { process.stdout.write(r); process.exit(0); }
      process.exit(ALLOW_RC);
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

    function evalCmd(cmd, profile, cwdInfo, root) {
      const raw = String(cmd);
      if (hasCommandSub(heredocAwareScrub(raw))) {
        return "rejected: command substitution (a \x60backtick\x60 or $(...) outside single quotes) is not allowed";
      }
      let s = stripHeredocs(raw);
      s = s.replace(/\\\r?\n/g, " ").replace(/\r?\n/g, ";");
      for (const seg of segments(s)) { const r = segVerdict(seg, profile, cwdInfo, root); if (r) return r; }
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

    // P4 lexer (rev 4/S13): each token also records `bad` (it held a "\" or "$" outside
    // single quotes -- single-quoted text is literal in bash, so those stay unmarked there)
    // and `glob` (it held an unquoted "*", "?" or "[" AT ANY POSITION, which can expand to
    // a "-"-leading file name). `glob` is a per-word flag that, once set, is never cleared
    // by anything else in the word -- not a following quote, not an empty quote pair such
    // as "\x27\x27*" -- so quote concatenation cannot reset it (rev 3 bug: a `first`
    // character flag was reset by any quote mark, so "\x27\x27*" passed). This models only
    // what the tokenizer itself understands; anything it cannot model (an escape, an
    // expansion, an unquoted glob character) is a lexer rejection, not a per-spelling
    // patch.
    //
    // `redir` (quick fix, same invariant): it held an unquoted "\x3e"/"\x3c" glued to the
    // middle of the word, with no whitespace around it -- the ONE shape checkRedirection/
    // checkInputRedirection cannot see, because both only match a token that STARTS with a
    // digit*+operator prefix ("\x3e", "2\x3e", "\x3e\x3e", "\x3c", ...), never a token whose
    // operator sits after a literal prefix ("x\x3eserver/src/a.ts", "f\x3eg"). The prefix
    // itself (leading digits, then a run of "\x3e"/"\x3c"/"&" building the operator, e.g.
    // "2\x3e&1") stays admitted -- it is exactly what the redirection checks below already
    // model and validate against their /dev/null and fd-dup allowlist.
    function tokens(seg) {
      const out = []; let cur = "", q = null, quoted = false, bad = false, glob = false, redir = false;
      for (const c of seg) {
        if (q) {
          if (c === q) { q = null; continue; }
          if (q === "\"" && (c === "\\" || c === "$")) bad = true;
          cur += c; continue;
        }
        if (c === "\x27" || c === "\"") { q = c; quoted = true; continue; }
        if (/\s/.test(c)) {
          if (cur || quoted) { out.push({ v: cur, quoted, bad, glob, redir }); cur = ""; quoted = false; bad = false; glob = false; redir = false; }
          continue;
        }
        if (c === "\\" || c === "$") bad = true;
        if (c === "*" || c === "?" || c === "[") glob = true;
        if ((c === ">" || c === "<") && !/^\d*[<>&]*$/.test(cur)) redir = true;
        cur += c;
      }
      if (cur || quoted) out.push({ v: cur, quoted, bad, glob, redir });
      return out;
    }

    // Flags that take a value, so the value is not mistaken for the pnpm script. The git
    // entry that used to live here was only consumed by positional(), which the P4 rewrite
    // removed along with the per-head git branch it served — the git global-option and
    // subcommand parsing (gitSubcommand, below) no longer needs it.
    const VALUE_FLAGS = {
      pnpm: ["--dir", "-C", "--filter", "-F"],
    };

    // Redirection to anything but /dev/null or a fd dup (2>&1) is rejected, whether the
    // operator and target sit in one token (2>/dev/null) or two (> f, > /dev/null).
    function checkRedirection(t) {
      for (let i = 0; i < t.length; i++) {
        if (t[i].quoted) continue; // a quoted operator is literal data, not a redirection
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

    // C6 shared rule: input redirection from a /dev/ path other than /dev/null is
    // rejected (cat < /dev/tcp/h/80 opens a network socket, not a file read).
    function checkInputRedirection(t) {
      for (let i = 0; i < t.length; i++) {
        if (t[i].quoted) continue; // a quoted operator is literal data, not a redirection
        const v = t[i].v;
        const m = /^(\d*)(<{1,3})(.*)$/.exec(v);
        if (!m) continue;
        let target = m[3];
        if (target === "") target = i + 1 < t.length ? t[i + 1].v : "";
        if (target.indexOf("/dev/") === 0 && target !== "/dev/null") {
          return "input redirection from `" + target + "` (only /dev/null or a plain file is allowed)";
        }
      }
      return null;
    }

    // Rejected in ANY segment, regardless of profile — see the plan Decisions table. This
    // is the global floor (P4/C6), not a per-head spelling list: `sort -o` is now closed by
    // the HEAD_ARGS grammar below (sort has no "o" in its bool or value set), not by a
    // dedicated regex here. The redirection check runs earlier in segVerdict, ahead of the
    // CHECKS_EXACT comparison, so it is not repeated here.
    function preReject(t) {
      for (const tok of t) {
        const v = tok.v;
        if (v === "--fix") return "`--fix`";
        if (v === "-u" || v === "--update") return "`-u`/`--update`";
        if (v === "--write") return "`--write`";
        if (v.indexOf("--output") === 0) return "`--output*`";
        if (v === "tee") return "`tee`";
        if (v === "xargs") return "`xargs`";
      }
      return null;
    }

    // "cd" (and pushd/popd/builtin/command, never allow-listed) is deliberately absent from
    // every table below: a head that re-points every later relative path is not a
    // read-only command (S19).
    //
    // P4/C6: one argument grammar per head, checked as clusters/attached-or-next values/
    // exact longs/an operand policy — not a per-spelling denylist. A head not present in
    // HEAD_ARGS (and not git/find/sed/a shell invoker/docker/pnpm) is simply not on the
    // allow-list, same as before. Widening a head grammar is one table edit plus one P4
    // allowed row and one blocked row (C6).
    //
    // Per head: bool = string of boolean short-flag letters, checked as a cluster
    // ("-rtl" ok if r/t/l are all bool); value = string of value short-flag letters, taken
    // attached ("-k2") or, if nothing remains in the token, from the next token ("-k 2");
    // in a cluster the value letter may only be last, everything before it must be bool.
    // numeric: true admits a bare "-<digits>" token (head/tail/git log). longsExact: a Set
    // of exact long-flag spellings admitted with NO argument, or fixed "flag=value"
    // spellings enumerated in full (git status --porcelain[=v1|v2] is three entries:
    // "--porcelain", "--porcelain=v1", "--porcelain=v2"). longsPrefix: a Set of
    // "--flag=" prefixes admitted with ANY value attached after "=" — the shared rule is
    // "--long=value only for value longs", so a long value flag is never accepted as two
    // separate tokens, only as one "--flag=value" token. longsExtra: a small map of a
    // longsExact flag to the count of further tokens it consumes verbatim (jq --arg <n> <v>
    // takes 2). dashdash: true admits a literal "--" to end flag parsing (git subcommands).
    // operand: "none" (no operand token at all), "atmost1" (uniq — a second operand writes
    // a file), otherwise any non-flag token is accepted (paths/patterns/sets/names — this
    // grammar is a Bash-execution boundary, not a full CLI validator, so it does not also
    // require every operand to look like a path).
    function isBoolChar(spec, c) { return spec.bool.indexOf(c) !== -1; }
    function isValueChar(spec, c) { return spec.value.indexOf(c) !== -1; }

    // A short token "-xyz": every letter before the last must be boolean; the last letter
    // may be boolean too, or a value flag whose value is the remainder of the token (if
    // any) or the next token (if the token ends right on that letter).
    function shortClusterOk(spec, tok) {
      const chars = tok.slice(1);
      if (!chars.length) return { ok: false };
      for (let i = 0; i < chars.length; i++) {
        const c = chars[i];
        if (isBoolChar(spec, c)) continue;
        if (isValueChar(spec, c)) return { ok: true, needsNext: i === chars.length - 1 };
        return { ok: false };
      }
      return { ok: true, needsNext: false };
    }

    function longFlagOk(spec, tok) {
      if (spec.longsExact && spec.longsExact.has(tok)) return true;
      const eq = tok.indexOf("=");
      if (eq !== -1 && spec.longsPrefix) {
        const prefix = tok.slice(0, eq + 1);
        if (spec.longsPrefix.has(prefix)) return true;
      }
      return false;
    }

    // The one shared grammar checker, used by every HEAD_ARGS entry and every GIT_ARGS
    // subcommand. argsArr is a plain array of token strings, redirection tokens already
    // stripped by the caller.
    function argsGrammarOk(spec, argsArr) {
      let i = 0;
      let sawDashDash = false;
      let operands = 0;
      while (i < argsArr.length) {
        const v = argsArr[i];
        if (v === "--") {
          if (!spec.dashdash) return false;
          sawDashDash = true;
          i++;
          continue;
        }
        if (!sawDashDash && v.length > 2 && v.slice(0, 2) === "--") {
          // C6 long-flag arity (rev 3): "--x <v>" accepts "--x=v" (attached, exact name
          // only -- no abbreviation) or "--x v" (the next token, consumed verbatim). A
          // valueLongs flag with no value at all (dangling last token) is rejected.
          const eq = v.indexOf("=");
          const bareName = eq !== -1 ? v.slice(0, eq) : v;
          if (spec.valueLongs && spec.valueLongs.has(bareName)) {
            if (eq !== -1) { i++; continue; }
            i++;
            if (i >= argsArr.length) return false;
            i++;
            continue;
          }
          if (!longFlagOk(spec, v)) return false;
          const extra = spec.longsExtra && spec.longsExtra[v];
          i += extra ? 1 + extra : 1;
          if (i > argsArr.length) return false;
          continue;
        }
        if (!sawDashDash && v.length > 1 && v[0] === "-") {
          if (spec.numeric && /^-\d+$/.test(v)) { i++; continue; }
          const res = shortClusterOk(spec, v);
          if (!res.ok) return false;
          i++;
          if (res.needsNext) { if (i >= argsArr.length) return false; i++; }
          continue;
        }
        if (spec.operand === "none") return false;
        operands++;
        if (spec.operand === "atmost1" && operands > 1) return false;
        i++;
      }
      return true;
    }

    const HEAD_ARGS = {
      ls:       { bool: "aAlhRtrSd1Fis", value: "", longsExact: new Set(["--all"]), operand: "any" },
      cat:      { bool: "nbsvetAET", value: "", operand: "any" },
      head:     { bool: "q", value: "nc", numeric: true, operand: "any" },
      tail:     { bool: "q", value: "nc", numeric: true, operand: "any" },
      wc:       { bool: "lwcm", value: "", operand: "any" },
      diff:     { bool: "qruNbwBisy", value: "U", longsExact: new Set(["--brief", "--recursive"]), longsPrefix: new Set(["--unified="]), operand: "any" },
      cmp:      { bool: "slb", value: "", operand: "any" },
      sort:     { bool: "rnfhVbdgMmsc", value: "kt", operand: "any" },
      uniq:     { bool: "cdi", value: "fsw", operand: "atmost1" },
      cut:      { bool: "s", value: "dfcb", operand: "any" },
      tr:       { bool: "dscC", value: "", operand: "any" },
      jq:       { bool: "rcesnjSa", value: "", longsExact: new Set(["--raw-output", "--compact-output", "--slurp", "--null-input", "--tab", "--arg", "--argjson"]), longsExtra: { "--arg": 2, "--argjson": 2 }, valueLongs: new Set(["--indent"]), operand: "any" },
      stat:     { bool: "Lx", value: "cf", longsPrefix: new Set(["--format=", "--printf="]), operand: "any" },
      file:     { bool: "biL", value: "", longsExact: new Set(["--mime-type", "--brief"]), operand: "any" },
      pwd:      { bool: "LP", value: "", operand: "none" },
      true:     { bool: "", value: "", operand: "none" },
      basename: { bool: "a", value: "s", operand: "any" },
      dirname:  { bool: "", value: "", operand: "any" },
      realpath: { bool: "emqs", value: "", operand: "any" },
      which:    { bool: "as", value: "", operand: "any" },
      rg:       { bool: "nilcwFvoSHNIsxL", value: "egtTABCm", longsExact: new Set(["--hidden", "--files", "--no-heading", "--heading", "--count", "--files-with-matches", "--line-number", "--fixed-strings", "--ignore-case", "--smart-case", "--word-regexp", "--invert-match", "--only-matching", "--no-ignore", "--json", "--trim", "--color=never"]), valueLongs: new Set(["--glob", "--type", "--max-count", "--sort", "--context", "--max-columns"]), operand: "any" },
      grep:     { bool: "nilLcwFEvorRHhqsxI", value: "eABCm", longsExact: new Set(["--color=never"]), longsPrefix: new Set(["--include=", "--exclude=", "--exclude-dir="]), operand: "any" },
    };

    // `find` and `sed` do not fit the flag-cluster shape above (find flags are whole
    // words, sed admits only one exact script form), so each gets its own small checker.
    const FIND_VALUE_FLAGS = new Set(["-name", "-iname", "-path", "-ipath", "-type", "-maxdepth", "-mindepth", "-size", "-mtime", "-newer"]);
    const FIND_BOOL_FLAGS = new Set(["-empty", "-prune", "-print", "-print0", "-not", "!", "-o", "-or", "-a", "-and"]);
    function findArgsOk(argsArr) {
      for (let i = 0; i < argsArr.length; i++) {
        const v = argsArr[i];
        if (FIND_VALUE_FLAGS.has(v)) { i++; if (i >= argsArr.length) return false; continue; }
        if (FIND_BOOL_FLAGS.has(v)) continue;
        if (v.indexOf("-") === 0) return false; // any other predicate (-delete, -exec, ...)
        // a start path — accepted wherever it appears
      }
      return true;
    }

    // sed: `-n`/`-nE`/`-En` exactly, then exactly one script matching the print-only
    // regex, then plain paths — no further flags. This is stricter than (and replaces) the
    // old sedScriptUnsafe heuristic: nothing but a bare "Np"/"$p"/"N,Mp" script is ever
    // admitted, so a write command (w/W/e) or a substitution can never match at all.
    const SED_FLAG_FORMS = new Set(["-n", "-nE", "-En"]);
    const SED_SCRIPT_RE = /^(\d+|\$)(,(\d+|\$))?p$/;
    function sedArgsOk(argsArr) {
      if (argsArr.length < 2) return false;
      if (!SED_FLAG_FORMS.has(argsArr[0])) return false;
      if (!SED_SCRIPT_RE.test(argsArr[1])) return false;
      for (let i = 2; i < argsArr.length; i++) {
        if (argsArr[i].indexOf("-") === 0) return false;
      }
      return true;
    }

    // echo/printf/test (C6, rev 3) do not fit the flag-cluster shape either: echo/printf
    // parse a leading flag run and then treat EVERY remaining word as data (never rejected,
    // "---" included), and test has its own tiny unary/binary grammar.
    function echoArgsOk(argsArr) {
      let i = 0;
      while (i < argsArr.length && /^-[nEe]+$/.test(argsArr[i])) i++;
      return true; // the first non-cluster word ends flag parsing; every later word is data
    }
    function printfArgsOk(argsArr) {
      if (argsArr.length && argsArr[0].indexOf("-") === 0) return false; // no -v
      return true; // format word plus every later word is data, unrestricted
    }
    const TEST_UNARY = new Set(["-f", "-d", "-e", "-s", "-n", "-z"]);
    function testArgsOk(argsArr) {
      for (const v of argsArr) {
        if (v === "!" || v === "=" || v === "!=") continue;
        if (TEST_UNARY.has(v)) continue;
        if (v.indexOf("-") === 0) return false; // any other "-"-word is rejected
      }
      return true;
    }

    // Dispatched by lookup in segVerdict, not by a per-head equality branch — these are
    // the heads whose grammar does not fit the HEAD_ARGS cluster shape.
    const CUSTOM_HEAD_CHECKS = { find: findArgsOk, sed: sedArgsOk, echo: echoArgsOk, printf: printfArgsOk, test: testArgsOk };

    // GIT_ARGS: one entry per admitted git subcommand (P4/C6). The global option scan
    // (gitSubcommand below) admits only "--no-pager"/"-P" before the subcommand.
    const GIT_ARGS = {
      status:       { bool: "sb", value: "", longsExact: new Set(["--short", "--branch", "--ignored", "--porcelain", "--porcelain=v1", "--porcelain=v2"]), longsPrefix: new Set(["--untracked-files="]), operand: "any", dashdash: true },
      diff:         { bool: "pwM", value: "U", longsExact: new Set(["--stat", "--shortstat", "--numstat", "--name-only", "--name-status", "--cached", "--staged", "--patch", "--ignore-all-space", "--no-color", "--color=never", "--word-diff", "--find-renames", "--quiet", "--exit-code", "--check"]), longsPrefix: new Set(["--unified=", "--diff-filter="]), operand: "any", dashdash: true },
      log:          { bool: "p", value: "nSG", numeric: true, longsExact: new Set(["--oneline", "--stat", "--name-only", "--name-status", "--follow", "--all", "--reverse", "--first-parent", "--no-merges", "--decorate", "--graph"]), longsPrefix: new Set(["--max-count=", "--format=", "--pretty=", "--since=", "--until=", "--author=", "--grep=", "--date=", "--diff-filter="]), operand: "any", dashdash: true },
      show:         { bool: "sp", value: "", longsExact: new Set(["--stat", "--name-only", "--name-status", "--oneline", "--no-patch"]), longsPrefix: new Set(["--format=", "--pretty="]), operand: "any", dashdash: true },
      grep:         { bool: "nilwFEcIhH", value: "e", operand: "any", dashdash: true },
      "ls-files":   { bool: "ocdms", value: "", longsExact: new Set(["--others", "--exclude-standard", "--cached", "--deleted", "--modified", "--error-unmatch", "--stage"]), operand: "any", dashdash: true },
      "rev-parse":  { bool: "q", value: "", longsExact: new Set(["--short", "--abbrev-ref", "--verify", "--show-toplevel", "--is-inside-work-tree"]), longsPrefix: new Set(["--short="]), operand: "any", dashdash: true },
      "merge-base": { bool: "", value: "", longsExact: new Set(["--is-ancestor", "--fork-point", "--all"]), operand: "any", dashdash: true },
      blame:        { bool: "wseM", value: "L", longsExact: new Set(["--porcelain"]), operand: "any", dashdash: true },
      "cat-file":   { bool: "tspe", value: "", operand: "any", dashdash: true },
      "check-ignore": { bool: "qvn", value: "", longsExact: new Set(["--non-matching", "--no-index"]), operand: "any", dashdash: true },
      "hash-object":  { bool: "", value: "", longsExact: new Set(["--no-filters"]), operand: "any", dashdash: true },
    };

    // Scans the leading global options (only --no-pager/-P admitted, per C6) and returns
    // the subcommand token plus the remaining raw args, or null if a disallowed global
    // option sits before the subcommand or there is no subcommand token at all.
    function gitSubcommand(rawArgs) {
      let i = 0;
      while (i < rawArgs.length && (rawArgs[i].v === "--no-pager" || rawArgs[i].v === "-P")) i++;
      if (i >= rawArgs.length) return null;
      const sub = rawArgs[i].v;
      if (sub.indexOf("-") === 0) return null;
      return { sub: sub, rest: rawArgs.slice(i + 1) };
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

    // S20/P5: argument ALLOWLISTS, not per-flag denylists — a denylist over a program with a
    // wide CLI surface only closes the holes its author thought of (vitest --reporter=./x.js,
    // depcruise --webpack-config, eslint -f ./fmt.js all load JS and passed the old --config/
    // -o denylist). A relative path arg is checked once, shared by every target below. It is
    // rejected on sight if it starts with "~" or contains a shell-expansion character
    // ($ * ? [), or is absolute. Otherwise it is resolved through the shared resolver
    // against root/dir and must land inside that resolved directory and outside the
    // resolved root/server/clones — a symlink planted under dir that points elsewhere (into
    // clones, or anywhere else) is judged on where it actually points.
    function pathArgOk(v, root, dir) {
      if (v.indexOf("/") === 0) return false; // absolute
      if (v.indexOf("~") === 0) return false;
      if (/[$*?[]/.test(v)) return false;
      if (!root || !dir) return false;
      let rootReal;
      try { rootReal = fs.realpathSync(root); } catch { return false; }
      const base = path.resolve(rootReal, dir);
      const baseReal = realpathNearest(base);
      if (baseReal === null) return false;
      const targetReal = realpathNearest(path.resolve(base, v));
      if (targetReal === null) return false;
      if (targetReal !== baseReal && targetReal.indexOf(baseReal + path.sep) !== 0) return false;
      const clonesReal = realpathNearest(path.resolve(rootReal, "server", "clones"));
      if (clonesReal !== null) {
        if (targetReal === clonesReal || targetReal.indexOf(clonesReal + path.sep) === 0) return false;
      }
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
    function vitestArgsOk(tokens, root, dir) {
      for (let i = 0; i < tokens.length; i++) {
        const v = tokens[i];
        if (v.indexOf("-") !== 0) { if (!pathArgOk(v, root, dir)) return false; continue; }
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
    function tscArgsOk(tokens, root, dir) {
      let hasNoEmit = false;
      for (let i = 0; i < tokens.length; i++) {
        const v = tokens[i];
        const parts = splitFlagValue(v); const flag = parts[0]; const inline = parts[1];
        if (flag === "--noEmit") { if (inline !== null) return false; hasNoEmit = true; continue; }
        if (flag === "-p" || flag === "--project") {
          const val = inline !== null ? inline : tokens[++i];
          if (!val || !pathArgOk(val, root, dir)) return false;
          continue;
        }
        return false;
      }
      return hasNoEmit;
    }

    // `exec depcruise` takes positional paths under src, --config/-c (only the repo config
    // file — it loads as code), -T err|err-long|text, --include-only <re>.
    function depcruiseArgsOk(tokens, root, dir) {
      for (let i = 0; i < tokens.length; i++) {
        const v = tokens[i];
        if (v.indexOf("-") !== 0) {
          if (!pathArgOk(v, root, dir) || (v !== "src" && v.indexOf("src/") !== 0)) return false;
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
    function eslintArgsOk(tokens, root, dir) {
      for (let i = 0; i < tokens.length; i++) {
        const v = tokens[i];
        if (v.indexOf("-") !== 0) { if (!pathArgOk(v, root, dir)) return false; continue; }
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

    function pnpmAllowed(rawArgs, dirs, root) {
      const stripped = stripRedir(stripDirTokens(rawArgs));
      const dir = dirs[0];
      let i = 0;
      if (stripped[i] === "run") i++;
      const e2eOnly = dirs.length > 0 && dirs.every(function (d) { return d === "e2e"; });
      if (stripped[i] === "exec") {
        if (e2eOnly) return false; // e2e allows only typecheck/lint, never exec
        const target = stripped[i + 1];
        const rest = stripped.slice(i + 2);
        if (target === "vitest") return rest[0] === "run" && vitestArgsOk(rest.slice(1), root, dir);
        if (target === "tsc") return tscArgsOk(rest, root, dir);
        if (target === "eslint") return eslintArgsOk(rest, root, dir);
        if (target === "depcruise") return depcruiseArgsOk(rest, root, dir);
        return false;
      }
      const script = stripped[i];
      const trailing = stripped.slice(i + 1);
      if (script === "test" && !e2eOnly) return vitestArgsOk(trailing, root, dir);
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

    // P4 lexer floor (rev 4/S13): checked before ANY other rule, CHECKS_EXACT included, at
    // every recursion depth (bash -c, eval). A word the tokenizer does not model at all
    // -- an escape, an expansion, an unquoted glob character at any position -- is a lexer
    // rejection, never a per-spelling patch further down.
    function lexerReject(t) {
      for (const tok of t) {
        if (tok.bad) return "a word the tokenizer does not model is rejected (`\\` or `$` outside single quotes): `" + tok.v + "`";
        if (tok.glob) return "an unquoted glob character at any position (`*`, `?`, `[`) is rejected: `" + tok.v + "`";
        if (tok.redir) return "an unquoted `>` or `<` glued to the middle of a word is rejected: `" + tok.v + "`";
      }
      return null;
    }

    function segVerdict(seg, profile, cwdInfo, root) {
      const t = tokens(seg);
      const lexReason = lexerReject(t);
      if (lexReason) return lexReason;
      let i = 0;
      // Leading VAR=value assignment: only the exact token "CI=1" is accepted, and only as
      // a single prefix immediately followed by a command. Any other var/value (NODE_OPTIONS,
      // GIT_*, PAGER, CI=0, CI=-delete, ...) is rejected outright, not silently skipped, and
      // a segment consisting of nothing but assignments (including "CI=1" alone) is rejected
      // too — an assignment with no command behind it is not a read-only invocation.
      if (t.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0].v)) {
        if (t[0].v !== "CI=1") {
          const m = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(t[0].v);
          return "leading `" + m[1] + "=` env assignment is not allowed (only the exact `CI=1` prefix is accepted)";
        }
        i = 1;
      }
      const body = t.slice(i);
      if (!t.length) return null; // blank segment (comment, trailing separator)
      if (!body.length) return "an assignment-only segment is not allowed (a command must follow `CI=1`)";

      // Redirection safety is checked once, ahead of the CHECKS_EXACT comparison below:
      // stripRedir() removes a redirection token (and its separate target token) whether
      // the target is safe or not, so an unsafe target must be caught here first — a safe
      // trailing redirection (2>&1, >/dev/null) is stripped and the command underneath is
      // still judged normally (P4/AC4: `<hook> self-test 2>&1` is admitted this way).
      const redirReason = checkRedirection(body);
      if (redirReason) return "rejected: " + redirReason;
      const inRedirReason = checkInputRedirection(body);
      if (inRedirReason) return "rejected: " + inRedirReason;
      const strippedVals = stripRedir(body.map(function (x) { return x.v; }));
      const canonical = strippedVals.join(" ");
      if (profile === "checks" && CHECKS_EXACT.has(canonical)) {
        if (!(cwdInfo && cwdInfo.ok && cwdInfo.matches)) {
          return "run from the repo root (cwd: " + (cwdInfo ? cwdInfo.value : "unknown") + ")";
        }
        // P5: the path named inside a CHECKS_EXACT command must resolve to exactly
        // rootReal/.claude/hooks/<file> — a symlink planted at that path is judged on
        // where it actually points, not on the fact that its lexical spelling matched.
        const hookTok = strippedVals.find(function (v) {
          return /^\.claude\/hooks\/[^/]+$/.test(v);
        });
        if (hookTok) {
          let rootReal;
          try { rootReal = fs.realpathSync(root); } catch { rootReal = null; }
          if (!resolvesToExact(rootReal, hookTok)) {
            return "`" + hookTok + "` does not resolve to the real hook file (symlink?)";
          }
        }
        return null;
      }

      const pr = preReject(body);
      if (pr) return "rejected: " + pr;

      // P4: a head must be a bare command name. A head containing "/" is rejected outright
      // (server/clones/x/ls, ./cat, /bin/cat) — the exact CHECKS_EXACT strings already
      // returned above, so they never reach this check.
      const rawHead = body[0].v;
      if (rawHead.indexOf("/") !== -1) {
        return "a bare command name is required — `" + rawHead + "` contains `/` (only the exact CHECKS_EXACT commands may)";
      }
      const head = rawHead;

      // Shell invokers (P4/AC2): bash/sh/zsh/dash are admitted only as exactly
      // "<head> -c <program>" — no other flag, no script operand, no extra operand after
      // the program, and no input redirection (checked separately, below, since a bare
      // `bash < f`/`bash <<EOF` has no operand at all and never reaches the length check).
      // eval has no -c form; it joins ALL of its operands with one space and evaluates the
      // result as a single command, so `eval git push` is judged as the one command
      // "git push", not as "git" followed by a separately-judged "push".
      if (["bash", "sh", "zsh", "dash"].includes(head)) {
        const rawArgs = body.slice(1);
        if (rawArgs.some(function (x) { return /^\d*</.test(x.v); })) return "`" + head + "` with input redirection (program read from a file) is not allowed";
        const args = stripRedir(rawArgs.map(function (x) { return x.v; }));
        if (args.length !== 2 || args[0] !== "-c") {
          return "`" + head + "` is only allowed as `" + head + " -c <program>` (no other flag, no script operand, no extra argument)";
        }
        return evalCmd(args[1], profile, cwdInfo, root);
      }
      if (head === "eval") {
        const rawArgs = body.slice(1);
        if (rawArgs.some(function (x) { return /^\d*</.test(x.v); })) return "`eval` with input redirection (program read from a file) is not allowed";
        const args = stripRedir(rawArgs.map(function (x) { return x.v; }));
        if (!args.length) return "`eval` without an operand reads its program from stdin — not allowed";
        return evalCmd(args.join(" "), profile, cwdInfo, root);
      }

      if (head === "git") {
        const rawArgs = body.slice(1);
        // -C/--git-dir/--work-tree/--exec-path point git at another tree entirely — the
        // same class of hole as `cd` (S19): a PR repo under server/clones/** can carry an
        // embedded config that loads on `git -C <that dir> ...`. This stays a dedicated
        // branch (rather than "just missing from GIT_ARGS") because -C is a GLOBAL option
        // that can sit before the subcommand, where gitSubcommand would otherwise treat it
        // as the subcommand token itself. The `-c`/`--config-env`/`--ext-diff` and
        // `grep -O`/`--open-files-in-pager` branches that used to sit here are gone (rev
        // 3): `-c` before the subcommand is already rejected by gitSubcommand (it is not
        // `--no-pager`/`-P` and starts with `-`, so it can never BE the subcommand token),
        // and none of --config-env/--ext-diff/-O/--open-files-in-pager appear in any
        // GIT_ARGS entry, so the per-subcommand grammar already rejects them.
        if (rawArgs.some(x => x.v === "-C" || x.v.indexOf("--git-dir") === 0 || x.v.indexOf("--work-tree") === 0 || x.v.indexOf("--exec-path") === 0)) {
          return "`git -C`/`--git-dir`/`--work-tree`/`--exec-path` (pointing at another tree) is not allowed";
        }
        const parsed = gitSubcommand(rawArgs);
        if (!parsed) return "`git` requires a subcommand after only `--no-pager`/`-P` (no other global option is allowed)";
        const sub = parsed.sub;
        const spec = GIT_ARGS[sub];
        if (!spec) return "`git " + sub + "` is not in the readonly git allow-list (status/diff/log/show/grep/ls-files/rev-parse/merge-base/blame/cat-file/check-ignore/hash-object)";
        const restVals = stripRedir(parsed.rest.map(function (x) { return x.v; }));
        if (!argsGrammarOk(spec, restVals)) {
          return "`git " + sub + "` arguments are not in the allow-list for this subcommand (see GIT_ARGS in the header)";
        }
        return null;
      }
      // find/sed do not fit the HEAD_ARGS cluster shape (see CUSTOM_HEAD_CHECKS above the
      // table) — dispatched by lookup, not a per-head equality branch, same as HEAD_ARGS.
      if (CUSTOM_HEAD_CHECKS[head]) {
        const argsVals = stripRedir(body.slice(1).map(function (x) { return x.v; }));
        if (!CUSTOM_HEAD_CHECKS[head](argsVals)) {
          return "`" + head + "` form is not in the allow-list (see HEAD_ARGS/" + head + " in the header)";
        }
        return null;
      }
      if (HEAD_ARGS[head]) {
        const argsVals = stripRedir(body.slice(1).map(function (x) { return x.v; }));
        if (!argsGrammarOk(HEAD_ARGS[head], argsVals)) {
          return "`" + head + "` arguments are not in the allow-list for this head (see HEAD_ARGS in the header)";
        }
        return null;
      }

      if (profile === "checks") {
        if (head === "docker") {
          // C6: exactly "docker info", no further token — not "docker info" plus any
          // flag/positional that positional() would otherwise have silently dropped.
          if (body.length === 2 && body[1].v === "info") return null;
          return "`docker` is only allowed as exactly `docker info`, no further token";
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
          // P5: each --dir/-C value must resolve to exactly rootReal/<name> — a symlink
          // planted at that name (client -> server/clones/x) is judged on where it
          // actually points, not on the fact that its lexical name is in ALLOWED_DIRS.
          let rootReal;
          try { rootReal = fs.realpathSync(root); } catch { rootReal = null; }
          if (dirs.some(function (d) { return !resolvesToExact(rootReal, d); })) {
            return "`--dir`/`-C` value does not resolve to the real package directory (symlink?)";
          }
          if (pnpmAllowed(rawArgs, dirs, root)) return null;
          return "`" + head + "` script/exec form or its trailing arguments are not in the allowlist (typecheck/lint/arch take no arguments; test/exec vitest run take the vitest arg allowlist; exec tsc/depcruise/eslint take their own — see the header)";
        }
      }

      return "`" + head + "` is not in the `" + profile + "` allow-list";
    }
  ' "$1" "$2" "${3:-}" "${4:-}"
}

# ---------------------------------------------------------------------------------------
# write_eval PROFILE   (PROFILE = tests|docs); stdin = the hook JSON.
# Exit codes (P5/S13): 0 = blocked (reason on stdout) -- this INCLUDES any exception thrown
# while judging the payload (a POLICY-DENY, per S12/P5) -- SG_ALLOW_RC = allowed, also
# SG_ALLOW_RC for the internal-error fail-open (only unparsable hook JSON and an
# unresolvable project root reach this, and node already wrote the warning to stderr). Any
# other exit is denied by the dispatcher below, never treated as allowed.
# ---------------------------------------------------------------------------------------
write_eval() {
  node -e "$RESOLVER_JS"'
    const path = require("path");
    const fs = require("fs");
    const ALLOW_RC = Number(process.env.SG_ALLOW_RC);
    const PROFILE = process.argv[1];
    let b = "";
    process.stdin.on("data", d => (b += d)).on("end", () => {
      try { main(); }
      catch (e) {
        // P5/S12: an exception while judging a write payload (including a non-string
        // file_path, which throws inside path.isAbsolute) is a POLICY-DENY, never
        // fail-open -- write a deny reason and exit 0 from node, so the hook exits 2.
        process.stdout.write("internal error while judging the write (" + (e && e.message) + ") — denied");
        process.exit(0);
      }
    });

    function main() {
      let j;
      try { j = JSON.parse(b); }
      catch {
        process.stderr.write("scope-guard: could not parse hook JSON on the write path — allowing (fail-open)\n");
        process.exit(ALLOW_RC);
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
        process.exit(ALLOW_RC);
      }

      const logical = path.isAbsolute(filePath) ? path.normalize(filePath) : path.resolve(base, filePath);
      // P5: a resolver failure (a symlink loop, a chain over the hop limit) is a
      // POLICY-DENY ("path could not be resolved") — it no longer reaches the fail-open
      // catch below. The hop limit counts only symlink hops, never plain parent steps, so a
      // long but ordinary non-existent path resolves instead of tripping the loop guard.
      const real = realpathNearest(logical);
      if (real === null) {
        process.stdout.write("path could not be resolved");
        process.exit(0);
      }

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

      // Explicit table (S1/C7): an unknown PROFILE throws, which the outer try/catch turns
      // into a POLICY-DENY (S12) — never a silent fall-through into another profile
      // policy, which a two-way ternary would do for any third value, and never fail-open.
      const POLICIES = { tests: testsPolicy, docs: docsPolicy, retro: retroPolicy, analysis: analysisPolicy };
      const policy = POLICIES[PROFILE];
      if (!policy) throw new Error("unknown write profile `" + PROFILE + "`");
      const ctx = {
        toolName: j.tool_name,
        oldString: j?.tool_input?.old_string,
        newString: j?.tool_input?.new_string,
        replaceAll: j?.tool_input?.replace_all,
        exists: fs.existsSync(logical),
      };
      const verdict = policy(rel, ctx) || (relReal !== null ? policy(relReal, ctx) : null);
      if (verdict) { process.stdout.write(verdict); process.exit(0); }
      process.exit(ALLOW_RC);
    }

    // realpathNearest (resolve symlinks on the nearest existing ancestor, since the target
    // file usually does not exist yet — Write is about to create it) lives once, in
    // RESOLVER_JS, spliced at the head of this program.

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

    // RETRO (S1, C7; re-pathed under harness-retros S2): one allow glob plus a default deny,
    // not a list of denied spellings. The old location, docs/plans/*.plan.md and
    // **/INSIGHTS.md get their own named messages so a block explains itself instead of
    // falling into the generic "outside scope" text.
    const RETRO_ALLOW = [".harness/retros/*.retro.md"];
    function retroPathPolicy(rel) {
      if (matchAny(rel, ["docs/plans/*.retro.md"])) {
        return "`" + rel + "` — retro files moved to .harness/retros/";
      }
      if (matchAny(rel, ["docs/plans/*.plan.md"])) {
        return "`" + rel + "` — plans are written by the main session from the planner output";
      }
      if (matchAny(rel, ["**/INSIGHTS.md"])) {
        return "`" + rel + "` — graduate via engineering-insights in the main session";
      }
      if (matchAny(rel, RETRO_ALLOW)) return null;
      return "`" + rel + "` is outside the retro-writer scope (.harness/retros/<feature>.retro.md only)";
    }

    // Append-only mechanics (Decisions -> Append-only mechanics): Write only on create,
    // Edit only when old_string is exactly one marker line and new_string starts with that
    // same marker followed by a newline and contains it exactly once, replace_all not true.
    // old_string covers only the marker line, so no existing entry line can ever be changed
    // or removed by a passing Edit.
    const RETRO_MARKERS = [
      "<!-- newest first: class-labels -->",
      "<!-- newest first: retro-entries -->",
    ];
    function retroAppendOnlyPolicy(ctx) {
      const toolName = ctx.toolName;
      if (toolName === "Write") {
        if (ctx.exists) return "`Write` is blocked — the retro file already exists; use `Edit` on one of the marker lines instead";
        return null;
      }
      if (toolName === "Edit") {
        if (ctx.replaceAll === true) return "`Edit` with `replace_all: true` is blocked — append-only edits target exactly one marker line";
        const oldStr = ctx.oldString;
        if (typeof oldStr !== "string" || RETRO_MARKERS.indexOf(oldStr) === -1) {
          return "`old_string` must be exactly one of the two marker lines (`<!-- newest first: class-labels -->` or `<!-- newest first: retro-entries -->`)";
        }
        const newStr = ctx.newString;
        if (typeof newStr !== "string" || newStr.indexOf(oldStr + "\n") !== 0) {
          return "`new_string` must start with the marker line (`" + oldStr + "`) followed by a newline";
        }
        if (newStr.split(oldStr).length - 1 !== 1) {
          return "`new_string` must contain the marker line exactly once";
        }
        return null;
      }
      return "`" + (toolName || "(missing tool_name)") + "` is not allowed on the retro file — only `Write` (create) and a marker-line `Edit` are";
    }

    // Visible-name invariant (harness-retros rev 2): the basename of rel must not start
    // with a dot. Covers both the empty stem (.harness/retros/.retro.md) and the hidden
    // stem (.harness/retros/.x.retro.md) with one predicate, so ls (no -a) never hides a
    // file from harness-analyst. Composed after the named denies, before the tool
    // invariant, into both retroPolicy and analysisPolicy. The glob compiler, RETRO_ALLOW,
    // ANALYSIS_ALLOW, TESTS_*, DOCS_* stay untouched (retro/analysis only, C6/O8).
    function visibleNamePolicy(rel) {
      const base = rel.slice(rel.lastIndexOf("/") + 1);
      if (base.indexOf(".") === 0) {
        return "`" + rel + "` — the file name must not start with a dot (empty or hidden name)";
      }
      return null;
    }

    function retroPolicy(rel, ctx) {
      return retroPathPolicy(rel) || visibleNamePolicy(rel) || retroAppendOnlyPolicy(ctx);
    }

    // ANALYSIS (harness-retros S2, C6): one allow glob plus a default deny, not a list of
    // denied spellings. Named denies for the retro dir, the harness config/prompt files and
    // the AGENTS.md/CLAUDE.md/INSIGHTS.md family explain the boundary instead of falling
    // into the generic "outside scope" text.
    const ANALYSIS_ALLOW = [".harness/analysis/*.md"];
    function analysisPathPolicy(rel) {
      if (matchAny(rel, [".harness/retros/**"])) {
        return "`" + rel + "` — retro files are written only by retro-writer; the main session deletes consumed ones";
      }
      if (matchAny(rel, [".claude/**", "**/AGENTS.md", "**/CLAUDE.md", "**/INSIGHTS.md"])) {
        return "`" + rel + "` — harness files are changed by the main session after the user decision";
      }
      if (matchAny(rel, ANALYSIS_ALLOW)) return null;
      return "`" + rel + "` is outside the harness-analyst scope (.harness/analysis/<date>.md only)";
    }

    // Write-once, not append-only: `Write` only when the target does not exist yet; every
    // other tool (`Edit`, `NotebookEdit`, a missing tool_name) is blocked outright, so a
    // written analysis file never drifts. Reuses ctx.exists/ctx.toolName — no new ctx field.
    function analysisWriteOncePolicy(ctx) {
      const toolName = ctx.toolName;
      if (toolName === "Write") {
        if (ctx.exists) return "`Write` is blocked — the analysis file already exists; analysis files are write-once";
        return null;
      }
      return "`" + (toolName || "(missing tool_name)") + "` is not allowed on the analysis file — only `Write` (create) is";
    }

    function analysisPolicy(rel, ctx) {
      return analysisPathPolicy(rel) || visibleNamePolicy(rel) || analysisWriteOncePolicy(ctx);
    }
  ' "$1"
}

# ---------------------------------------------------------------------------------------
self_test() {
  local fails=0
  REAL_ROOT=$(git -C "$(dirname "$SELF")" rev-parse --show-toplevel 2>/dev/null) || REAL_ROOT=$(cd "$(dirname "$SELF")/../.." && pwd)

  # P3: the self-test suite never judges a policy against the real repo tree — every
  # tree-reading helper below (runb, runj, runj_hostcwd, runw, runw_json, runr, runrd)
  # takes its project root from the block-scoped $FIXTURE_ROOT, with NO default. A helper
  # called with $FIXTURE_ROOT empty, or equal to $REAL_ROOT, refuses (prints a "no fixture
  # root" line and counts as a failure) instead of evaluating — see noFixtureRoot below.
  # Named exceptions that legitimately touch $REAL_ROOT: the CLAUDE_PROJECT_DIR-unset /
  # $SELF-fallback row, R5/A5 (repo tree unchanged) and the whole-run tree-unchanged check
  # at the end of this function. `rund` is not in this list — it only checks the mode
  # dispatch, it reads no tree.
  BASE_FIXTURE=$(mktemp -d) || BASE_FIXTURE=""
  if [ -z "$BASE_FIXTURE" ]; then
    printf 'FAIL  %s\n' "P3 could not create the base fixture root"
    printf '\n%s failing case(s)\n' "1"
    return 1
  fi
  trap 'rm -rf "$BASE_FIXTURE"' RETURN
  mkdir -p "$BASE_FIXTURE/server/clones/x" "$BASE_FIXTURE/client" "$BASE_FIXTURE/reviewer-core" \
    "$BASE_FIXTURE/e2e" "$BASE_FIXTURE/.claude/hooks" "$BASE_FIXTURE/docs/plans" \
    "$BASE_FIXTURE/.harness/retros" "$BASE_FIXTURE/.harness/analysis"
  FIXTURE_ROOT="$BASE_FIXTURE"

  SELFTEST_STATUS_BEFORE=$(git -C "$REAL_ROOT" status --short)
  SELFTEST_STATUS_IGNORED_BEFORE=$(git -C "$REAL_ROOT" status --short --ignored)

  # A helper with $FIXTURE_ROOT empty, or equal to $REAL_ROOT, refuses instead of
  # evaluating (P3/AC1). Returns 0 (caller should `return`) when it refused.
  noFixtureRoot() { # helper-name
    if [ -z "${FIXTURE_ROOT:-}" ] || [ "$FIXTURE_ROOT" = "$REAL_ROOT" ]; then
      printf 'FAIL  %s (no fixture root)\n' "$1"; fails=$((fails + 1)); return 0
    fi
    return 1
  }

  # P5/S13: normalizes a raw evaluator exit code to the helpers' own 0/1 convention —
  # $SG_ALLOW_RC maps to 1 (allowed), 0 stays 0 (blocked), and any other code (a crash, a
  # kill, the old fail-open 3) maps to "rcN", which never matches either expectation, so a
  # crashing evaluator fails every row that calls it instead of silently passing as allowed.
  normalizeRC() { # raw-code
    case "$1" in
      0) printf '0' ;;
      "$SG_ALLOW_RC") printf '1' ;;
      *) printf 'rc%s' "$1" ;;
    esac
  }

  # name, profile, raw command, expected (0 = blocked, 1 = allowed), [cwd] — cwd defaults
  # to $FIXTURE_ROOT, so every pre-P3 row keeps its old meaning.
  runb() {
    if noFixtureRoot "$1"; then return; fi
    local got
    printf '%s' "$3" | bash_eval "$2" raw "$FIXTURE_ROOT" "${5:-$FIXTURE_ROOT}" >/dev/null
    got=$(normalizeRC "$?")
    if [ "$got" = "$4" ]; then printf 'ok    %s\n' "$1"
    else printf 'FAIL  %s (want=%s got=%s)\n' "$1" "$4" "$got"; fails=$((fails + 1)); fi
  }

  # name, bash profile, command, cwd-field value ("none" = omit the cwd key), expected exit
  # code from full dispatch (0 = allowed, 2 = blocked) — S19's json-mode cwd guard. The JSON
  # is built through node so it is well-formed regardless of the command text, and
  # $FIXTURE_ROOT is passed explicitly as CLAUDE_PROJECT_DIR for this one dispatch, never
  # relied on as ambient/exported state.
  runj() {
    if noFixtureRoot "$1"; then return; fi
    local got body
    body=$(node -e '
      const cmd = process.argv[1];
      const cwd = process.argv[2];
      const obj = { tool_input: { command: cmd } };
      if (cwd !== "none") obj.cwd = cwd;
      process.stdout.write(JSON.stringify(obj));
    ' "$3" "$4")
    printf '%s' "$body" | CLAUDE_PROJECT_DIR="$FIXTURE_ROOT" "$SELF" bash "$2" >/dev/null 2>&1
    got=$?
    if [ "$got" = "$5" ]; then printf 'ok    %s\n' "$1"
    else printf 'FAIL  %s (want=%s got=%s)\n' "$1" "$5" "$got"; fails=$((fails + 1)); fi
  }

  # name, bash profile, command, directory to run the hook process itself from, expected
  # exit code — exercises the "no cwd field, fall back to the hook process's own cwd" path.
  runj_hostcwd() {
    if noFixtureRoot "$1"; then return; fi
    local got body
    body=$(node -e '
      const cmd = process.argv[1];
      process.stdout.write(JSON.stringify({ tool_input: { command: cmd } }));
    ' "$3")
    (cd "$4" 2>/dev/null && printf '%s' "$body" | CLAUDE_PROJECT_DIR="$FIXTURE_ROOT" "$SELF" bash "$2" >/dev/null 2>&1)
    got=$?
    if [ "$got" = "$5" ]; then printf 'ok    %s\n' "$1"
    else printf 'FAIL  %s (want=%s got=%s)\n' "$1" "$5" "$got"; fails=$((fails + 1)); fi
  }

  # name, profile, file_path, expected (0 = blocked, 1 = allowed)
  runw() {
    if noFixtureRoot "$1"; then return; fi
    local got body
    body=$(node -e '
      const fp = process.argv[1];
      process.stdout.write(JSON.stringify({ tool_input: { file_path: fp } }));
    ' "$3")
    printf '%s' "$body" | CLAUDE_PROJECT_DIR="$FIXTURE_ROOT" write_eval "$2" >/dev/null
    got=$(normalizeRC "$?")
    if [ "$got" = "$4" ]; then printf 'ok    %s\n' "$1"
    else printf 'FAIL  %s (want=%s got=%s)\n' "$1" "$4" "$got"; fails=$((fails + 1)); fi
  }

  # name, profile, raw JSON body, expected (0 = blocked, 1 = allowed)
  runw_json() {
    if noFixtureRoot "$1"; then return; fi
    local got
    printf '%s' "$3" | CLAUDE_PROJECT_DIR="$FIXTURE_ROOT" write_eval "$2" >/dev/null
    got=$(normalizeRC "$?")
    if [ "$got" = "$4" ]; then printf 'ok    %s\n' "$1"
    else printf 'FAIL  %s (want=%s got=%s)\n' "$1" "$4" "$got"; fails=$((fails + 1)); fi
  }

  # name, mode, sub-profile, expected exit code — full dispatch (through "$SELF"), for the
  # unknown mode/profile fail-closed rows; stdin is irrelevant, the mode check runs first.
  # A block for another reason no longer counts as a pass — the exit code AND the
  # "misconfigured scope-guard" stderr text must both match. Reads no tree (P3 exception).
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

  # name, profile, tool_name, file_path, old_string, new_string, replace_all
  # ("true"/"false"/"none"), expected (0 = blocked, 1 = allowed) — the project root is
  # always $FIXTURE_ROOT (block-scoped, no per-call override). The JSON is built by
  # node/JSON.stringify from positional arguments, so old_string/new_string may contain
  # quotes or newlines with no hand-built JSON (C5, INSIGHTS 2026-09-24: hand-built JSON
  # with a nested quote silently fails open). "none" omits the key entirely (missing
  # tool_name / no old_string / no new_string / no replace_all), distinct from an empty
  # string.
  runr() {
    if noFixtureRoot "$1"; then return; fi
    local got body
    body=$(node -e '
      const [toolName, filePath, oldString, newString, replaceAll] = process.argv.slice(1, 6);
      const ti = { file_path: filePath };
      if (oldString !== "none") ti.old_string = oldString;
      if (newString !== "none") ti.new_string = newString;
      if (replaceAll === "true") ti.replace_all = true;
      else if (replaceAll === "false") ti.replace_all = false;
      const obj = { tool_input: ti };
      if (toolName !== "none") obj.tool_name = toolName;
      process.stdout.write(JSON.stringify(obj));
    ' "$3" "$4" "$5" "$6" "$7")
    printf '%s' "$body" | CLAUDE_PROJECT_DIR="$FIXTURE_ROOT" write_eval "$2" >/dev/null
    got=$(normalizeRC "$?")
    if [ "$got" = "$8" ]; then printf 'ok    %s\n' "$1"
    else printf 'FAIL  %s (want=%s got=%s)\n' "$1" "$8" "$got"; fails=$((fails + 1)); fi
  }

  # name, profile, tool_name, file_path, old_string, new_string, replace_all
  # ("true"/"false"/"none"), expected exit code (0 = allowed, 2 = blocked) — full JSON
  # dispatch through "$SELF write <profile>", $FIXTURE_ROOT passed explicitly as
  # CLAUDE_PROJECT_DIR for this one dispatch (C5, INSIGHTS 2026-09-25: every new rule gets a
  # bypass probe through the full dispatch, not only a positive self-test row). A blocked
  # row must also match the exact "BLOCKED by scope-guard (write <profile>)" stderr text,
  # not merely exit 2.
  runrd() {
    if noFixtureRoot "$1"; then return; fi
    local got out body
    body=$(node -e '
      const [toolName, filePath, oldString, newString, replaceAll] = process.argv.slice(1, 6);
      const ti = { file_path: filePath };
      if (oldString !== "none") ti.old_string = oldString;
      if (newString !== "none") ti.new_string = newString;
      if (replaceAll === "true") ti.replace_all = true;
      else if (replaceAll === "false") ti.replace_all = false;
      const obj = { tool_input: ti };
      if (toolName !== "none") obj.tool_name = toolName;
      process.stdout.write(JSON.stringify(obj));
    ' "$3" "$4" "$5" "$6" "$7")
    out=$(printf '%s' "$body" | CLAUDE_PROJECT_DIR="$FIXTURE_ROOT" "$SELF" write "$2" 2>&1)
    got=$?
    if [ "$got" = "$8" ] && { [ "$got" != "2" ] || printf '%s' "$out" | grep -q "BLOCKED by scope-guard (write $2)"; }; then
      printf 'ok    %s\n' "$1"
    else
      printf 'FAIL  %s (want=%s got=%s out=%s)\n' "$1" "$8" "$got" "$out"; fails=$((fails + 1))
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
  if [ "$rc" = "$SG_ALLOW_RC" ] && [ -n "$out" ]; then printf 'ok    %s\n' "T7 garbage stdin fail-open (bash json path)"
  else printf 'FAIL  %s (rc=%s out=%s)\n' "T7 garbage stdin fail-open (bash json path)" "$rc" "$out"; fails=$((fails + 1)); fi

  out=$(printf 'garbage' | write_eval tests 2>&1)
  rc=$?
  if [ "$rc" = "$SG_ALLOW_RC" ] && [ -n "$out" ]; then printf 'ok    %s\n' "T7 garbage stdin fail-open (write json path)"
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
  runj "T14 json cwd root allows self-test"      checks ".claude/hooks/scope-guard.sh self-test" "$FIXTURE_ROOT"        0
  runj "T14 json cwd root allows arch"           checks "pnpm --dir server arch"                  "$FIXTURE_ROOT"        0
  runj "T14 json cwd server blocks self-test"    checks ".claude/hooks/scope-guard.sh self-test" "$FIXTURE_ROOT/server" 2
  runj "T14 json cwd server blocks arch"         checks "pnpm --dir server arch"                  "$FIXTURE_ROOT/server" 2
  runj "T14 json cwd server blocks bash -n"      checks "bash -n .claude/hooks/implementer-guard.sh" "$FIXTURE_ROOT/server" 2
  runj "T14 json cwd server allows git diff"     checks "git diff --stat"                          "$FIXTURE_ROOT/server" 0
  runj "T14 json cwd missing blocks arch"        checks "pnpm --dir server arch"                  "$FIXTURE_ROOT/does-not-exist-xyz-19" 2

  TMPCWD=$(mktemp -d) || TMPCWD=""
  if [ -n "$TMPCWD" ]; then
    runj "T14 json cwd mktemp blocks pnpm test" checks "pnpm --dir server test" "$TMPCWD" 2
    rm -rf "$TMPCWD"
  else
    printf 'FAIL  %s (could not create the mktemp cwd)\n' "T14 json cwd mktemp blocks pnpm test"
    fails=$((fails + 1))
  fi

  # -- T14: no `cwd` field in the JSON falls back to the hook process's own cwd --
  runj_hostcwd "T14 no cwd field, hostcwd root allows self-test"   checks ".claude/hooks/scope-guard.sh self-test" "$FIXTURE_ROOT"        0
  runj_hostcwd "T14 no cwd field, hostcwd server blocks self-test" checks ".claude/hooks/scope-guard.sh self-test" "$FIXTURE_ROOT/server" 2

  # -- T14: CLAUDE_PROJECT_DIR unset falls back to the root resolved from $SELF -- named
  # P3 exception: this row legitimately runs against $REAL_ROOT, since that is exactly
  # what $SELF/../.. resolves to once CLAUDE_PROJECT_DIR is unset.
  SELFTEST_CMD_JSON=$(node -e '
    process.stdout.write(JSON.stringify({ tool_input: { command: ".claude/hooks/scope-guard.sh self-test" } }));
  ')
  out=$( (unset CLAUDE_PROJECT_DIR; cd "$REAL_ROOT" && printf '%s' "$SELFTEST_CMD_JSON" | "$SELF" bash checks) 2>&1 )
  rc=$?
  if [ "$rc" = "0" ]; then printf 'ok    %s\n' "T14 CLAUDE_PROJECT_DIR unset, root via SELF"
  else printf 'FAIL  %s (rc=%s out=%s)\n' "T14 CLAUDE_PROJECT_DIR unset, root via SELF" "$rc" "$out"; fails=$((fails + 1)); fi

  # -- T14: full dispatch blocks with the "run from the repo root" message on stderr --
  out=$( (cd "$FIXTURE_ROOT/server" && printf '%s' "$SELFTEST_CMD_JSON" | CLAUDE_PROJECT_DIR="$FIXTURE_ROOT" "$SELF" bash checks) 2>&1 )
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

  # -- P4 (T5-T8): one grammar table per head (HEAD_ARGS/GIT_ARGS), full JSON dispatch.
  # T5: shell invokers, both profiles. T6: head-as-path. T7: flags outside the grammar.
  # T8: allowed controls, plus a check that no pre-existing row above flips.
  for prof in readonly checks; do
    runj "P4 cat pipe into bash ($prof)"        "$prof" "cat f | bash"                        "$FIXTURE_ROOT" 2
    runj "P4 printf pipe into sh ($prof)"       "$prof" "printf x | sh"                        "$FIXTURE_ROOT" 2
    runj "P4 bash -s ($prof)"                   "$prof" "bash -s"                              "$FIXTURE_ROOT" 2
    runj "P4 bash lt file ($prof)"               "$prof" "bash < f"                             "$FIXTURE_ROOT" 2
    runj "P4 bash herestring ($prof)"           "$prof" "bash <<< \"rm f\""                     "$FIXTURE_ROOT" 2
    runj "P4 bash heredoc rm ($prof)"           "$prof" "bash <<EOF
rm f
EOF"                                                                                            "$FIXTURE_ROOT" 2
    runj "P4 bash script operand no -c ($prof)" "$prof" "bash server/test/ls"                  "$FIXTURE_ROOT" 2
    runj "P4 sh -e f ($prof)"                    "$prof" "sh -e f"                              "$FIXTURE_ROOT" 2
    runj "P4 bash -c extra operand ($prof)"     "$prof" "bash -c \"git status\" extra"          "$FIXTURE_ROOT" 2
    runj "P4 bash -c ansi-c quoting ($prof)"    "$prof" "bash -c \$\"rm f\""                     "$FIXTURE_ROOT" 2
    runj "P4 eval joined push ($prof)"          "$prof" "eval git push"                          "$FIXTURE_ROOT" 2
    runj "P4 zsh -c push ($prof)"                "$prof" "zsh -c \"git push\""                   "$FIXTURE_ROOT" 2
    # -- T5 (rev 3): literal spellings, not the loosely-named rev 2 rows above --
    runj "P4 bash -c ansi-c literal rm ($prof)" "$prof" "bash -c \$'\\x72m f'"                   "$FIXTURE_ROOT" 2
    runj "P4 bash heredoc quoted delim rm ($prof)" "$prof" "bash <<'EOF'
rm f
EOF"                                                                                            "$FIXTURE_ROOT" 2
  done
  runj "P4 bash -c allowed control"   checks "bash -c \"git status --short\""   "$FIXTURE_ROOT" 0
  runj "P4 eval allowed control"      checks "eval \"git status\""              "$FIXTURE_ROOT" 0

  # -- T6: a head containing / is rejected, except a literal CHECKS_EXACT command --
  runj "P4 head as path clones ls"       checks "server/clones/x/ls"            "$FIXTURE_ROOT" 2
  runj "P4 head as path dot-cat"         checks "./cat f"                       "$FIXTURE_ROOT" 2
  runj "P4 head as path bin-cat"         checks "/bin/cat f"                    "$FIXTURE_ROOT" 2
  runj "P4 head as path clones git"      checks "server/clones/x/git status"    "$FIXTURE_ROOT" 2
  runj "P4 head as path test-ls"         checks "server/test/ls"                "$FIXTURE_ROOT" 2

  # -- T7: flags outside the per-head grammar --
  runj "P4 sort -o attached full"        checks "sort -oout f"                             "$FIXTURE_ROOT" 2
  runj "P4 sort -ro cluster full"        checks "sort -ro out f"                            "$FIXTURE_ROOT" 2
  runj "P4 sort --out= abbreviated"      checks "sort --out=f x"                            "$FIXTURE_ROOT" 2
  runj "P4 sort -T /tmp"                 checks "sort -T /tmp f"                            "$FIXTURE_ROOT" 2
  runj "P4 sort --files0-from="          checks "sort --files0-from=x"                      "$FIXTURE_ROOT" 2
  runj "P4 uniq f out"                   checks "uniq f out"                                "$FIXTURE_ROOT" 2
  runj "P4 uniq -cf1 f out"              checks "uniq -cf1 f out"                           "$FIXTURE_ROOT" 2
  runj "P4 sed -ni cluster"              checks "sed -ni s/a/b/p f"                         "$FIXTURE_ROOT" 2
  runj "P4 sed -I BSD in-place"          checks "sed -I .b s/a/b/ f"                        "$FIXTURE_ROOT" 2
  runj "P4 sed script w flag"            checks "sed -n \"s/a/b/w x\" f"                     "$FIXTURE_ROOT" 2
  runj "P4 sed script w command"         checks "sed -n \"1p;w x\" f"                        "$FIXTURE_ROOT" 2
  runj "P4 sed --expression="            checks "sed --expression=1p f"                     "$FIXTURE_ROOT" 2
  runj "P4 sed no -n"                    checks "sed 1,5p f"                                 "$FIXTURE_ROOT" 2
  runj "P4 git diff --outp="             checks "git diff --outp=f"                         "$FIXTURE_ROOT" 2
  runj "P4 git log --output="            checks "git log --output=f"                        "$FIXTURE_ROOT" 2
  runj "P4 git show --textconv"          checks "git show --textconv x"                     "$FIXTURE_ROOT" 2
  runj "P4 git cat-file --textconv"      checks "git cat-file --textconv x"                 "$FIXTURE_ROOT" 2
  runj "P4 git --exec-path="             checks "git --exec-path=server/clones/x status"     "$FIXTURE_ROOT" 2
  runj "P4 git -c core.pager"            checks "git -c core.pager=x log"                    "$FIXTURE_ROOT" 2
  runj "P4 git hash-object -w"           checks "git hash-object -w f"                       "$FIXTURE_ROOT" 2
  runj "P4 git hash-object --stdin"      checks "git hash-object --stdin"                    "$FIXTURE_ROOT" 2
  runj "P4 rg --hostname-bin="           checks "rg --hostname-bin=x foo"                    "$FIXTURE_ROOT" 2
  runj "P4 rg -z"                        checks "rg -z foo"                                  "$FIXTURE_ROOT" 2
  runj "P4 rg --pre="                    checks "rg --pre=x foo"                             "$FIXTURE_ROOT" 2
  runj "P4 find -fls"                    checks "find . -fls x"                              "$FIXTURE_ROOT" 2
  runj "P4 find -exec rm"                checks "find . -exec rm"                            "$FIXTURE_ROOT" 2
  runj "P4 file -C -m"                   checks "file -C -m x"                               "$FIXTURE_ROOT" 2
  runj "P4 tail -f"                      checks "tail -f f"                                  "$FIXTURE_ROOT" 2
  runj "P4 docker -H"                    checks "docker -H tcp://x info"                     "$FIXTURE_ROOT" 2
  runj "P4 docker info --format"         checks "docker info --format x"                     "$FIXTURE_ROOT" 2
  runj "P4 cat dev-tcp"                  checks "cat < /dev/tcp/h/80"                        "$FIXTURE_ROOT" 2

  # -- T8: allowed controls; no pre-existing row above changes its expected value --
  runj "P4 sort -rn allowed"             checks "sort -rn f"                                 "$FIXTURE_ROOT" 0
  runj "P4 sort -k2 -t, allowed"         checks "sort -k2 -t, f"                              "$FIXTURE_ROOT" 0
  runj "P4 uniq -c allowed"              checks "uniq -c f"                                   "$FIXTURE_ROOT" 0
  runj "P4 sed -n 1,20p allowed"         checks "sed -n 1,20p f"                              "$FIXTURE_ROOT" 0
  runj "P4 sed -nE allowed"              checks "sed -nE 1,5p f"                              "$FIXTURE_ROOT" 0
  # -- T8 (rev 3): respelled single-quoted -- "$p" double-quoted is expanded by bash and is
  # now correctly blocked by the lexer; this is a plan row, not a Base row.
  runj "P4 sed -n end-anchor allowed"    checks "sed -n '\$p' f"                              "$FIXTURE_ROOT" 0
  runj "P4 rg -n -m1 allowed"            checks "rg -n -m1 foo f"                             "$FIXTURE_ROOT" 0
  runj "P4 rg -nm1 attached allowed"     checks "rg -nm1 foo f"                               "$FIXTURE_ROOT" 0
  runj "P4 git log --oneline -5 allowed" checks "git log --oneline -5"                        "$FIXTURE_ROOT" 0
  runj "P4 find -name -type allowed"     checks "find . -name \"*.md\" -type f"                "$FIXTURE_ROOT" 0

  # -- AC4 drift fix: a CHECKS_EXACT command with a safe trailing redirection, plus the two
  # newly admitted readonly git subcommands (check-ignore, hash-object without -w/--stdin) --
  runj "P4 checks-exact trailing redir allowed" checks ".claude/hooks/scope-guard.sh self-test 2>&1" "$FIXTURE_ROOT" 0
  runj "P4 git check-ignore allowed"            checks "git check-ignore -q .harness/retros/x.retro.md" "$FIXTURE_ROOT" 0
  runj "P4 git hash-object allowed"             checks "git hash-object docs/plans/x.plan.md" "$FIXTURE_ROOT" 0

  # -- T20 (rev 3): lexer, blocked, full dispatch, both profiles. The first eight are the
  # rev 2 reproduced bypasses (C4); the rest extend the lexing/quoting/expansion class.
  for prof in readonly checks; do
    runj "P4 lexer blocked find backslash-delete ($prof)"   "$prof" 'find . \-delete'                  "$FIXTURE_ROOT" 2
    runj "P4 lexer blocked sort backslash-o ($prof)"        "$prof" 'sort \-oout f'                    "$FIXTURE_ROOT" 2
    runj "P4 lexer blocked git backslash-output ($prof)"    "$prof" 'git log \--output=x'               "$FIXTURE_ROOT" 2
    runj "P4 lexer blocked sed backslash-i ($prof)"         "$prof" 'sed -n 1p \-i f'                   "$FIXTURE_ROOT" 2
    runj "P4 lexer blocked find ansi-c delete ($prof)"      "$prof" "find . \$'-delete'"                "$FIXTURE_ROOT" 2
    runj "P4 lexer blocked sort ansi-c o ($prof)"           "$prof" "sort \$'-o'out f"                  "$FIXTURE_ROOT" 2
    runj "P4 lexer blocked CI delete prefix find ($prof)"   "$prof" 'CI=-delete; find . $CI'            "$FIXTURE_ROOT" 2
    runj "P4 lexer blocked CI o prefix sort ($prof)"        "$prof" 'CI=-oout; sort $CI f'              "$FIXTURE_ROOT" 2
    runj "P4 lexer blocked find dq-ansi delete ($prof)"     "$prof" 'find . $"-delete"'                 "$FIXTURE_ROOT" 2
    runj "P4 lexer blocked find brace expansion ($prof)"    "$prof" 'find . ${CI}'                      "$FIXTURE_ROOT" 2
    runj "P4 lexer blocked cat dq dollar home ($prof)"      "$prof" 'cat "$HOME/x"'                     "$FIXTURE_ROOT" 2
    runj "P4 lexer blocked find leading glob ($prof)"       "$prof" 'find . *'                          "$FIXTURE_ROOT" 2
    runj "P4 lexer blocked CI=1 alone ($prof)"              "$prof" 'CI=1'                              "$FIXTURE_ROOT" 2
    runj "P4 lexer blocked CI=0 prefix pnpm ($prof)"        "$prof" 'CI=0 pnpm --dir server test'       "$FIXTURE_ROOT" 2
    runj "P4 lexer blocked find escaped separator ($prof)"  "$prof" 'find . -name x \;'                 "$FIXTURE_ROOT" 2
  done

  # -- T21 (rev 3): lexer, allowed controls (checks) --
  runj "P4 lexer allowed rg escaped dot"       checks "rg -n 'a\\.b' f"          "$FIXTURE_ROOT" 0
  runj "P4 lexer allowed rg dollar single-q"   checks "rg -n '\$HOME' f"         "$FIXTURE_ROOT" 0
  runj "P4 lexer allowed rg fixed dq-in-sq"    checks "rg -F -c '\"\$X\"' f"     "$FIXTURE_ROOT" 0
  runj "P4 lexer allowed ls quoted glob" checks "ls '.harness/retros/*.md'" "$FIXTURE_ROOT" 0

  # -- T25 (rev 4): glob anywhere in a word, blocked, full dispatch, both profiles --
  for prof in readonly checks; do
    runj "P4 lexer glob blocked empty-quote star ($prof)"        "$prof" "ls ''*"                     "$FIXTURE_ROOT" 2
    runj "P4 lexer glob blocked dq-empty star ($prof)"           "$prof" 'ls ""*'                      "$FIXTURE_ROOT" 2
    runj "P4 lexer glob blocked empty-quote question ($prof)"    "$prof" "ls ''?"                      "$FIXTURE_ROOT" 2
    runj "P4 lexer glob blocked empty-quote bracket ($prof)"     "$prof" "ls ''[a]"                    "$FIXTURE_ROOT" 2
    runj "P4 lexer glob blocked sort empty-quote star ($prof)"   "$prof" "sort ''*"                    "$FIXTURE_ROOT" 2
    runj "P4 lexer glob blocked literal-then-quote star ($prof)" "$prof" "ls a''*"                     "$FIXTURE_ROOT" 2
    runj "P4 lexer glob blocked trailing star ($prof)"           "$prof" "ls x*"                       "$FIXTURE_ROOT" 2
    runj "P4 lexer glob blocked ls retros star-md ($prof)"       "$prof" "ls .harness/retros/*.md"     "$FIXTURE_ROOT" 2
  done
  runj "P4 lexer glob allowed ls quoted star" checks "ls '*'"        "$FIXTURE_ROOT" 0
  runj "P4 lexer glob allowed rg question"    checks "rg -n 'a?b' f" "$FIXTURE_ROOT" 0

  # -- T27 (quick fix, same lexer invariant): an unquoted "\x3e"/"\x3c" glued to the middle
  # of a word (no whitespace around it) is a redirection the tokenizer, which only splits on
  # whitespace, never sees as its own token -- so checkRedirection/checkInputRedirection,
  # which only match a word STARTING with a digit*+operator prefix, never fire. Blocked,
  # full dispatch, both profiles. --
  for prof in readonly checks; do
    runj "P4 lexer midword blocked echo output redirect ($prof)"  "$prof" 'echo x>server/src/a.ts'    "$FIXTURE_ROOT" 2
    runj "P4 lexer midword blocked cat output redirect ($prof)"   "$prof" 'cat f>g'                   "$FIXTURE_ROOT" 2
    runj "P4 lexer midword blocked echo append redirect ($prof)"  "$prof" 'echo x>>g'                 "$FIXTURE_ROOT" 2
    runj "P4 lexer midword blocked cat dev-tcp input ($prof)"     "$prof" 'cat x</dev/tcp/h/80'        "$FIXTURE_ROOT" 2
  done

  # -- T27: allowed controls -- a quoted "\x3e"/"\x3c" stays literal data, and the leading
  # digit*+operator position (a real redirection or fd dup) is untouched by this rule. --
  runj "P4 lexer midword allowed rg quoted angle"    checks "rg -n '>' f"                                     "$FIXTURE_ROOT" 0
  runj "P4 lexer midword allowed echo dq angle"      checks 'echo "a>b"'                                      "$FIXTURE_ROOT" 0
  runj "P4 lexer midword allowed echo sq pipe"       checks "echo 'a|b'"                                      "$FIXTURE_ROOT" 0
  runj "P4 lexer midword allowed self-test fd-dup piped" checks ".claude/hooks/scope-guard.sh self-test 2>&1 | tail -1" "$FIXTURE_ROOT" 0
  runj "P4 lexer midword allowed git status piped"   checks "git status --short | head -5"                    "$FIXTURE_ROOT" 0

  # -- T26 (rev 4): the dispatcher denies every evaluator exit except SG_ALLOW_RC. A
  # PATH-stub `node` simulates a crash, a kill or the old fail-open code; the real `node`
  # builds the JSON body first, before the stub is placed on PATH. --
  T26_STUB_DIR=$(mktemp -d) || T26_STUB_DIR=""
  if [ -n "$T26_STUB_DIR" ]; then
    trap 'rm -rf "$T26_STUB_DIR"' RETURN
    T26_BASH_BODY=$(node -e 'process.stdout.write(JSON.stringify({ tool_input: { command: "git status --short" } }));')
    T26_WRITE_BODY=$(node -e 'process.stdout.write(JSON.stringify({ tool_input: { file_path: "server/test/x.test.ts" } }));')

    t26_write_stub() { # behavior: killed | exit1 | exit3
      case "$1" in
        killed) printf '#!/usr/bin/env bash\nkill -KILL "$$"\n' > "$T26_STUB_DIR/node" ;;
        exit1)  printf '#!/usr/bin/env bash\nexit 1\n' > "$T26_STUB_DIR/node" ;;
        exit3)  printf '#!/usr/bin/env bash\nexit 3\n' > "$T26_STUB_DIR/node" ;;
      esac
      chmod +x "$T26_STUB_DIR/node"
    }

    t26_check() { # behavior, human label, mode(bash|write), sub-profile, body
      t26_write_stub "$1"
      local out rc
      out=$(printf '%s' "$5" | (PATH="$T26_STUB_DIR:$PATH" CLAUDE_PROJECT_DIR="$FIXTURE_ROOT" "$SELF" "$3" "$4") 2>&1)
      rc=$?
      if [ "$rc" = 2 ] && printf '%s' "$out" | grep -q "BLOCKED by scope-guard"; then
        printf 'ok    %s\n' "P5 dispatcher denies evaluator $2 ($3 $4)"
      else
        printf 'FAIL  %s (rc=%s out=%s)\n' "P5 dispatcher denies evaluator $2 ($3 $4)" "$rc" "$out"
        fails=$((fails + 1))
      fi
    }

    t26_check killed "killed" bash checks "$T26_BASH_BODY"
    t26_check exit1  "exit 1" bash checks "$T26_BASH_BODY"
    t26_check exit3  "exit 3" bash checks "$T26_BASH_BODY"
    t26_check killed "killed" write tests "$T26_WRITE_BODY"
    t26_check exit1  "exit 1" write tests "$T26_WRITE_BODY"
    t26_check exit3  "exit 3" write tests "$T26_WRITE_BODY"

    # -- P5 helper oracle: an evaluator exit of 1 (NOT SG_ALLOW_RC) must not register as
    # allowed -- a runb row expecting 1 against the exit-1 stub must itself FAIL. --
    t26_write_stub exit1
    T26_ORACLE_OUT=$(PATH="$T26_STUB_DIR:$PATH" runb "P5 helper oracle probe" readonly "git status --short" 1 2>&1)
    if printf '%s' "$T26_ORACLE_OUT" | grep -q '^FAIL'; then
      printf 'ok    %s\n' "P5 helper oracle rejects evaluator exit 1"
    else
      printf 'FAIL  %s (out=%s)\n' "P5 helper oracle rejects evaluator exit 1" "$T26_ORACLE_OUT"
      fails=$((fails + 1))
    fi

    rm -rf "$T26_STUB_DIR"
  else
    printf 'FAIL  %s (could not create the T26 stub dir)\n' "P5 dispatcher denies evaluator (setup)"
    fails=$((fails + 1))
  fi

  # -- T22 (rev 3): grammar arity and data operands (checks) --
  runj "P4 grammar allowed echo triple-dash"   checks "echo ---"                       "$FIXTURE_ROOT" 0
  runj "P4 grammar allowed echo -n"            checks "echo -n x"                      "$FIXTURE_ROOT" 0
  runj "P4 grammar allowed echo data -rf"      checks "echo x -rf"                     "$FIXTURE_ROOT" 0
  runj "P4 grammar allowed printf format"      checks "printf '%s\\n' x"               "$FIXTURE_ROOT" 0
  runj "P4 grammar allowed test -f"            checks "test -f x"                      "$FIXTURE_ROOT" 0
  runj "P4 grammar allowed test -n"            checks "test -n x"                      "$FIXTURE_ROOT" 0
  runj "P4 grammar allowed test negated -d"    checks "test ! -d x"                    "$FIXTURE_ROOT" 0
  runj "P4 grammar allowed rg glob space"      checks "rg --glob '*.ts' foo f"         "$FIXTURE_ROOT" 0
  runj "P4 grammar allowed rg glob attached"   checks "rg --glob='*.ts' foo f"         "$FIXTURE_ROOT" 0
  runj "P4 grammar allowed rg max-count space" checks "rg --max-count 1 foo f"         "$FIXTURE_ROOT" 0
  runj "P4 grammar allowed rg max-count attached" checks "rg --max-count=1 foo f"      "$FIXTURE_ROOT" 0
  runj "P4 grammar allowed rg type space"      checks "rg --type ts foo f"             "$FIXTURE_ROOT" 0
  runj "P4 grammar blocked printf -v"          checks "printf -v x y"                  "$FIXTURE_ROOT" 2
  runj "P4 grammar blocked rg max-count no value" checks "rg foo f --max-count"        "$FIXTURE_ROOT" 2

  # -- T10 (S8 hardening) / S16: write policy checked on the symlink-resolved path too --
  # A throwaway fake project root (mktemp -d), not the real repo tree, so a crashed run
  # can no longer leave a stray symlink under server/test/. write_eval computes both the
  # logical and symlink-resolved relative path from CLAUDE_PROJECT_DIR, so pointing that
  # at the fake root exercises the same resolution without touching the repo at all.
  FAKE_ROOT=$(mktemp -d) || FAKE_ROOT=""
  if [ -n "$FAKE_ROOT" ]; then
    trap 'rm -rf "$FAKE_ROOT"' RETURN
    mkdir -p "$FAKE_ROOT/server/test" "$FAKE_ROOT/server/src"
    FIXTURE_ROOT="$FAKE_ROOT"
    ln -s ../src "$FAKE_ROOT/server/test/link"
    runw "T10 symlink escapes to src" tests "server/test/link/app.ts" 0
    runw "T10 symlink positive control" tests "server/test/x.test.ts" 1
    # -- T18: a DANGLING symlink — Write creates its target, so the target is what is judged --
    mkdir -p "$FAKE_ROOT/docs" "$FAKE_ROOT/.harness/retros"
    ln -s ../src/new.ts "$FAKE_ROOT/server/test/ghost.test.ts"
    ln -s ../server/src/new.md "$FAKE_ROOT/docs/ghost.md"
    ln -s ../server/test/fine.md "$FAKE_ROOT/docs/fine-link.md"
    ln -s ../../server/src/new.ts "$FAKE_ROOT/.harness/retros/ghost.retro.md"
    ln -s ../../.harness/retros/fine.retro.md "$FAKE_ROOT/.harness/retros/ok.retro.md"
    runw "T18 dangling symlink tests"   tests "server/test/ghost.test.ts"  0
    runw "T18 dangling symlink docs"    docs  "docs/ghost.md"              0
    runw "T18 docs control (plain doc)" docs  "docs/plain.md"              1
    runr "T18 dangling symlink retro"    retro Write ".harness/retros/ghost.retro.md" none "x" none 0
    runr "T18 dangling symlink in-scope" retro Write ".harness/retros/ok.retro.md"    none "x" none 1
    rm -rf "$FAKE_ROOT"
    FIXTURE_ROOT="$BASE_FIXTURE"
    trap - RETURN
  else
    printf 'FAIL  %s (could not create the fake project root)\n' "T10 symlink escapes to src"
    fails=$((fails + 1))
  fi

  # -- P5 (T9/T10/T11): one resolver, unresolvable = deny. Fixtures live in their own
  # throwaway fake roots, never under the real repo tree.
  DEEP=""
  n=1
  while [ "$n" -le 42 ]; do DEEP="${DEEP}d$n/"; n=$((n + 1)); done

  P5_FAKE_ROOT=$(mktemp -d) || P5_FAKE_ROOT=""
  if [ -n "$P5_FAKE_ROOT" ]; then
    trap 'rm -rf "$P5_FAKE_ROOT"' RETURN
    mkdir -p "$P5_FAKE_ROOT/server/test" "$P5_FAKE_ROOT/server/clones/x" "$P5_FAKE_ROOT/server/clones/y" "$P5_FAKE_ROOT/x"
    FIXTURE_ROOT="$P5_FAKE_ROOT"
    ln -s ../clones/x "$P5_FAKE_ROOT/server/test/evil"
    ln -s ../clones/y/new.test.ts "$P5_FAKE_ROOT/server/test/ghost.test.ts"
    ln -s loop2 "$P5_FAKE_ROOT/server/test/loop1"
    ln -s loop1 "$P5_FAKE_ROOT/server/test/loop2"
    ln -s loop2 "$P5_FAKE_ROOT/x/loop1"
    ln -s loop1 "$P5_FAKE_ROOT/x/loop2"

    # -- T9: symlink into server/clones, existing target --
    runj "P5 pnpm test symlink into clones"          checks "pnpm --dir server test test/evil/a.test.ts"                       "$FIXTURE_ROOT" 2
    runj "P5 pnpm exec eslint symlink into clones"   checks "pnpm --dir server exec eslint test/evil"                          "$FIXTURE_ROOT" 2
    runj "P5 pnpm exec tsc symlink into clones"      checks "pnpm --dir server exec tsc --noEmit -p test/evil/tsconfig.json"  "$FIXTURE_ROOT" 2
    runj "P5 pnpm exec vitest symlink into clones"   checks "pnpm --dir server exec vitest run test/evil"                     "$FIXTURE_ROOT" 2
    # -- T9: dangling symlink into clones --
    runj "P5 pnpm test dangling symlink into clones" checks "pnpm --dir server test test/ghost.test.ts"                       "$FIXTURE_ROOT" 2
    # -- T9: allowed control --
    runj "P5 pnpm test plain path allowed (control)" checks "pnpm --dir server test test/x.test.ts"                          "$FIXTURE_ROOT" 0

    # -- T10: loop symlink as a pnpm path argument --
    runj "P5 pnpm test loop symlink path"            checks "pnpm --dir server test test/loop1/a.test.ts"                    "$FIXTURE_ROOT" 2

    # -- T10: loop symlink as a Write target, every write profile --
    runrd "P5 write tests loop symlink blocked"    tests    Write "x/loop1" none "x" none 2
    runrd "P5 write docs loop symlink blocked"     docs     Write "x/loop1" none "x" none 2
    runrd "P5 write retro loop symlink blocked"    retro    Write "x/loop1" none "x" none 2
    runrd "P5 write analysis loop symlink blocked" analysis Write "x/loop1" none "x" none 2

    # -- T10: a 45-component non-existent path -- live-verified fail-open at Base (C4) --
    runrd "P5 45-component path under write tests blocked" tests Write "server/src/${DEEP}x.ts" none "x" none 2
    # -- T10: allowed control, same depth, under the test dirs --
    runrd "P5 45-component path under write tests allowed (control)" tests Write "server/test/${DEEP}x.test.ts" none "x" none 0

    # -- T11: shell-expansion characters in a judged path are rejected --
    runj "P5 tilde path rejected"  checks "pnpm --dir server exec tsc --noEmit -p ~/x/tsconfig.json" "$FIXTURE_ROOT" 2
    runj "P5 dollar path rejected" checks "pnpm --dir server exec eslint \$HOME/x.js"                "$FIXTURE_ROOT" 2
    runj "P5 glob path rejected"   checks "pnpm --dir server exec vitest run 'test/*'"                "$FIXTURE_ROOT" 2

    rm -rf "$P5_FAKE_ROOT"
    FIXTURE_ROOT="$BASE_FIXTURE"
    trap - RETURN
  else
    printf 'FAIL  %s (could not create the fake project root)\n' "P5 pnpm test symlink into clones"
    fails=$((fails + 1))
  fi

  # -- T9: --dir/-C itself symlinked into server/clones --
  P5_DIR_FAKE_ROOT=$(mktemp -d) || P5_DIR_FAKE_ROOT=""
  if [ -n "$P5_DIR_FAKE_ROOT" ]; then
    trap 'rm -rf "$P5_DIR_FAKE_ROOT"' RETURN
    mkdir -p "$P5_DIR_FAKE_ROOT/server/clones/x"
    FIXTURE_ROOT="$P5_DIR_FAKE_ROOT"
    ln -s server/clones/x "$P5_DIR_FAKE_ROOT/client"
    runj "P5 pnpm --dir client symlinked into clones" checks "pnpm --dir client test" "$FIXTURE_ROOT" 2
    rm -rf "$P5_DIR_FAKE_ROOT"
    FIXTURE_ROOT="$BASE_FIXTURE"
    trap - RETURN
  else
    printf 'FAIL  %s (could not create the fake project root)\n' "P5 pnpm --dir client symlinked into clones"
    fails=$((fails + 1))
  fi

  # -- T9: the hook path in a CHECKS_EXACT command symlinked into server/clones --
  P5_HOOK_FAKE_ROOT=$(mktemp -d) || P5_HOOK_FAKE_ROOT=""
  if [ -n "$P5_HOOK_FAKE_ROOT" ]; then
    trap 'rm -rf "$P5_HOOK_FAKE_ROOT"' RETURN
    mkdir -p "$P5_HOOK_FAKE_ROOT/.claude/hooks" "$P5_HOOK_FAKE_ROOT/server/clones/x"
    FIXTURE_ROOT="$P5_HOOK_FAKE_ROOT"
    printf '#!/usr/bin/env bash\necho evil\n' > "$P5_HOOK_FAKE_ROOT/server/clones/x/evil.sh"
    ln -s ../../server/clones/x/evil.sh "$P5_HOOK_FAKE_ROOT/.claude/hooks/scope-guard.sh"
    runj "P5 self-test hook symlinked into clones" checks ".claude/hooks/scope-guard.sh self-test" "$FIXTURE_ROOT" 2
    rm -rf "$P5_HOOK_FAKE_ROOT"
    FIXTURE_ROOT="$BASE_FIXTURE"
    trap - RETURN
  else
    printf 'FAIL  %s (could not create the fake project root)\n' "P5 self-test hook symlinked into clones"
    fails=$((fails + 1))
  fi

  # -- T23 (rev 3, S12): a write-path exception is a deny, not fail-open. path.isAbsolute
  # throws on a non-string file_path, which used to reach write_eval's fail-open outer
  # catch. Full dispatch through "$SELF" write <profile>, payload built by node/
  # JSON.stringify (AC1) -- the value 123 is a JS literal in the node program itself, not
  # interpolated, so there is nothing here for a shell quote to mangle.
  NUMERIC_FP_BODY=$(node -e '
    process.stdout.write(JSON.stringify({ tool_name: "Write", tool_input: { file_path: 123 } }));
  ')
  for wprof in tests docs retro analysis; do
    out=$(printf '%s' "$NUMERIC_FP_BODY" | CLAUDE_PROJECT_DIR="$FIXTURE_ROOT" "$SELF" write "$wprof" 2>&1)
    got=$?
    if [ "$got" = "2" ] && printf '%s' "$out" | grep -q "BLOCKED by scope-guard (write $wprof)"; then
      printf 'ok    %s\n' "P5 write non-string file_path denied ($wprof)"
    else
      printf 'FAIL  %s (want=2 got=%s out=%s)\n' "P5 write non-string file_path denied ($wprof)" "$got" "$out"
      fails=$((fails + 1))
    fi
  done

  # -- P7 (AC4): every C7 required command is allowed through its own agent bash
  # profile, full JSON dispatch. Names carry the raw command so a name and its own
  # command argument are the same escaped literal, kept in sync by construction.
  # -- C7 plan-verifier (checks) --
  runj "P7 plan-verifier git merge-base HEAD origin/main" checks "git merge-base HEAD origin/main" "$FIXTURE_ROOT" 0
  runj "P7 plan-verifier git status --short" checks "git status --short" "$FIXTURE_ROOT" 0
  runj "P7 plan-verifier git diff --name-only 57db629" checks "git diff --name-only 57db629" "$FIXTURE_ROOT" 0
  runj "P7 plan-verifier git ls-files --others --exclude-standard" checks "git ls-files --others --exclude-standard" "$FIXTURE_ROOT" 0
  runj "P7 plan-verifier git show --stat HEAD" checks "git show --stat HEAD" "$FIXTURE_ROOT" 0
  runj "P7 plan-verifier git check-ignore -q .harness/retros/x.retro.md" checks "git check-ignore -q .harness/retros/x.retro.md" "$FIXTURE_ROOT" 0
  runj "P7 plan-verifier git hash-object docs/plans/x.plan.md" checks "git hash-object docs/plans/x.plan.md" "$FIXTURE_ROOT" 0
  runj "P7 plan-verifier CI=1 pnpm --dir server test" checks "CI=1 pnpm --dir server test" "$FIXTURE_ROOT" 0
  runj "P7 plan-verifier CI=1 pnpm --dir client exec vitest run src/x.test.tsx" checks "CI=1 pnpm --dir client exec vitest run src/x.test.tsx" "$FIXTURE_ROOT" 0
  runj "P7 plan-verifier pnpm --dir server typecheck" checks "pnpm --dir server typecheck" "$FIXTURE_ROOT" 0
  runj "P7 plan-verifier pnpm --dir client lint" checks "pnpm --dir client lint" "$FIXTURE_ROOT" 0
  runj "P7 plan-verifier docker info" checks "docker info" "$FIXTURE_ROOT" 0
  runj "P7 plan-verifier bash -n .claude/hooks/scope-guard.sh" checks "bash -n .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan-verifier .claude/hooks/scope-guard.sh self-test 2>&1 | tail -1" checks ".claude/hooks/scope-guard.sh self-test 2>&1 | tail -1" "$FIXTURE_ROOT" 0
  runj "P7 plan-verifier .claude/hooks/implementer-guard.sh self-test" checks ".claude/hooks/implementer-guard.sh self-test" "$FIXTURE_ROOT" 0
  runj "P7 plan-verifier rg -n 'x' .claude/agents/plan-verifier.md" checks "rg -n 'x' .claude/agents/plan-verifier.md" "$FIXTURE_ROOT" 0
  # -- C7 architecture-reviewer (checks) --
  runj "P7 architecture-reviewer git merge-base HEAD origin/main" checks "git merge-base HEAD origin/main" "$FIXTURE_ROOT" 0
  runj "P7 architecture-reviewer git status --short" checks "git status --short" "$FIXTURE_ROOT" 0
  runj "P7 architecture-reviewer git diff --name-only 57db629" checks "git diff --name-only 57db629" "$FIXTURE_ROOT" 0
  runj "P7 architecture-reviewer pnpm --dir server arch" checks "pnpm --dir server arch" "$FIXTURE_ROOT" 0
  runj "P7 architecture-reviewer pnpm --dir server exec depcruise src --config .dependency-cruiser.cjs -T err-long" checks "pnpm --dir server exec depcruise src --config .dependency-cruiser.cjs -T err-long" "$FIXTURE_ROOT" 0
  runj "P7 architecture-reviewer diff -rq server/src/vendor/shared client/src/vendor/shared" checks "diff -rq server/src/vendor/shared client/src/vendor/shared" "$FIXTURE_ROOT" 0
  runj "P7 architecture-reviewer rg -n 'fastify|drizzle-orm|node:fs|node:child_process|octokit' reviewer-core/src" checks "rg -n 'fastify|drizzle-orm|node:fs|node:child_process|octokit' reviewer-core/src" "$FIXTURE_ROOT" 0
  # -- C7 test-writer (checks) --
  runj "P7 test-writer pnpm --dir server exec vitest run test/x.test.ts" checks "pnpm --dir server exec vitest run test/x.test.ts" "$FIXTURE_ROOT" 0
  runj "P7 test-writer CI=1 pnpm --dir client test" checks "CI=1 pnpm --dir client test" "$FIXTURE_ROOT" 0
  runj "P7 test-writer pnpm --dir e2e typecheck" checks "pnpm --dir e2e typecheck" "$FIXTURE_ROOT" 0
  runj "P7 test-writer pnpm --dir e2e lint" checks "pnpm --dir e2e lint" "$FIXTURE_ROOT" 0
  # -- C7 retro-writer (readonly) --
  runj "P7 retro-writer git log --oneline -5" readonly "git log --oneline -5" "$FIXTURE_ROOT" 0
  runj "P7 retro-writer sed -n 1,40p .harness/retros/x.retro.md" readonly "sed -n 1,40p .harness/retros/x.retro.md" "$FIXTURE_ROOT" 0
  runj "P7 retro-writer rg -n 'Converging' .harness/retros/x.retro.md" readonly "rg -n 'Converging' .harness/retros/x.retro.md" "$FIXTURE_ROOT" 0
  runj "P7 retro-writer wc -l .harness/retros/x.retro.md" readonly "wc -l .harness/retros/x.retro.md" "$FIXTURE_ROOT" 0
  runj "P7 retro-writer head -20 .harness/retros/x.retro.md" readonly "head -20 .harness/retros/x.retro.md" "$FIXTURE_ROOT" 0
  runj "P7 retro-writer ls .harness/retros" readonly "ls .harness/retros" "$FIXTURE_ROOT" 0
  # -- C7 harness-analyst (readonly) --
  runj "P7 harness-analyst ls .harness/retros .harness/analysis" readonly "ls .harness/retros .harness/analysis" "$FIXTURE_ROOT" 0
  runj "P7 harness-analyst rg -m1 'Decision' .harness/retros/x.retro.md" readonly "rg -m1 'Decision' .harness/retros/x.retro.md" "$FIXTURE_ROOT" 0
  runj "P7 harness-analyst git log --oneline -- .claude/planner.md" readonly "git log --oneline -- .claude/planner.md" "$FIXTURE_ROOT" 0
  runj "P7 harness-analyst git ls-files .claude" readonly "git ls-files .claude" "$FIXTURE_ROOT" 0
  runj "P7 harness-analyst git ls-files .claude AGENTS.md globs" readonly "git ls-files .claude AGENTS.md '*/AGENTS.md' INSIGHTS.md '*/INSIGHTS.md'" "$FIXTURE_ROOT" 0
  runj "P7 harness-analyst wc -l f" readonly "wc -l f" "$FIXTURE_ROOT" 0
  runj "P7 harness-analyst head -20 f" readonly "head -20 f" "$FIXTURE_ROOT" 0
  # -- C7 doc-writer (readonly) --
  runj "P7 doc-writer git log --oneline -5" readonly "git log --oneline -5" "$FIXTURE_ROOT" 0
  runj "P7 doc-writer rg -n 'x' server/README.md" readonly "rg -n 'x' server/README.md" "$FIXTURE_ROOT" 0
  runj "P7 doc-writer ls docs" readonly "ls docs" "$FIXTURE_ROOT" 0

  # -- P7 plan (C7 'This plan'): one allowed row per distinct command in a Verify cell
  # of S0-S10 or T4/T12/T13/T16/T18/T19, through the plan-verifier (checks) profile.
  # Commands already covered by the C7 plan-verifier list above are not repeated.
  runj "P7 plan S0 git log --oneline -1 -- docs/plans/harness-flow-rules.plan.md" checks "git log --oneline -1 -- docs/plans/harness-flow-rules.plan.md" "$FIXTURE_ROOT" 0
  runj "P7 plan S0 rg -n 'Base:\\*\\* .57db629' docs/plans/harness-guard-classfix.plan.md" checks "rg -n 'Base:\\*\\* .57db629' docs/plans/harness-guard-classfix.plan.md" "$FIXTURE_ROOT" 0
  runj "P7 plan S0 rg -n 'Revision:\\*\\* [2-9]' docs/plans/harness-guard-classfix.plan.md" checks "rg -n 'Revision:\\*\\* [2-9]' docs/plans/harness-guard-classfix.plan.md" "$FIXTURE_ROOT" 0
  runj "P7 plan S1 .claude/hooks/scope-guard.sh self-test | tail -1" checks ".claude/hooks/scope-guard.sh self-test | tail -1" "$FIXTURE_ROOT" 0
  runj "P7 plan S1 .claude/hooks/scope-guard.sh self-test | rg -c '^ok +P3 helper without fixture root refuses'" checks ".claude/hooks/scope-guard.sh self-test | rg -c '^ok +P3 helper without fixture root refuses'" "$FIXTURE_ROOT" 0
  runj "P7 plan S1 .claude/hooks/scope-guard.sh self-test | rg -c '^ok +P3 helper with the real root refuses'" checks ".claude/hooks/scope-guard.sh self-test | rg -c '^ok +P3 helper with the real root refuses'" "$FIXTURE_ROOT" 0
  runj "P7 plan S1 .claude/hooks/scope-guard.sh self-test | rg -c '^ok +P3 self-test leaves the real working tree unchanged'" checks ".claude/hooks/scope-guard.sh self-test | rg -c '^ok +P3 self-test leaves the real working tree unchanged'" "$FIXTURE_ROOT" 0
  runj "P7 plan S1 rg -c 'no fixture [r]oot' .claude/hooks/scope-guard.sh" checks "rg -c 'no fixture [r]oot' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S1 rg -n ':-\\\$ROOT' .claude/hooks/scope-guard.sh" checks "rg -n ':-\\\$ROOT' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S1 rg -n 'printf .[{]\"tool_input' .claude/hooks/scope-guard.sh" checks "rg -n 'printf .[{]\"tool_input' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S1 rg -n -F 'export CLAUDE_PROJECT_DIR=\"\$ROOT\"' .claude/hooks/scope-guard.sh" checks "rg -n -F 'export CLAUDE_PROJECT_DIR=\"\$ROOT\"' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S1 rg -n '^ *export CLAUDE_PROJECT_DIR' .claude/hooks/scope-guard.sh" checks "rg -n '^ *export CLAUDE_PROJECT_DIR' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S2 rg -c 'function realpath[N]earest' .claude/hooks/scope-guard.sh" checks "rg -c 'function realpath[N]earest' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S2 rg -c '^RESOLVER_JS=' .claude/hooks/scope-guard.sh" checks "rg -c '^RESOLVER_JS=' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S2 rg -F -c '\"\$RESOLVER_JS\"' .claude/hooks/scope-guard.sh" checks "rg -F -c '\"\$RESOLVER_JS\"' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S2 .claude/hooks/scope-guard.sh self-test | rg -c '^ok +P5 '" checks ".claude/hooks/scope-guard.sh self-test | rg -c '^ok +P5 '" "$FIXTURE_ROOT" 0
  runj "P7 plan S2 .claude/hooks/scope-guard.sh self-test | rg -c '^ok +P5 45-component path under write tests blocked'" checks ".claude/hooks/scope-guard.sh self-test | rg -c '^ok +P5 45-component path under write tests blocked'" "$FIXTURE_ROOT" 0
  runj "P7 plan S3 rg -n 'function sedScript[U]nsafe' .claude/hooks/scope-guard.sh" checks "rg -n 'function sedScript[U]nsafe' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S3 rg -n 'const FIND_[R]EJECT' .claude/hooks/scope-guard.sh" checks "rg -n 'const FIND_[R]EJECT' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S3 rg -n 'const READONLY_[C]MDS' .claude/hooks/scope-guard.sh" checks "rg -n 'const READONLY_[C]MDS' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S3 rg -n 'const READONLY_[G]IT' .claude/hooks/scope-guard.sh" checks "rg -n 'const READONLY_[G]IT' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S3 rg -n 'head === \"[s]ort\"' .claude/hooks/scope-guard.sh" checks "rg -n 'head === \"[s]ort\"' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S3 rg -n 'head === \"[u]niq\"' .claude/hooks/scope-guard.sh" checks "rg -n 'head === \"[u]niq\"' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S3 rg -n 'head === \"[f]ile\"' .claude/hooks/scope-guard.sh" checks "rg -n 'head === \"[f]ile\"' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S3 rg -n 'head === \"[r]g\"' .claude/hooks/scope-guard.sh" checks "rg -n 'head === \"[r]g\"' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S3 rg -n 'head === \"[s]ed\"' .claude/hooks/scope-guard.sh" checks "rg -n 'head === \"[s]ed\"' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S3 rg -n 'head === \"[f]ind\"' .claude/hooks/scope-guard.sh" checks "rg -n 'head === \"[f]ind\"' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S3 rg -c 'const HEAD_[A]RGS' .claude/hooks/scope-guard.sh" checks "rg -c 'const HEAD_[A]RGS' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S3 rg -c 'const GIT_[A]RGS' .claude/hooks/scope-guard.sh" checks "rg -c 'const GIT_[A]RGS' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S3 .claude/hooks/scope-guard.sh self-test | rg -c '^ok +P4 '" checks ".claude/hooks/scope-guard.sh self-test | rg -c '^ok +P4 '" "$FIXTURE_ROOT" 0
  runj "P7 plan S11 self-test rg -c ok P4 lexer blocked" checks ".claude/hooks/scope-guard.sh self-test | rg -c '^ok +P4 lexer blocked '" "$FIXTURE_ROOT" 0
  runj "P7 plan S11 self-test rg -c ok P4 lexer allowed" checks ".claude/hooks/scope-guard.sh self-test | rg -c '^ok +P4 lexer allowed '" "$FIXTURE_ROOT" 0
  runj "P7 plan S11 self-test rg -c ok P4 grammar allowed" checks ".claude/hooks/scope-guard.sh self-test | rg -c '^ok +P4 grammar allowed '" "$FIXTURE_ROOT" 0
  runj "P7 plan S11 self-test rg -c ok P4 grammar blocked" checks ".claude/hooks/scope-guard.sh self-test | rg -c '^ok +P4 grammar blocked '" "$FIXTURE_ROOT" 0
  runj "P7 plan S11 rg -c x7[2]m f" checks "rg -c 'x7[2]m f' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S11 rg -c bash heredoc quoted" checks "rg -c 'bash <<.E[O]F.' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S11 rg -c sed dollar-p" checks "rg -c 'sed -n .{1,2}[\$]p. f' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S11 rg -c LEXER header" checks "rg -c '^# LEXER [(]P4[)]:' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S11 rg -F -c tokenizer sentence" checks "rg -F -c 'a word the tokenizer does not model is rejected' .claude/agents/README.md" "$FIXTURE_ROOT" 0
  runj "P7 plan S11 rg -n removed config-env branch" checks "rg -n 'x.v === \"--config-[e]nv\"' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S11 rg -n removed ext-diff branch" checks "rg -n 'x.v === \"--ext-[d]iff\"' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S11 rg -n removed open-files branch" checks "rg -n 'x.v === \"--open-files-in-[p]ager\"' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S12 rg -c try readlinkSync" checks "rg -c 'try.*readlink[S]ync' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S12 self-test rg -c ok P5 write non-string" checks ".claude/hooks/scope-guard.sh self-test | rg -c '^ok +P5 write non-string file_path denied'" "$FIXTURE_ROOT" 0
  runj "P7 plan S12 rg -n removed internal error phrase" checks "rg -n 'internal error on the write path [(]' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S12 rg -n removed fail-open comment" checks "rg -n 'into an internal-error fail-[o]pen' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S4 .claude/hooks/scope-guard.sh self-test | rg -c '^ok +P7 '" checks ".claude/hooks/scope-guard.sh self-test | rg -c '^ok +P7 '" "$FIXTURE_ROOT" 0
  runj "P7 plan S4 .claude/hooks/scope-guard.sh self-test | rg -c '^ok +P7 plan '" checks ".claude/hooks/scope-guard.sh self-test | rg -c '^ok +P7 plan '" "$FIXTURE_ROOT" 0
  runj "P7 plan S4 .claude/hooks/scope-guard.sh self-test | rg -c '^ok +P7 drift '" checks ".claude/hooks/scope-guard.sh self-test | rg -c '^ok +P7 drift '" "$FIXTURE_ROOT" 0
  runj "P7 plan S5 rg -n 'same one' .claude/agents/plan-verifier.md" checks "rg -n 'same one' .claude/agents/plan-verifier.md" "$FIXTURE_ROOT" 0
  runj "P7 plan S5 rg -n 'these four commands' .claude/agents/plan-verifier.md" checks "rg -n 'these four commands' .claude/agents/plan-verifier.md" "$FIXTURE_ROOT" 0
  runj "P7 plan S5 rg -c 'scope-guard required commands: begin' .claude/agents/plan-verifier.md" checks "rg -c 'scope-guard required commands: begin' .claude/agents/plan-verifier.md" "$FIXTURE_ROOT" 0
  runj "P7 plan S5 rg -c 'scope-guard required commands: end' .claude/agents/plan-verifier.md" checks "rg -c 'scope-guard required commands: end' .claude/agents/plan-verifier.md" "$FIXTURE_ROOT" 0
  runj "P7 plan S5 rg -c 'HEAD_ARGS' .claude/agents/plan-verifier.md" checks "rg -c 'HEAD_ARGS' .claude/agents/plan-verifier.md" "$FIXTURE_ROOT" 0
  runj "P7 plan S5 rg -F -c 'git check-ignore -q' .claude/agents/plan-verifier.md" checks "rg -F -c 'git check-ignore -q' .claude/agents/plan-verifier.md" "$FIXTURE_ROOT" 0
  runj "P7 plan S5 git diff -U0 57db629 -- .claude/agents/plan-verifier.md" checks "git diff -U0 57db629 -- .claude/agents/plan-verifier.md" "$FIXTURE_ROOT" 0
  runj "P7 plan S6 rg -n 'same one' .claude/agents/architecture-reviewer.md" checks "rg -n 'same one' .claude/agents/architecture-reviewer.md" "$FIXTURE_ROOT" 0
  runj "P7 plan S6 rg -n 'these four commands' .claude/agents/architecture-reviewer.md" checks "rg -n 'these four commands' .claude/agents/architecture-reviewer.md" "$FIXTURE_ROOT" 0
  runj "P7 plan S6 rg -c 'scope-guard required commands: begin' .claude/agents/architecture-reviewer.md" checks "rg -c 'scope-guard required commands: begin' .claude/agents/architecture-reviewer.md" "$FIXTURE_ROOT" 0
  runj "P7 plan S6 rg -c 'scope-guard required commands: end' .claude/agents/architecture-reviewer.md" checks "rg -c 'scope-guard required commands: end' .claude/agents/architecture-reviewer.md" "$FIXTURE_ROOT" 0
  runj "P7 plan S6 rg -c 'HEAD_ARGS' .claude/agents/architecture-reviewer.md" checks "rg -c 'HEAD_ARGS' .claude/agents/architecture-reviewer.md" "$FIXTURE_ROOT" 0
  runj "P7 plan S6 git diff -U0 57db629 -- .claude/agents/architecture-reviewer.md" checks "git diff -U0 57db629 -- .claude/agents/architecture-reviewer.md" "$FIXTURE_ROOT" 0
  runj "P7 plan S7 rg -n 'sed -I' .claude/agents/README.md" checks "rg -n 'sed -I' .claude/agents/README.md" "$FIXTURE_ROOT" 0
  runj "P7 plan S7 rg -n 'sort -oFILE' .claude/agents/README.md" checks "rg -n 'sort -oFILE' .claude/agents/README.md" "$FIXTURE_ROOT" 0
  runj "P7 plan S7 rg -n 'uniq <in> <out>' .claude/agents/README.md" checks "rg -n 'uniq <in> <out>' .claude/agents/README.md" "$FIXTURE_ROOT" 0
  runj "P7 plan S7 rg -c 'scope-guard canonical: begin' .claude/agents/README.md" checks "rg -c 'scope-guard canonical: begin' .claude/agents/README.md" "$FIXTURE_ROOT" 0
  runj "P7 plan S7 rg -c 'scope-guard canonical: end' .claude/agents/README.md" checks "rg -c 'scope-guard canonical: end' .claude/agents/README.md" "$FIXTURE_ROOT" 0
  runj "P7 plan S7 rg -c 'HEAD_ARGS' .claude/agents/README.md" checks "rg -c 'HEAD_ARGS' .claude/agents/README.md" "$FIXTURE_ROOT" 0
  runj "P7 plan S7 rg -F -c 'a path the resolver cannot resolve is denied' .claude/agents/README.md" checks "rg -F -c 'a path the resolver cannot resolve is denied' .claude/agents/README.md" "$FIXTURE_ROOT" 0
  runj "P7 plan S7 git diff -U0 57db629 -- .claude/agents/README.md" checks "git diff -U0 57db629 -- .claude/agents/README.md" "$FIXTURE_ROOT" 0
  runj "P7 plan S9 git diff --numstat 57db629 -- INSIGHTS.md" checks "git diff --numstat 57db629 -- INSIGHTS.md" "$FIXTURE_ROOT" 0
  runj "P7 plan T12 rg -n 'realpathNearest' .claude/hooks/scope-guard.sh" checks "rg -n 'realpathNearest' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan T13 rg -n 'evalCmd' .claude/hooks/scope-guard.sh" checks "rg -n 'evalCmd' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan T19 git diff --stat 57db629" checks "git diff --stat 57db629" "$FIXTURE_ROOT" 0
  runj "P7 plan S13 self-test rg -c ok T7 garbage stdin" checks ".claude/hooks/scope-guard.sh self-test | rg -c '^ok +T7 garbage stdin fail-open'" "$FIXTURE_ROOT" 0
  runj "P7 plan S13 git diff -U0 scope-guard.sh" checks "git diff -U0 57db629 -- .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S13 self-test rg -c ok P4 lexer glob blocked" checks ".claude/hooks/scope-guard.sh self-test | rg -c '^ok +P4 lexer glob blocked '" "$FIXTURE_ROOT" 0
  runj "P7 plan S13 self-test rg -c ok P4 lexer glob allowed" checks ".claude/hooks/scope-guard.sh self-test | rg -c '^ok +P4 lexer glob allowed '" "$FIXTURE_ROOT" 0
  runj "P7 plan S13 self-test rg -c ok P5 dispatcher denies" checks ".claude/hooks/scope-guard.sh self-test | rg -c '^ok +P5 dispatcher denies '" "$FIXTURE_ROOT" 0
  runj "P7 plan S13 self-test rg -c ok P5 helper oracle" checks ".claude/hooks/scope-guard.sh self-test | rg -c '^ok +P5 helper oracle rejects evaluator exit 1'" "$FIXTURE_ROOT" 0
  runj "P7 plan S13 rg -c SG_ALLOW_RC line" checks "rg -c '^SG_ALLOW_RC=42\$' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S13 rg -c EXIT PROTOCOL header" checks "rg -c '^# EXIT PROTOCOL [(]P5[)]:' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S13 rg -c unquoted glob any position" checks "rg -c 'unquoted glob character at any positio[n]' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S13 rg -c five invariants" checks "rg -c 'five invariants' .claude/agents/README.md" "$FIXTURE_ROOT" 0
  runj "P7 plan S13 rg -F -c any-position phrase readme" checks "rg -F -c 'an unquoted glob character at any position' .claude/agents/README.md" "$FIXTURE_ROOT" 0
  runj "P7 plan S13 rg -F -c any-other-exit phrase readme" checks "rg -F -c 'any other evaluator exit is denied' .claude/agents/README.md" "$FIXTURE_ROOT" 0
  runj "P7 plan S13 rg -n removed lead-glob flag" checks "rg -n 'leadGlo[b]' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S13 rg -n removed first-char lexer sentence" checks "rg -n 'whose first character is an [u]nquoted' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S13 rg -n removed 1 allow case" checks "rg -n '^ *1[)] allow' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S13 rg -n removed 3 allow case" checks "rg -n '^ *3[)] allow' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S13 rg -n removed internal error exit phrase" checks "rg -n 'internal error [(]exit' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S13 rg -n removed process.exit 1 or 3" checks "rg -n 'process.exit[(][13][)]' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S13 rg -n removed 3 internal error comment" checks "rg -n '3 = internal erro[r]' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S13 rg -n removed ls glob after literal name" checks "rg -n 'lexer allowed ls glob after litera[l]' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0
  runj "P7 plan S13 rg -n removed four invariants readme" checks "rg -n 'four invariants' .claude/agents/README.md" "$FIXTURE_ROOT" 0
  runj "P7 plan S13 rg -n removed leading unquoted glob readme" checks "rg -n 'leading unquoted glob' .claude/agents/README.md" "$FIXTURE_ROOT" 0
  runj "P7 plan S4 rg -c removed S1 ok-count row" checks "rg -c 'self-test . rg -c .[\\^]ok .[\"]' .claude/hooks/scope-guard.sh" "$FIXTURE_ROOT" 0

  # -- P7 drift (S4/T15): the observed drift is fixed -- a CHECKS_EXACT command followed by
  # a safe redirection is admitted, and the newly admitted readonly git subcommands
  # (check-ignore, hash-object without -w/--stdin) are admitted from both bash profiles.
  runj "P7 drift self-test 2>&1 allowed"            checks   ".claude/hooks/scope-guard.sh self-test 2>&1"             "$FIXTURE_ROOT"        0
  runj "P7 drift self-test 2>&1 pipe tail allowed"  checks   ".claude/hooks/scope-guard.sh self-test 2>&1 | tail -1"   "$FIXTURE_ROOT"        0
  runj "P7 drift self-test redirect to file blocked" checks  ".claude/hooks/scope-guard.sh self-test > out"           "$FIXTURE_ROOT"        2
  runj "P7 drift self-test cwd server blocked"      checks   ".claude/hooks/scope-guard.sh self-test"                 "$FIXTURE_ROOT/server" 2
  runj "P7 drift git check-ignore readonly allowed" readonly "git check-ignore -q .harness/x"                         "$FIXTURE_ROOT"        0
  runj "P7 drift git check-ignore checks allowed"   checks   "git check-ignore -q .harness/x"                         "$FIXTURE_ROOT"        0
  runj "P7 drift git hash-object readonly allowed"  readonly "git hash-object f"                                      "$FIXTURE_ROOT"        0
  runj "P7 drift git hash-object checks allowed"    checks   "git hash-object f"                                      "$FIXTURE_ROOT"        0

  # -- S1 (retro-agent.plan.md), re-pathed by harness-retros S2: `write retro` profile.
  # R1-R5 below are this plan's own T1-T5, prefixed R so they do not collide with this
  # file's own T-numbering (S1 Files column). Fixtures (an existing retro file, a symlink
  # onto a plan) live in their own throwaway fake root (S1(h)/harness-retros C3), never
  # under the real repo tree, because the real .harness/retros/ now holds local files.
  RETRO_FAKE_ROOT=$(mktemp -d) || RETRO_FAKE_ROOT=""
  if [ -n "$RETRO_FAKE_ROOT" ]; then
    trap 'rm -rf "$RETRO_FAKE_ROOT"' RETURN
    mkdir -p "$RETRO_FAKE_ROOT/.harness/retros" "$RETRO_FAKE_ROOT/docs/plans"
    FIXTURE_ROOT="$RETRO_FAKE_ROOT"
    printf '# Retro: old\n' > "$RETRO_FAKE_ROOT/.harness/retros/old.retro.md"
    printf '# Plan\n' > "$RETRO_FAKE_ROOT/docs/plans/x.plan.md"
    ln -s ../../docs/plans/x.plan.md "$RETRO_FAKE_ROOT/.harness/retros/link.retro.md"
    RETRO_STATUS_BEFORE=$(git -C "$REAL_ROOT" status --short)
    RETRO_STATUS_IGNORED_BEFORE=$(git -C "$REAL_ROOT" status --short --ignored -- .harness)

    # -- R1: write retro, allowed (plan T1) -- moved into the fake root (harness-retros
    # C3/S2(f)): the real repo root's .harness/retros/ holds real local files, so a
    # Write-dependent row must not run against it.
    runr "R1 write new retro"              retro Write ".harness/retros/newfeature.retro.md" none "# Retro: newfeature" none 1
    runr "R1 edit entries marker"          retro Edit  ".harness/retros/newfeature.retro.md" "<!-- newest first: retro-entries -->" "<!-- newest first: retro-entries -->
### Iteration 1" none 1
    runr "R1 edit class-labels marker"     retro Edit  ".harness/retros/newfeature.retro.md" "<!-- newest first: class-labels -->" "<!-- newest first: class-labels -->
- \`new-label\` — def · first seen: iteration 1" none 1
    runrd "R1 full dispatch write allowed" retro Write ".harness/retros/newfeature-rd.retro.md" none "# Retro: newfeature-rd" none 0
    runr "R1 dotted name allowed"          retro Write ".harness/retros/v1.2.retro.md" none "# Retro: v1.2" none 1

    # -- R2: write retro, blocked (plan T2: old location, wrong paths, symlink, existing
    # file, bad edits, bad tool input, full dispatch) --
    runr "R2 old location"                 retro Write "docs/plans/x.retro.md"           none "x" none 0
    runr "R2 plan path"                    retro Write "docs/plans/x.plan.md"           none "x" none 0
    runr "R2 nested retro"                 retro Write ".harness/retros/sub/x.retro.md" none "x" none 0
    runr "R2 wrong dir retro"              retro Write ".harness/x.retro.md"            none "x" none 0
    runr "R2 root INSIGHTS"                retro Write "INSIGHTS.md"                    none "x" none 0
    runr "R2 server INSIGHTS"              retro Write "server/INSIGHTS.md"             none "x" none 0
    runr "R2 agent file"                   retro Write ".claude/agents/retro-writer.md" none "x" none 0
    runr "R2 traversal"                    retro Write ".harness/retros/../analysis/x.md" none "x" none 0
    runr "R2 outside repo"                 retro Write "/etc/hosts"                     none "x" none 0
    runr "R2 edit on plan path"            retro Edit  "docs/plans/x.plan.md" "<!-- newest first: retro-entries -->" "<!-- newest first: retro-entries -->
more" none 0
    runr "A3 write retro blocks analysis path" retro Write ".harness/analysis/x.md" none "x" none 0
    runr "R2 symlink to plan"              retro Edit ".harness/retros/link.retro.md" "<!-- newest first: retro-entries -->" "<!-- newest first: retro-entries -->
more" none 0
    runr "R2 write over existing"          retro Write ".harness/retros/old.retro.md"  none "x" none 0
    runr "R2 old_string not a marker"      retro Edit ".harness/retros/x.retro.md" "### Iteration 1" "### Iteration 1
more" none 0
    runr "R2 old_string marker plus text"  retro Edit ".harness/retros/x.retro.md" "<!-- newest first: retro-entries -->
extra" "<!-- newest first: retro-entries -->
extra
more" none 0
    runr "R2 new_string no marker"         retro Edit ".harness/retros/x.retro.md" "<!-- newest first: retro-entries -->" "not the marker" none 0
    runr "R2 marker twice"                 retro Edit ".harness/retros/x.retro.md" "<!-- newest first: retro-entries -->" "<!-- newest first: retro-entries -->
foo
<!-- newest first: retro-entries -->" none 0
    runr "R2 replace_all true"             retro Edit ".harness/retros/x.retro.md" "<!-- newest first: retro-entries -->" "<!-- newest first: retro-entries -->
more" true 0
    runr "R2 NotebookEdit"                 retro NotebookEdit ".harness/retros/x.retro.md" none "x" none 0
    runr "R2 missing tool_name"            retro none ".harness/retros/x.retro.md" none "x" none 0
    runw_json "R2 no file_path"            retro '{"tool_name":"Write","tool_input":{}}' 0
    runr "R2 empty stem"                   retro Write ".harness/retros/.retro.md"  none "x" none 0
    runr "R2 hidden stem"                  retro Write ".harness/retros/.x.retro.md" none "x" none 0
    runrd "R2 full dispatch old location write" retro Write "docs/plans/x.retro.md" none "x" none 2
    runrd "R2 full dispatch plan write"    retro Write "docs/plans/x.plan.md" none "x" none 2
    runrd "R2 full dispatch insights write" retro Write "INSIGHTS.md" none "x" none 2
    runrd "R2 full dispatch non-marker edit" retro Edit ".harness/retros/x.retro.md" "### Iteration 1" "### Iteration 1
more" none 2
    runrd "R2 full dispatch empty stem" retro Write ".harness/retros/.retro.md" none "x" none 2

    RETRO_STATUS_AFTER=$(git -C "$REAL_ROOT" status --short)
    RETRO_STATUS_IGNORED_AFTER=$(git -C "$REAL_ROOT" status --short --ignored -- .harness)
    if [ "$RETRO_STATUS_BEFORE" = "$RETRO_STATUS_AFTER" ] && [ "$RETRO_STATUS_IGNORED_BEFORE" = "$RETRO_STATUS_IGNORED_AFTER" ]; then
      printf 'ok    %s\n' "R5 write retro self-test leaves the repo working tree unchanged"
    else
      printf 'FAIL  %s (before=%s after=%s ignored_before=%s ignored_after=%s)\n' "R5 write retro self-test leaves the repo working tree unchanged" "$RETRO_STATUS_BEFORE" "$RETRO_STATUS_AFTER" "$RETRO_STATUS_IGNORED_BEFORE" "$RETRO_STATUS_IGNORED_AFTER"
      fails=$((fails + 1))
    fi

    rm -rf "$RETRO_FAKE_ROOT"
    FIXTURE_ROOT="$BASE_FIXTURE"
    trap - RETURN
  else
    printf 'FAIL  %s (could not create the retro fake root)\n' "R1 write retro fixtures"
    fails=$((fails + 1))
  fi

  # -- R3: write docs/write tests are not loosened — still deny docs/plans/** including
  # *.retro.md, and neither allows anything under .harness/** (plan T3, extended by A3) --
  runw "R3 write docs still blocks retro" docs "docs/plans/x.retro.md" 0
  runw "R3 write docs still blocks plan"  docs "docs/plans/x.plan.md" 0
  runw "R3 write docs still allows topic" docs "docs/some-topic.md"   1
  runw "R3 write docs blocks harness retro"    docs ".harness/retros/x.retro.md" 0
  runw "R3 write docs blocks harness analysis" docs ".harness/analysis/x.md"     0
  runw "R3 write tests blocks harness retro"    tests ".harness/retros/x.retro.md" 0
  runw "R3 write tests blocks harness analysis" tests ".harness/analysis/x.md"     0

  # -- R4: dispatch (plan T4) --
  rund "R4 write retros typo (misconfigured)" write retros 2
  RETRO_GARBAGE_OUT=$(printf 'garbage' | "$SELF" write retro 2>&1)
  RETRO_GARBAGE_RC=$?
  if [ "$RETRO_GARBAGE_RC" = 0 ] && [ -n "$RETRO_GARBAGE_OUT" ]; then
    printf 'ok    %s\n' "R4 write retro garbage stdin fail-open (full dispatch)"
  else
    printf 'FAIL  %s (rc=%s out=%s)\n' "R4 write retro garbage stdin fail-open (full dispatch)" "$RETRO_GARBAGE_RC" "$RETRO_GARBAGE_OUT"
    fails=$((fails + 1))
  fi

  # -- harness-retros S2: `write analysis` profile. A1-A5 mirror R1-R5 for the new
  # profile, in their own throwaway fake root (Test plan T3), never the real
  # .harness/analysis/, which may hold real local files. --
  ANALYSIS_FAKE_ROOT=$(mktemp -d) || ANALYSIS_FAKE_ROOT=""
  if [ -n "$ANALYSIS_FAKE_ROOT" ]; then
    trap 'rm -rf "$ANALYSIS_FAKE_ROOT"' RETURN
    mkdir -p "$ANALYSIS_FAKE_ROOT/.harness/analysis" "$ANALYSIS_FAKE_ROOT/.harness/retros" "$ANALYSIS_FAKE_ROOT/.claude/agents"
    FIXTURE_ROOT="$ANALYSIS_FAKE_ROOT"
    printf '# Analysis: old\n' > "$ANALYSIS_FAKE_ROOT/.harness/analysis/old.md"
    printf '# Retro: x\n' > "$ANALYSIS_FAKE_ROOT/.harness/retros/x.retro.md"
    ln -s ../retros/x.retro.md "$ANALYSIS_FAKE_ROOT/.harness/analysis/link.md"
    ln -s ../../.claude/agents/new.md "$ANALYSIS_FAKE_ROOT/.harness/analysis/ghost.md"
    ANALYSIS_STATUS_BEFORE=$(git -C "$REAL_ROOT" status --short)
    ANALYSIS_STATUS_IGNORED_BEFORE=$(git -C "$REAL_ROOT" status --short --ignored -- .harness)

    # -- A1: write analysis, allowed (plan T3) --
    runr "A1 write new analysis"           analysis Write ".harness/analysis/2026-09-26.md"   none "# Analysis" none 1
    runr "A1 write second dated analysis"  analysis Write ".harness/analysis/2026-09-26-2.md" none "# Analysis" none 1
    runrd "A1 full dispatch write allowed" analysis Write ".harness/analysis/2026-09-26-rd.md" none "# Analysis" none 0
    runr "A1 dotted name allowed"           analysis Write ".harness/analysis/2026-09-26.v2.md" none "# Analysis" none 1

    # -- A2: write analysis, blocked (plan T3: wrong paths, symlinks, existing file, bad
    # tool input, full dispatch) --
    runr "A2 retro path"                   analysis Write ".harness/retros/x.retro.md" none "x" none 0
    runr "A2 nested analysis"              analysis Write ".harness/analysis/sub/x.md" none "x" none 0
    runr "A2 non-md analysis"              analysis Write ".harness/analysis/x.txt"    none "x" none 0
    runr "A2 wrong dir analysis"           analysis Write ".harness/x.md"              none "x" none 0
    runr "A2 agent file"                   analysis Write ".claude/agents/planner.md"  none "x" none 0
    runr "A2 hook file"                    analysis Write ".claude/hooks/scope-guard.sh" none "x" none 0
    runr "A2 root AGENTS.md"               analysis Write "AGENTS.md"                  none "x" none 0
    runr "A2 server INSIGHTS"              analysis Write "server/INSIGHTS.md"         none "x" none 0
    runr "A2 client CLAUDE.md"             analysis Write "client/CLAUDE.md"           none "x" none 0
    runr "A2 plan path"                    analysis Write "docs/plans/x.plan.md"       none "x" none 0
    runr "A2 traversal"                    analysis Write ".harness/analysis/../retros/x.retro.md" none "x" none 0
    runr "A2 outside repo"                 analysis Write "/etc/hosts"                 none "x" none 0
    runr "A2 symlink to existing retro"    analysis Write ".harness/analysis/link.md"  none "x" none 0
    runr "A2 dangling symlink to harness"  analysis Write ".harness/analysis/ghost.md" none "x" none 0
    runr "A2 write over existing"          analysis Write ".harness/analysis/old.md"   none "x" none 0
    runr "A2 Edit on analysis path"        analysis Edit  ".harness/analysis/new.md"   "x" "y" none 0
    runr "A2 NotebookEdit"                 analysis NotebookEdit ".harness/analysis/x.md" none "x" none 0
    runr "A2 missing tool_name"            analysis none ".harness/analysis/x.md"      none "x" none 0
    runw_json "A2 no file_path"            analysis '{"tool_name":"Write","tool_input":{}}' 0
    runr "A2 empty stem"                   analysis Write ".harness/analysis/.md"   none "x" none 0
    runr "A2 hidden stem"                  analysis Write ".harness/analysis/.x.md" none "x" none 0
    runrd "A2 full dispatch plan write"    analysis Write ".claude/agents/planner.md"  none "x" none 2
    runrd "A2 full dispatch retro write"   analysis Write ".harness/retros/x.retro.md" none "x" none 2
    runrd "A2 full dispatch edit"          analysis Edit  ".harness/analysis/new.md"   "x" "y" none 2
    runrd "A2 full dispatch write over existing" analysis Write ".harness/analysis/old.md" none "x" none 2
    runrd "A2 full dispatch empty stem" analysis Write ".harness/analysis/.md" none "x" none 2

    ANALYSIS_STATUS_AFTER=$(git -C "$REAL_ROOT" status --short)
    ANALYSIS_STATUS_IGNORED_AFTER=$(git -C "$REAL_ROOT" status --short --ignored -- .harness)
    if [ "$ANALYSIS_STATUS_BEFORE" = "$ANALYSIS_STATUS_AFTER" ] && [ "$ANALYSIS_STATUS_IGNORED_BEFORE" = "$ANALYSIS_STATUS_IGNORED_AFTER" ]; then
      printf 'ok    %s\n' "A5 write analysis self-test leaves the repo working tree unchanged"
    else
      printf 'FAIL  %s (before=%s after=%s ignored_before=%s ignored_after=%s)\n' "A5 write analysis self-test leaves the repo working tree unchanged" "$ANALYSIS_STATUS_BEFORE" "$ANALYSIS_STATUS_AFTER" "$ANALYSIS_STATUS_IGNORED_BEFORE" "$ANALYSIS_STATUS_IGNORED_AFTER"
      fails=$((fails + 1))
    fi

    rm -rf "$ANALYSIS_FAKE_ROOT"
    FIXTURE_ROOT="$BASE_FIXTURE"
    trap - RETURN
  else
    printf 'FAIL  %s (could not create the analysis fake root)\n' "A1 write analysis fixtures"
    fails=$((fails + 1))
  fi

  # -- A4: dispatch (plan T5) --
  rund "A4 write analyses typo (misconfigured)" write analyses 2
  ANALYSIS_GARBAGE_OUT=$(printf 'garbage' | "$SELF" write analysis 2>&1)
  ANALYSIS_GARBAGE_RC=$?
  if [ "$ANALYSIS_GARBAGE_RC" = 0 ] && [ -n "$ANALYSIS_GARBAGE_OUT" ]; then
    printf 'ok    %s\n' "A4 write analysis garbage stdin fail-open (full dispatch)"
  else
    printf 'FAIL  %s (rc=%s out=%s)\n' "A4 write analysis garbage stdin fail-open (full dispatch)" "$ANALYSIS_GARBAGE_RC" "$ANALYSIS_GARBAGE_OUT"
    fails=$((fails + 1))
  fi

  # -- P3 (AC1): a helper called with no fixture root refuses -- one row per tree-reading
  # helper (7), each run in a subshell so the inner refusal's own `fails` increment stays
  # local and is not double-counted against the outer run.
  for p3helper in runb runj runj_hostcwd runw runw_json runr runrd; do
    p3out=$(
      unset FIXTURE_ROOT
      case "$p3helper" in
        (runb) runb "p3 probe" readonly "true" 1 ;;
        (runj) runj "p3 probe" readonly "true" none 0 ;;
        (runj_hostcwd) runj_hostcwd "p3 probe" readonly "true" "$REAL_ROOT" 0 ;;
        (runw) runw "p3 probe" tests "server/test/x.test.ts" 1 ;;
        (runw_json) runw_json "p3 probe" tests "{}" 1 ;;
        (runr) runr "p3 probe" tests Write "server/test/x.test.ts" none "x" none 1 ;;
        (runrd) runrd "p3 probe" retro Write ".harness/retros/x.retro.md" none "x" none 0 ;;
      esac
    )
    if printf '%s' "$p3out" | grep -q "no fixture root"; then
      printf 'ok    %s\n' "P3 helper without fixture root refuses ($p3helper)"
    else
      printf 'FAIL  %s (out=%s)\n' "P3 helper without fixture root refuses ($p3helper)" "$p3out"
      fails=$((fails + 1))
    fi
  done

  # -- P3 (AC1): a helper called with the real repo root as its fixture root also refuses --
  p3out=$(
    FIXTURE_ROOT="$REAL_ROOT"
    runb "p3 probe" readonly "true" 1
  )
  if printf '%s' "$p3out" | grep -q "no fixture root"; then
    printf 'ok    %s\n' "P3 helper with the real root refuses"
  else
    printf 'FAIL  %s (out=%s)\n' "P3 helper with the real root refuses" "$p3out"
    fails=$((fails + 1))
  fi

  # -- P3 (AC1): the whole self-test run leaves the real working tree unchanged, including
  # ignored files -- compared against the status captured before the first fixture was built.
  SELFTEST_STATUS_AFTER=$(git -C "$REAL_ROOT" status --short)
  SELFTEST_STATUS_IGNORED_AFTER=$(git -C "$REAL_ROOT" status --short --ignored)
  if [ "$SELFTEST_STATUS_BEFORE" = "$SELFTEST_STATUS_AFTER" ] && [ "$SELFTEST_STATUS_IGNORED_BEFORE" = "$SELFTEST_STATUS_IGNORED_AFTER" ]; then
    printf 'ok    %s\n' "P3 self-test leaves the real working tree unchanged"
  else
    printf 'FAIL  %s (before=%s after=%s ignored_before=%s ignored_after=%s)\n' "P3 self-test leaves the real working tree unchanged" "$SELFTEST_STATUS_BEFORE" "$SELFTEST_STATUS_AFTER" "$SELFTEST_STATUS_IGNORED_BEFORE" "$SELFTEST_STATUS_IGNORED_AFTER"
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
      tests|docs|retro|analysis) ;;
      *) block_msg "write" "$SUB" "misconfigured scope-guard: unknown write profile '$SUB' (expected tests|docs|retro|analysis) — a configuration fault in the calling agent's frontmatter, not a runtime error"; exit 2 ;;
    esac
    RAW=$(cat) || allow
    REASON=$(printf '%s' "$RAW" | write_eval "$SUB"); RC=$?
    case "$RC" in
      "$SG_ALLOW_RC") allow ;; # node already warned on stderr for the two fail-open cases
      0) block_msg "write" "$SUB" "${REASON:-evaluator gave no reason — denied}"; exit 2 ;;
      *) block_msg "write" "$SUB" "evaluator exited $RC (crash, kill or unexpected code) — denied"; exit 2 ;;
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
      "$SG_ALLOW_RC") allow ;; # node already warned on stderr for the two fail-open cases
      0) block_msg "bash" "$SUB" "${REASON:-evaluator gave no reason — denied}"; exit 2 ;;
      *) block_msg "bash" "$SUB" "evaluator exited $RC (crash, kill or unexpected code) — denied"; exit 2 ;;
    esac
    ;;
  self-test) self_test ;;
  *) block_msg "mode" "${1:-}" "misconfigured scope-guard: unknown mode '${1:-}' (expected write|bash|self-test) — a configuration fault in the calling agent's frontmatter, not a runtime error"; exit 2 ;;
esac
