# Retro: review-agents

Per-iteration retrospective for `docs/plans/review-agents.plan.md`, written only by the
`retro-writer` subagent (rules: `.claude/agents/retro-writer.md`). Append-only: new class
labels and new entries go directly under their marker line, newest first. A clean
reviewer round writes nothing.

## Class labels
<!-- newest first: class-labels -->
- `fix-closed-without-review` — a fix round is written, verified and closed by the orchestrating session with no independent reviewer round over the result · first seen: iteration 4
- `unverified-report-claim` — an Implementation Report states a tool or library behaviour as verified, and an independent check contradicts it · first seen: iteration 3
- `path-resolution-gap` — a guard judges a path in a form other than the location the tool will actually read, write or execute (relative to a changeable cwd, pointed at another tree, symlinked, lexical only) · first seen: iteration 2
- `weak-self-test-oracle` — a `self-test` row or its harness stays green although the rule it names could be broken (exit-code-only assertion, missing row, hand-built JSON) · first seen: iteration 2
- `allowlist-spelling-bypass` — an allowlisted Bash head in `scope-guard.sh` reaches code execution or a file write through a spelling, flag form, argument or config/plugin path that the per-token checks did not enumerate · first seen: iteration 1
- `fail-open-guard-default` — the guard allows everything when its own configuration (mode/profile argument) is wrong · first seen: iteration 1
- `guard-policy-text-drift` — two texts that must agree about the guard (hook code, agent prompts, README, plan Verify/Test/Constraint cells) state different allowed sets or behaviour · first seen: iteration 1
- `unplanned-protocol-output` — a session-protocol output (an `INSIGHTS.md` entry) lands in the change set without any plan item covering it · first seen: iteration 1
- `acceptance-evidence-missing` — an acceptance item cannot be verified because the evidence it needs (a probe run, a pre-edit baseline) was never produced · first seen: iteration 1
- `no-adversarial-review-gate` — the permission boundary has no reviewer whose remit and status line cover bypass testing, so bypasses surface only as hand-offs outside any gate · first seen: iteration 1

## Entries
<!-- newest first: retro-entries -->
### Iteration 4 — plan rev 7 reviewed · 2026-09-25
**Inputs:** no reviewer report exists for rev 7 ("No reviewer re-run by user decision", `review-agents.plan.md:157`). Evidence: main-session round map and rev 7 point-fix evidence (`index.md` round 4 and *Main-session evidence*), commit `4c0b51a` (`Base → HEAD` cb195fb → 4c0b51a), the rev 7 `## Revisions` line (`review-agents.plan.md:335`), and main session, retro-agent S1 verification (2026-09-25): a dangling symlink passed every write profile at `4c0b51a` (recorded in the working-tree `INSIGHTS.md` 2026-09-25 `realpathNearest` entry; fixed in the working tree by retro-agent rev 2, not in `4c0b51a`).
**Findings:**
| # | Class label | Finding (evidence) | Root cause | Prior round missed it because | Prior fix |
|---|-------------|--------------------|------------|-------------------------------|-----------|
| 1 | `path-resolution-gap` | a symlink whose target does not exist passes every write profile at `4c0b51a`: `realpathNearest` falls back to the logical basename, so the logical and "resolved" paths coincide, and `existsSync` reports the symlink as absent (main session, retro-agent S1 verification; `git show 4c0b51a:.claude/hooks/scope-guard.sh` `:712-718`) | verification gap — the Decisions require the symlink-resolved check (`review-agents.plan.md:45`), but the only fixture links to an existing directory (`ln -s ../src`, `4c0b51a:.claude/hooks/scope-guard.sh:1179-1181`) | T10's symlink row cannot fail for a dangling target | point-fix (S8(e), rev 4, and S16, rev 5: one existing-target fixture, moved but not widened) |
| 2 | `fix-closed-without-review` | S25/T17 (four enumerated fixes: bare shell invoker, `sed` clusters with `i`/`I`/`f`, `sort` cluster with `o`, `uniq` > 1 operand) were written and verified by the main session only, and the plan closed at `4c0b51a` (`review-agents.plan.md:157,335`; `index.md` round 4) | process deviation — after the fix-loop budget is spent, the Flow only says the main session "stops" and asks (`4c0b51a:.claude/agents/README.md:65`); it has no rule that an in-place fix is re-reviewed before the plan closes | — | new |
| 3 | `no-adversarial-review-gate` | finding 1 was found by a later plan's verification, not by any review-agents gate; the main session had twice judged a round the last one and twice found a critical class afterwards (`index.md`, orchestration facts) | spec gap — O1 still excludes a security reviewer at rev 7 (`review-agents.plan.md:274`) | no reviewer can fail a round on a bypass | point-fix (rev 7 fixed the rev 6 hand-offs in S25; no gate added) |
**Why the prior checks were green:** `path-resolution-gap` — every path fixture exercises one easy form (existing target, lexical `clones/x`), and `pathArgOk` stayed lexical, recorded "Known and **not** fixed" at rev 7 (`review-agents.plan.md:335`); `no-adversarial-review-gate` — rev 7 had no reviewer round at all, so nothing could go red. Also carried unfixed into the closed plan, not counted again: the T13/S22 and C5/README failure-policy contradictions (`guard-policy-text-drift`) and the ESLint claim (`unverified-report-claim`), all at `review-agents.plan.md:335`. S25 itself is a point-fix of `allowlist-spelling-bypass` (per-head cluster checks at `4c0b51a:.claude/hooks/scope-guard.sh:577,597`); with no review round, no new spelling bypass has been looked for since.
**Recurrence:** `path-resolution-gap`, `no-adversarial-review-gate`
**Converging:** no (`path-resolution-gap`, `no-adversarial-review-gate`)
**Decision for next revision:** Before review-agents is reopened or closed again, run one adversarial review of `scope-guard.sh` whose unrefuted bypass fails the gate, and replace every per-head check and every path check it covers with a class-level invariant (argument allowlist per head, one symlink-following resolver for every judged path) proven by full-dispatch probes, including dangling symlinks and stdin-fed shells.
**Metrics:**
| Class label | it 1 | it 2 | it 3 | it 4 |
|-------------|------|------|------|------|
| `allowlist-spelling-bypass` | 3 | 2 | 4 | 0 |
| `path-resolution-gap` | 0 | 2 | 1 | 1 |
| `fail-open-guard-default` | 1 | 0 | 0 | 0 |
| `guard-policy-text-drift` | 3 | 2 | 2 | 0 |
| `weak-self-test-oracle` | 0 | 1 | 1 | 0 |
| `unplanned-protocol-output` | 1 | 1 | 0 | 0 |
| `acceptance-evidence-missing` | 2 | 0 | 0 | 0 |
| `no-adversarial-review-gate` | 1 | 1 | 1 | 1 |
| `unverified-report-claim` | 0 | 0 | 1 | 0 |
| `fix-closed-without-review` | 0 | 0 | 0 | 1 |
### Iteration 3 — plan rev 6 reviewed · 2026-09-25
**Inputs:** implementer report on rev 6 (`Base → HEAD` cb195fb → working tree, later committed in `4c0b51a`), architecture-reviewer report on rev 6 (cb195fb → working tree), plan-verifier report on rev 6 (cb195fb → working tree), main-session reproduction of the verifier's hand-offs (`index.md`: 12 probes through the full JSON dispatch, "exit 0 in both `readonly` and `checks`"). Line numbers in quotes refer to the rev 6 working tree.
**Findings:**
| # | Class label | Finding (evidence) | Root cause | Prior round missed it because | Prior fix |
|---|-------------|--------------------|------------|-------------------------------|-----------|
| 1 | `allowlist-spelling-bypass` | `cat server/clones/x/y.sh \| bash`, `printf … \| sh`, `bash -s` pass both profiles (plan-verifier rev 6, *Handed off*: "`scope-guard.sh:537-540`: shell-invoker без позиційних аргументів … повертає "allowed""; reproduced exit 0, `index.md`) | wrong abstraction — the shell-invoker branch judges only the program text visible in its arguments; a bare shell reads its program from stdin (`INSIGHTS.md` 2026-09-25 "a Bash allowlist that recurses into `bash -c` still passed `cat x.sh \| bash`") | no T5/T10/T12/T14/T15 row feeds a shell from stdin; verifier: "жоден self-test рядок їх не покриває" | point-fix (rev 6: S20 was a class-fix for `pnpm` script/`exec` arguments only, `review-agents.plan.md:78-89`; S19 enumerated `cd`/`git -C`; the shell-invoker branch and the `readonly` heads kept per-token checks) |
| 2 | `allowlist-spelling-bypass` | `sed -I` (BSD in-place, macOS) and clustered `-ni` write files (plan-verifier rev 6, *Handed off*: `scope-guard.sh:569`) | wrong abstraction — per-token `-i*` denylist; short-flag clusters are not parsed | T5/T10 probe only `sed -i` and `sed -f` as separate tokens (`review-agents.plan.md:210,215`) | point-fix (S8(c), rev 4) |
| 3 | `allowlist-spelling-bypass` | attached `sort -o<file>` writes a file (plan-verifier rev 6, *Handed off*: `scope-guard.sh:279`) | wrong abstraction — `sort -o` matched only as a separate token | no row with the attached form | point-fix (rev 4 "`sort -o`" in *Rejected in any segment*, `cb195fb:…plan.md:51`) |
| 4 | `allowlist-spelling-bypass` | `uniq <in> <out>` writes its second operand (plan-verifier rev 6, *Handed off*: `scope-guard.sh:286`) | spec gap — the `readonly` list admits `uniq` by head with no argument rule (`review-agents.plan.md:47`), contrary to C6 "allowlists of behaviour, not only of heads" (`:27`) | no `uniq` row at all | new (first `uniq` case; class already recurring) |
| 5 | `path-resolution-gap` | `pathArgOk` checks `..`, `clones` and absolute paths lexically, without `realpath`; a symlink inside a package is not resolved (plan-verifier rev 6, *Handed off*: `scope-guard.sh:345-351`) | spec gap — S20's path rule is specified lexically ("relative, no `..` segment, not under `clones/`", `review-agents.plan.md:85`) although S8(e) had already made "judge the resolved path" the rule for Write paths (`:45`) | T15 path rows are lexical only (`clones/x`, `../client`, `review-agents.plan.md:220`) | point-fix (S19, rev 6: `cd` and `git -C` rejected, cwd compared, no single resolver for every judged path) |
| 6 | `guard-policy-text-drift` | C5, *Failure policy* and README say an unresolvable `$CLAUDE_PROJECT_DIR` fails open; the code policy-denies (plan-verifier rev 6, C5 `partial` (a): "`:1176-1183` → `:150-152`") | verification gap — no row exercises an unresolvable root; T16 greps phrases (`review-agents.plan.md:221`) | the text was synced by hand-written lists (S22/S23) | point-fix (S22, S23, rev 6) |
| 7 | `guard-policy-text-drift` | T13 expects `rg 'output-type'` → exit 1, while S22 requires the line "`-T err-long`, never `--output-type`" (plan-verifier rev 6, T13 and S14 rows: "Це суперечність усередині плану") | spec gap — the Update-mode revision added S22 without re-deriving T13, which pins the same file | T13 was not revised in rev 6 | point-fix (S14/S22) |
| 8 | `weak-self-test-oracle` | `runj_hostcwd` and one row build hook JSON with `printf`, not `node … JSON.stringify` as C5 requires (plan-verifier rev 6, C5 `partial` (b): "`:819-825` і рядок `:1087`") | verification gap — C5 states the rule; no Verify cell checks the harness against it | S21 tightened `rund` only | point-fix (S21, rev 6) |
| 9 | `unverified-report-claim` | the implementer's "ESLint 10 config lookup — now VERIFIED" cites `locateConfigFileToUse`, which serves `--inspect-config`; the lint path searches per file directory (implementer rev 6, *Unverified tool facts*; plan-verifier rev 6, *Handed off*: "`config-loader.js:385-393,425-435`") | verification gap — a tool-behaviour claim traced through one function, with no executed probe, was reported as VERIFIED | — | new |
| 10 | `no-adversarial-review-gate` | findings 1–5 sit under *Handed off*, found "читанням коду, я їх не запускав"; plan-verifier 0 not met, architecture-reviewer `Clean`; the main session had to reproduce them (`index.md`) | spec gap — O1 unchanged (`review-agents.plan.md:274`) | no reviewer can fail a round on a bypass | point-fix (rev 6 fixed the rev 5 hand-offs in S19/S20; no gate added) |
**Why the prior checks were green:** `allowlist-spelling-bypass` — every T-matrix is the enumeration of the spellings the previous hand-off named, so `0 failing case(s)` (181 `ok` rows, implementer rev 6) proved nothing about unnamed spellings, and S20's allowlist covered only `pnpm`/`exec`, where no new bypass was found; `path-resolution-gap` — cwd rows and path rows test the lexical form only; `guard-policy-text-drift` — T13/T16 grep phrases, not behaviour; `weak-self-test-oracle` — S21 fixed one helper, not the harness rule; `no-adversarial-review-gate` — unchanged since iteration 1.
**Recurrence:** `allowlist-spelling-bypass`, `path-resolution-gap`, `guard-policy-text-drift`, `weak-self-test-oracle`, `no-adversarial-review-gate`
**Converging:** no (`allowlist-spelling-bypass`, `path-resolution-gap`, `guard-policy-text-drift`, `weak-self-test-oracle`, `no-adversarial-review-gate`)
**Decision for next revision:** Extend the S20 argument-allowlist invariant to every remaining head (drop or wrap `sed`, `sort`, `uniq` and bare shell invokers whose grammar cannot be allowlisted), route every path the guard judges through one symlink-following resolver, and make a failing full-dispatch bypass probe block the round before any round is declared the last.
**Metrics:**
| Class label | it 1 | it 2 | it 3 |
|-------------|------|------|------|
| `allowlist-spelling-bypass` | 3 | 2 | 4 |
| `path-resolution-gap` | 0 | 2 | 1 |
| `fail-open-guard-default` | 1 | 0 | 0 |
| `guard-policy-text-drift` | 3 | 2 | 2 |
| `weak-self-test-oracle` | 0 | 1 | 1 |
| `unplanned-protocol-output` | 1 | 1 | 0 |
| `acceptance-evidence-missing` | 2 | 0 | 0 |
| `no-adversarial-review-gate` | 1 | 1 | 1 |
| `unverified-report-claim` | 0 | 0 | 1 |
### Iteration 2 — plan rev 5 reviewed · 2026-09-25
**Inputs:** implementer report on rev 5 (`Base → HEAD` cb195fb → working tree, later committed in `4c0b51a`), architecture-reviewer report on rev 5 (cb195fb → working tree), plan-verifier report on rev 5 (cb195fb → working tree), main-session round map (`index.md` round 2). Findings 3–4 come from the rev 6 planner's own re-check, whose report was not preserved: reconstructed from `review-agents.plan.md:76,78-82,125,333`.
**Findings:**
| # | Class label | Finding (evidence) | Root cause | Prior round missed it because | Prior fix |
|---|-------------|--------------------|------------|-------------------------------|-----------|
| 1 | `path-resolution-gap` | `cd <dir> && .claude/hooks/scope-guard.sh self-test` and `cd … && pnpm --dir server test` run code from `server/clones/**` (plan-verifier rev 5, *Handed off*: "`scope-guard.sh:311-333`: записи `CHECKS_EXACT` — відносні шляхи … `cd` дозволено в тому самому рядку") | wrong abstraction — exact-string and bare-package-name allowlist entries are relative paths judged per segment while an earlier segment re-points them (`review-agents.plan.md:71`) | every T12 row runs with cwd = repo root; no row has a `cd` prefix or a foreign cwd (`review-agents.plan.md:217`) | point-fix (S15(a)/(f), rev 5: fixed value list and four exact strings, no cwd invariant; earlier S8(e), rev 4, resolved symlinks for Write paths only) |
| 2 | `path-resolution-gap` | `git -C <dir>` / `--git-dir` / `--work-tree` can load an untrusted clone's `.git/config` (`core.fsmonitor`/`core.pager`) (rev 6 planner re-check, reconstructed: `review-agents.plan.md:76`) | wrong abstraction — same shape as finding 1: the head is allowed, the tree it acts on is not judged | no row points `git` at another tree | point-fix (as finding 1) |
| 3 | `allowlist-spelling-bypass` | a second `--dir=`/`-C<path>` value slips past `dirValues`, and `npm -C` means `--prefix` (rev 6 planner re-check, reconstructed: `review-agents.plan.md:125`) | wrong abstraction — S15(a) validates the space-separated value spelling only | T12 rows use only `--dir <value>` as separate tokens (`review-agents.plan.md:217`) | point-fix (S15(a), rev 5) |
| 4 | `allowlist-spelling-bypass` | script forms forward arguments (`pnpm --dir server test --config src/db/seed.ts`), `--reporter=./x.js`, `depcruise --webpack-config`, `eslint -f ./fmt.js` load code by path (rev 6 planner re-check, reconstructed: `review-agents.plan.md:78-82`) | wrong abstraction — the planner's own words: "the S8/S15 flag checks are denylists over programs with wide CLI surfaces" (`review-agents.plan.md:78`) | S15(b) rows probe only `exec vitest run --config/-c/--root` (`review-agents.plan.md:217`) | point-fix (S15(b), rev 5) |
| 5 | `guard-policy-text-drift` | `plan-verifier.md` *Hard rules* list only `typecheck`/`lint`/`test`/`arch`/`exec`/`docker info`, while rev 5 lets reviewers run the hook self-tests; `architecture-reviewer.md` omits them too (plan-verifier rev 5, S4 `partial` and *Handed off*) | verification gap — S13/S14 synced the README and one command; nothing compares each prompt's command list with the hook | T13 greps three strings (`noEmit`, `misconfigured`, `-T err-long`), not the prompts' command lists (`review-agents.plan.md:218`) | point-fix (S13, S14, rev 5) |
| 6 | `guard-policy-text-drift` | the hook rejects `pnpm --dir <absolute path>/server arch`, so agents depend on cwd = root, which no prompt or README said (architecture-reviewer rev 5, *Context*) | verification gap — same as finding 5 | as finding 5 | point-fix (S13) |
| 7 | `weak-self-test-oracle` | `rund` discards stderr, so the "misconfigured" dispatch rows assert exit 2 only; `bash -n .claude/hooks/implementer-guard.sh` has no row (plan-verifier rev 5, S15 and T12 `partial`) | verification gap — S15's Verify counts `ok T12` rows, not what each row asserts (`review-agents.plan.md:147`) | — | new |
| 8 | `unplanned-protocol-output` | `INSIGHTS.md` "an exact-command allowlist entry … must sit *before* the shell-invoker recursion" maps to no plan item (plan-verifier rev 5, *Unplanned changes*; implementer rev 5, *Deviations from plan*) | spec gap — still no standing rule; S17 named one more entry by hand | S17 covered only the entry that existed when rev 5 was written | point-fix (S17, rev 5) |
| 9 | `no-adversarial-review-gate` | the `cd` bypass again sits only under *Handed off*; architecture-reviewer `Clean`, plan-verifier 0 not met; findings 2–4 came from the planner, not from a reviewer (rev 5 reports; `review-agents.plan.md:333`) | spec gap — O1 unchanged (`review-agents.plan.md:274`) | no reviewer can fail a round on a bypass | point-fix (rev 5 fixed the four rev 4 hand-offs in S15; no gate added) |
**Why the prior checks were green:** `allowlist-spelling-bypass` — T12 is again the S15 enumeration (`review-agents.plan.md:217`), so `0 failing case(s)` proved only the listed spellings; `guard-policy-text-drift` — T13 pins phrases, not command sets; `unplanned-protocol-output` — S11/S17 are per-entry steps; `no-adversarial-review-gate` — both reviewers returned green by design, because a bypass is outside both rubrics.
**Recurrence:** `allowlist-spelling-bypass`, `guard-policy-text-drift`, `unplanned-protocol-output`, `no-adversarial-review-gate`
**Converging:** no (`allowlist-spelling-bypass`, `guard-policy-text-drift`, `unplanned-protocol-output`, `no-adversarial-review-gate`)
**Decision for next revision:** Rewrite C6 as an invariant that every allowlisted head in both profiles accepts only an argument allowlist evaluated at the resolved cwd and path, each rule proven by a full-dispatch bypass row, and apply it to all heads rather than to the ones this round's hand-offs named.
**Metrics:**
| Class label | it 1 | it 2 |
|-------------|------|------|
| `allowlist-spelling-bypass` | 3 | 2 |
| `path-resolution-gap` | 0 | 2 |
| `fail-open-guard-default` | 1 | 0 |
| `guard-policy-text-drift` | 3 | 2 |
| `weak-self-test-oracle` | 0 | 1 |
| `unplanned-protocol-output` | 1 | 1 |
| `acceptance-evidence-missing` | 2 | 0 |
| `no-adversarial-review-gate` | 1 | 1 |
### Iteration 1 — plan rev 4 reviewed · 2026-09-25
**Inputs:** architecture-reviewer report on rev 4 (`Base → HEAD` 6d43561 → working tree, `cb195fb` committed mid-run), plan-verifier report on rev 4 (6d43561 → cb195fb), test-writer and doc-writer T8 probe reports on rev 4, main-session round map (`index.md` round 1/1b) — verbatim reports preserved in the session scratchpad. Prior-fix column for the hook classes reconstructed from `git show cb195fb:docs/plans/review-agents.plan.md` (rev 4: `:27` C6, `:49` checks profile, `:51`, `:52` Failure policy, `:107` S8, `:157` T10, `:226` rev 4 line). The rev 3 round that produced rev 4 has no preserved report and no entry of its own.
**Findings:**
| # | Class label | Finding (evidence) | Root cause | Prior round missed it because | Prior fix |
|---|-------------|--------------------|------------|-------------------------------|-----------|
| 1 | `allowlist-spelling-bypass` | `pnpm --dir <any path> test` runs any `package.json` (plan-verifier rev 4, *Handed off*: "`scope-guard.sh:203-213` — значення `--dir`/`-C` ніяк не обмежене") | spec gap — rev 4 Decisions require `--dir` to be present, never constrain its value (`cb195fb:…plan.md:49`) | T10 rejects only a bare `pnpm test`; no row with a foreign `--dir` value (`cb195fb:…plan.md:157`) | point-fix (S8(a), rev 4: "require `--dir`") |
| 2 | `allowlist-spelling-bypass` | `exec vitest run --config <file>` loads a config as code (plan-verifier rev 4, *Handed off*: `scope-guard.sh:220`) | wrong abstraction — rev 4 C6 closes every hole "by a flag check plus a self-test case" (`cb195fb:…plan.md:27`), a per-flag denylist over a program with a wide CLI surface; S8(b) enumerated only `tsc --noEmit`, `eslint -o`, `depcruise -f` | T10 rows are exactly the S8 spellings; the verifier could not run `self-test` at all (finding 5) | point-fix (S8(b)) |
| 3 | `allowlist-spelling-bypass` | backtick command substitution is not split into its own segment (plan-verifier rev 4, *Handed off*: `scope-guard.sh:103-134`) | spec gap — the rev 4 "Rejected in any segment" list has no command substitution (`cb195fb:…plan.md:51`) | no T5/T10 row contains a backtick or `$(` | point-fix (S8(c)) |
| 4 | `fail-open-guard-default` | an unknown mode or profile exits 0, so a misconfigured hook allows everything (plan-verifier rev 4, *Handed off*: `scope-guard.sh:670,685,697`) | spec gap — rev 4 Failure policy names infrastructure errors and policy misses only, no rule for a bad mode argument (`cb195fb:…plan.md:52`) | no dispatch row with a typo'd profile | new |
| 5 | `guard-policy-text-drift` | the `checks` profile blocks the plan's own Verify commands `bash -n …` / `… self-test`, so T1–T7 and T10 end *cannot verify* (plan-verifier rev 4: "Хук `scope-guard.sh bash checks` цього агента заблокував `bash -n …` і `… self-test`"; summary "14 met · 19 partial · 0 not met · 12 cannot verify") | spec gap — S1/S8 Verify cells name commands the rev 4 `checks` list does not admit (`cb195fb:…plan.md:49` vs `:107`) | no step ran a Verify cell through the reviewer's own profile | new |
| 6 | `guard-policy-text-drift` | `architecture-reviewer.md:107,160` requires `--output-type err-long`, `preReject` rejects every `--output*` token (architecture-reviewer rev 4, *Limits*: `scope-guard.sh:179`) | verification gap — no check fed a prompt's required commands through the hook | the prompt and the hook were each checked only against the plan, never against each other | new |
| 7 | `guard-policy-text-drift` | README `scope-guard.sh` bullet omits S8(b) (plan-verifier rev 4, S8 row: "`rg -n 'noEmit\|tsc' README.md` → exit 1") | verification gap — S8's Verify cell checks only `self-test`, not the README half of the step (`cb195fb:…plan.md:107`) | the README part of S8 had no Verify command | new |
| 8 | `unplanned-protocol-output` | `INSIGHTS.md` 2026-09-25 "`bash -n scope-guard.sh` fails several functions away…" entry maps to no plan item (plan-verifier rev 4, *Unplanned changes*) | spec gap — the plan has no standing rule for session-protocol outputs; each entry needs its own step | S11 covered only the one entry that existed when rev 4 was written | point-fix (S11, rev 4: one named entry folded in — reconstructed from the rev 4 `## Revisions` line) |
| 9 | `acceptance-evidence-missing` | T8 (b)/(c) probes were declined instead of delegated, so the write guards were unexercised by a real agent (plan-verifier rev 4, T8: "запит відхилено, не делеговано"; `index.md` round 1b) | process deviation — the Flow's manual acceptance step was not carried out when its inputs existed | T8 had no owner-and-trigger in the Flow, only "run by the main session" | new |
| 10 | `acceptance-evidence-missing` | C4, O2, O7 *cannot verify*: the baseline `cb195fb` was committed after the S0/S9 edits it was meant to evidence (plan-verifier rev 4, C4 row) | spec gap — rev 4 S10 schedules the baseline commit after S8/S9/S11/S12 land (`cb195fb:…plan.md` S10 row) | the constraint and its evidence commit were designed in the same revision | new |
| 11 | `no-adversarial-review-gate` | every bypass (findings 1–4) sits under *Handed off (not judged)*; plan-verifier reports 0 not met, architecture-reviewer reports `Clean` (both rev 4 reports) | spec gap — O1 excludes a security reviewer while AC6 makes `scope-guard.sh` the enforcement boundary; *Review hand-off* asks for "a human/security read" that no Flow step runs (`review-agents.plan.md:232,274`) | neither reviewer's rubric can fail a round on a bypass (`index.md`, orchestration facts) | new |
**Why the prior checks were green:** `allowlist-spelling-bypass` — the rev 4 T10 matrix is the S8 enumeration itself (`cb195fb:…plan.md:157`), so a green `self-test` proved only that the listed spellings are rejected; `unplanned-protocol-output` — S11 named one entry, not a rule.
**Recurrence:** none (no previous entry in this file; the reconstructed rev 3 round already produced S8 and S11 for two of these classes)
**Converging:** yes
**Decision for next revision:** Replace the per-flag rejections in `scope-guard.sh` with per-head argument allowlists and add a Flow step in which a bypass probe of the hook through the full JSON dispatch can fail the round, instead of fixing the four hand-offs one by one.
**Metrics:**
| Class label | it 1 |
|-------------|------|
| `allowlist-spelling-bypass` | 3 |
| `fail-open-guard-default` | 1 |
| `guard-policy-text-drift` | 3 |
| `unplanned-protocol-output` | 1 |
| `acceptance-evidence-missing` | 2 |
| `no-adversarial-review-gate` | 1 |
