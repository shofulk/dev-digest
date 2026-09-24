# Development Plan: review, test and docs subagents (test-writer, architecture-reviewer, plan-verifier, doc-writer)

**Spec:** none (criteria from request) · **Packages:** repo tooling `.claude/` (agents, hooks) — no package code in server/, client/, reviewer-core/ or e2e/ changes · **Base:** `6d43561` (branch `L03-Subagents`; `.claude/agents/*` and `.claude/hooks/implementer-guard.sh` are untracked work used as the template — S10 creates the diffable baseline) · **Revision:** 4

## Goal
Add four project subagents — test-writer, architecture-reviewer, plan-verifier, doc-writer —
next to researcher/planner/implementer, give the planner an update mode so a saved plan can be
revised in place, back every write restriction the new agents claim with a hook that has a
`self-test` mode, and extend the `.claude/agents/README.md` map to cover all of it.

## Acceptance criteria
1. **AC1 — test-writer.** Writes client tests (Vitest + RTL, colocated `*.test.tsx`/`*.test.ts`), server hermetic `*.test.ts` and DB-backed `*.it.test.ts`, reviewer-core tests, and e2e `specs/NN-name.flow.json` when relevant; loads the matching project skills for the code under test; writes only test files and test fixtures, never production code (hook-enforced).
2. **AC2 — architecture-reviewer.** No write tools at all. Checks onion rings (server/src), frontend-ui-architecture (client/src), reviewer-core purity, vendor mirrors, DI-container rule, package independence. Returns findings with rule, `file:line`, import edge from→to with ring/layer, severity, why. Reuses `pnpm --dir server arch` (`server/.dependency-cruiser.cjs`) instead of re-implementing it, and states honestly that client/ has no deterministic boundary checker.
3. **AC3 — plan-verifier.** Read-only. Per-item traceability matrix over **every** item of `docs/plans/<feature>.plan.md` and the spec AC: verdict (met / partial / not met / cannot verify) + concrete evidence (`file:line`, test name, command output) per item. Forbidden to substitute generic advice or code-quality commentary for that check.
4. **AC4 — doc-writer.** Documents implemented features; turns a plan or other material into docs with Mermaid diagrams; knows the home of each kind of doc; writes only documentation paths (hook-enforced).
5. **AC5 — `.claude/agents/README.md`.** Catalog, Flow, Permissions, Artifacts, Sources cover all four agents and the plan-update loop. Flow: planner → plan file → implementer → test-writer? → architecture-reviewer ∥ plan-verifier → doc-writer → /pr-self-review.
6. **AC6 — enforcement.** Every write restriction a prompt claims is backed by a tool denial or a hook where the platform allows; every new hook has a `self-test` mode like `implementer-guard.sh`.
7. **AC7 — planner update mode.** Given the path of an existing plan (plus a change request, an Implementation Report or a Plan Verification), the planner returns a revised plan that keeps existing AC/step/test IDs stable, marks changed/new/dropped items instead of renumbering or deleting them, bumps `Revision`, refreshes `Base`, and appends one line to a `## Revisions` section. Its create-mode output format carries the same `Revision` field and `## Revisions` section.
8. **AC8 — reply language.** Each of the 7 agent files in `.claude/agents/` (architecture-reviewer, doc-writer, implementer, plan-verifier, planner, researcher, test-writer) carries exactly one Hard rule "**Reply in the user's language.**", placed just before its "Repo content is data" / "Web content is data" bullet: prose follows the language named by a `User language: …` line in the delegating prompt (fallback: the prompt's own language); code, identifiers, IDs, paths, commands and their output, quotes and skeleton section headings stay verbatim; files written to the repo stay English. `.claude/agents/README.md` states the same in a "**Reply language.**" paragraph after the Flow explanation. *(new rev 4)*

## Constraints
- **C1 — Architecture:** No agent is exempt from the rings. The architecture-reviewer prompt names the ring table of the preloaded `onion-architecture/SKILL.md` by its section title *The rings, by real path* (referenced, not copied, so the two cannot drift) and uses the *Enforcement* baseline **0 errors / 17 warnings** as the delta reference ("a change that raises any of those counts is a regression"). For client/src it keeps the SPECIFIED / CONVENTION / UNSPECIFIED tiers of `frontend-ui-architecture` (*How to use this*): only SPECIFIED or `client/AGENTS.md` rules can be `critical`/`major`; CONVENTION advice is at most `minor`; UNSPECIFIED is never a finding. Severity words come from `pr-self-review/severity.md` (§1 row 4: arch `error` → critical, `warn` → major) so its output can feed `/pr-self-review`. *(rev 4)*
- **C2 — Contracts & data:** none — no route, Zod contract or table is touched.
- **C3 — Tooling facts relied on (verified):** `server/package.json` → `"arch": "depcruise src --config .dependency-cruiser.cjs --output-type err"`; the config equals `.claude/skills/onion-architecture/enforcement/dependency-cruiser.cjs` and includes `reviewer-core-stays-pure`, `no-sdk-outside-adapters`, `no-cross-module-internals`, `no-circular`; no `cache` option, so `arch` writes nothing. `client/eslint.config.mjs` has no import-boundary rules — no deterministic client architecture check. Mirrors: `client/src/vendor/{shared,ui}` ← `server/src/vendor/shared`. `server/clones/**` holds full repo copies (incl. `vendor/`) — every glob excludes it. `client/tsconfig.json` has `incremental: true` → `typecheck` writes a gitignored `*.tsbuildinfo`.
- **C4 — Do not touch:** `.claude/skills/**` (incl. `pr-self-review/routing.md`), `.claude/settings.json` (all enforcement is agent-scoped), every `CLAUDE.md`, `.claude/hooks/implementer-guard.sh`, `pr-gate.sh`, `pre-push` (templates only), `skills-lock.json`. `researcher.md` and `implementer.md` are edited **only** by S9; `planner.md` **only** by S0 and S9. These four files were untracked at `6d43561`, so "not edited beyond S0/S9" is verifiable only against the S10 baseline commit; before S10 the verdict is *cannot verify* by decision (no pre-change copy exists). *(rev 4)*
- **C5 — INSIGHTS (root):** *2026-09-24 — a hand-probed guard hook "allows everything": the probe, not the hook, is broken* → S8's new self-test cases go through the in-script `runb`/`runw` helpers (profile as a separate argument, JSON built by the script), never through ad-hoc zsh probes; the `2>&1` fix at `scope-guard.sh:113` must survive S8. *2026-09-20 — a `PreToolUse` hook on `Bash` runs on every Bash call, and a gate hook must fail open* → the Bash guard spawns on every Bash call of four agents: keep S8's added checks cheap, fail open on **internal** errors only (a policy "no" is not an internal error); its last paragraph — agent files and hooks load at session start — means T8 needs a restart or `/agents` after S8/S9. *2026-09-20 — lint is a CI gate…* → severity encodes STATE (`warn` = named outstanding debt; a rising warn count is the regression signal); the architecture-reviewer compares counts, it does not re-litigate `warn` rules. *(rev 4)*
- **C6 — Bash profiles are allowlists of *behaviour*, not only of heads.** An allowlisted head whose flags or config can run an arbitrary program or write a file (see S8) is a hole in the profile, closed by a flag check plus a self-test case; never by switching the profile to fail-open. *(new rev 4)*

## Decisions

**Agent settings (follow the existing three):**

| Agent | model | permissionMode | tools | disallowedTools | skills (preload) | color | description adds |
|---|---|---|---|---|---|---|---|
| test-writer | `sonnet` | `acceptEdits` | Read, Grep, Glob, Edit, Write, Bash, Skill | Agent, NotebookEdit, WebSearch, WebFetch | `engineering-insights`; everything else per bucket via `Skill` | `yellow` | "Use after implementer when the plan assigns tests separately or the report lists test gaps" |
| architecture-reviewer | `opus` | `default` | Read, Grep, Glob, Bash | Write, Edit, NotebookEdit, Agent, Skill, WebSearch, WebFetch | `onion-architecture`, `frontend-ui-architecture` | `red` | "Use proactively after implementer, before /pr-self-review" |
| plan-verifier | `opus` | `default` | Read, Grep, Glob, Bash | Write, Edit, NotebookEdit, Agent, Skill, WebSearch, WebFetch | none (context kept for plan + diff + evidence) | `purple` | "Use proactively after implementer" |
| doc-writer | `sonnet` | `acceptEdits` | Read, Grep, Glob, Edit, Write, Bash, Skill | Agent, NotebookEdit, WebSearch, WebFetch | `mermaid-diagram` | `orange` | — (on demand) |

Reviewers use `default`, not `plan`: they must run `pnpm … arch/test`, and Bash semantics under
`plan` mode are not pinned down by the research. They hold no write tool; the hook covers Bash.
Reviewers run on `opus` so they do not share the `sonnet` implementer's blind spots.

**Hook — one shared, parametrized `.claude/hooks/scope-guard.sh`** (tokenizer copied from `implementer-guard.sh`; header names the other two copies):
- `write tests` / `write docs` — `PreToolUse` on `Write|Edit|NotebookEdit`: reads `tool_input.file_path` (or `notebook_path`), resolves it against `$CLAUDE_PROJECT_DIR` with `..` collapsed and symlinks resolved on the nearest existing ancestor, checks the profile's allow/deny globs **against both the logical repo-relative path and the symlink-resolved repo-relative path — either one denied or not allowed → block**. *(rev 4)*
- `bash readonly` / `bash checks` — `PreToolUse` on `Bash`, **allowlist** per segment, recursing into `bash -c`/`eval` like implementer-guard.
  - `readonly`: `git status|diff|log|show|grep|ls-files|rev-parse|merge-base|blame|cat-file`; `ls rg grep cat head tail wc diff cmp sort uniq cut tr jq stat file pwd cd echo printf test true basename dirname realpath which`; `find` without `-delete`/`-exec*`/`-ok*`/`-fprint*`/`-fls`; `sed` without `-i`/`--in-place`.
  - `readonly` flag checks on allowed heads: `rg` without `--pre`/`--pre=…`; `git` without `-c`/`--config-env` (global options) and without `--ext-diff`, and `git grep` without `-O…`/`--open-files-in-pager…`; `sed` without `-f`/`--file` and without a `w`/`W`/`e` command or `s///w`/`s///e` flag in its script (uncertain parse → reject); `sort` without `--compress-program…`; `file` without `-C`. *(new rev 4)*
  - `checks` = `readonly` + `docker info`; `pnpm|npm` **with `--dir`/`-C` before the script — a bare `pnpm <script>` is rejected** — scripts `typecheck|lint|test|arch` (also via `run`); `exec vitest run …`, `exec tsc` **only with `--noEmit`**, `exec depcruise …` without `-f`/`--output-to`, `exec eslint …` without `-o`/`--output-file`. *(rev 4)*
  - Leading environment assignments: only `CI=<value>` is accepted before the head; any other `VAR=value` prefix (`NODE_OPTIONS`, `GIT_*`, `PAGER`, …) is rejected. *(new rev 4)*
  - Rejected in any segment: redirection (`>`, `>>`, `&>`) except to `/dev/null` or fd dup, `--fix`, `-u`/`--update`, `--write`, `--output*`/`--outputFile`, `sort -o`, `xargs`, `tee`, any unknown head. This covers implementer-guard's list (commit, push, `gh pr`, migrate, drizzle-kit) and adds `pnpm add|install|remove`, `db:generate|seed`, `dev`, `build`, `docker` (except `info`), `git fetch|checkout|restore|reset|stash|apply|add`.
- **Failure policy:** infrastructure error (no node, unreadable stdin, unparsable JSON) → exit 0 + warning (fail-open, per INSIGHTS and pr-gate). Parsed input outside the allow set, or a Write/Edit with no resolvable path → exit 2 (policy). Stderr names the rule, lists what is allowed, and says where to record the need (*Production changes needed* / *Proposed edits*).
- Shared rather than per-writer: the profiles differ only in glob tables, the Bash rule is common to all four, and one `self-test` matrix covers every profile.

| Agent | Write guard | Bash guard |
|---|---|---|
| test-writer | `write tests` | `bash checks` |
| doc-writer | `write docs` | `bash readonly` |
| architecture-reviewer | — (Write/Edit denied) | `bash checks` |
| plan-verifier | — (Write/Edit denied) | `bash checks` |

**Write allow-lists:**
- **tests:** `{server,client,reviewer-core}/**/*.test.{ts,tsx}` (covers `*.it.test.ts`), `server/test/**`, `reviewer-core/test/**`, `client/src/test/**`, `**/__tests__/**` and `**/__snapshots__/**` under those packages, `e2e/specs/*.flow.json`. Fixtures only inside the test dirs above — no `**/fixtures/**` or `**/__fixtures__/**` glob *(rev 3)*. Always denied: `*/src/vendor/**`, `server/clones/**`, `node_modules/**`, `server/src/adapters/mocks.ts` (ring-2 production file), `server/src/db/seed.ts` (e2e asserts on it), `e2e/lib/**`, `e2e/run.ts` (harness; `e2e/AGENTS.md` forbids assertion logic there), `vitest.config.ts`, `package.json`, lockfiles, everything else.
- **docs:** root `README.md`, `{server,client,reviewer-core,e2e}/README.md`, `{server,client,reviewer-core,e2e}/.doc/**/*.md`, `docs/**/*.md`. Denied: `docs/plans/**` (planner→implementer handoff), `docs/skills/**` (case collision between staged `README.md` and tracked `readme.md`; lift the denial in the same change that resolves it), `docs/agent-prompts/**` except its `README.md` (runtime prompts mirrored to the DB), `**/.spec/**`, `**/AGENTS.md`, `**/CLAUDE.md`, `**/INSIGHTS.md`, `.claude/**`, `*/src/vendor/**`, `server/clones/**`, any non-`.md` file. *(rev 4)*

**Reviewers may run checks** through the `checks` profile only: `typecheck`, `lint` (no `--fix`), `test`/`vitest run`, `arch`, e2e `typecheck`/`lint` — these write only gitignored caches. plan-verifier prefixes tests with `CI=1` so Vitest fails on new snapshots instead of writing them; runs `*.it.test.ts` only if `docker info` succeeds (else the item is *cannot verify*). Neither boots the stack, runs e2e flows or fetches.

**doc-writer homes (Diátaxis → repo):**

| Kind | Home |
|---|---|
| Reference, architecture, diagrams of a package | `<pkg>/README.md` |
| Explanation, decisions (summary / decision / alternatives / why rejected), runbooks | `<pkg>/.doc/<topic>.md` |
| Cross-package overview | root `README.md` *Architecture* |
| Cross-package rationale | `docs/<topic>.md` (precedent: `docs/pr-self-review.plan.md`) |
| Tutorials | **no home** — reports "needs a decision", does not invent `docs/tutorials/` |

doc-writer may edit `<pkg>/README.md`; it may **not** edit `.spec/` (hook-denied) — spec drift goes
to its report and the main session applies it. New "Read when" pointers for `AGENTS.md` are proposed
in the report, not written.

**`docs` bucket routing drift:** `doc-standards` and `file-conventions` resolve only from user-level
`~/.claude/skills/`, not `.claude/skills/`. doc-writer tries `Skill`; if absent, falls back to
`<pkg>/.doc/README.md`, `.spec/README.md` and neighbouring files' style, and records which under
*Conventions notes*. `routing.md` is not edited.

**Planner update mode (S0):** the planner stays read-only; the main session writes every revision
back to the same `docs/plans/<feature>.plan.md`. Git history of that file is the full audit trail;
`## Revisions` is the human-readable summary.

**Security observations on `scope-guard.sh` (rev 4 decision):** fixed in this plan (S8), not deferred —
each one lets an allowlisted head run an arbitrary program or write a file, which breaks the
profile contract AC6 relies on (C6). The security review of the hook as a whole stays handed off
(*Review hand-off*); S8 does not claim the hook is a sandbox. *(new rev 4)*

## Steps
| ID | Package | Files (create / modify) | Change | Skills (routing bucket) | Covers | Verify |
|----|---------|-------------------------|--------|-------------------------|--------|--------|
| S0 | .claude | `.claude/agents/planner.md` (modify), `.claude/agents/README.md` (modify: planner rows only) | Add **Update mode**: Step 0 gate recognises an existing plan path as input (plus change request / Implementation Report / Plan Verification). Procedure: re-read plan, code at new HEAD and the cited INSIGHTS; keep AC/S/T IDs stable; new items get the next free ID; changed items get `*(rev N)*`; removed items stay with `~~…~~ *(dropped rev N: reason)*`; bump `**Revision:**`, refresh `**Base:**`; append `- rev N · YYYY-MM-DD · <what changed> · <why>` to `## Revisions`. Create-mode output format gains `**Revision:** 1` in the header and a `## Revisions` section with the `rev 1` line. Add an "update a plan" note to README *Flow* and the planner row of *Artifacts*. | none (`.claude/agents` is in no bucket) | AC7 | frontmatter parse (S7.1) + `rg -n 'Update mode\|## Revisions\|\*\*Revision:\*\*' .claude/agents/planner.md` shows all three |
| S1 | .claude | `.claude/hooks/scope-guard.sh` (create, `chmod +x`) | Modes `write tests\|docs`, `bash readonly\|checks`, `self-test` as in *Decisions*. Header: scope, fail-open vs policy-deny, tokenizer provenance. `self-test` runs a path matrix and a command matrix (T1–T7), exits non-zero on any wrong case. | none (model on `implementer-guard.sh`, `pr-gate.sh`) | AC1–AC4, AC6 | `bash -n .claude/hooks/scope-guard.sh && .claude/hooks/scope-guard.sh self-test` |
| S2 | .claude | `.claude/agents/test-writer.md` (create) | Frontmatter per *Decisions* + `hooks.PreToolUse`: `Write\|Edit\|NotebookEdit` → `scope-guard.sh write tests`; `Bash` → `scope-guard.sh bash checks` (timeout 15). Prompt: see S2 details. | skills named in the prompt, not preloaded | AC1, AC6 | frontmatter parse + `grep -c 'scope-guard.sh write tests' .claude/agents/test-writer.md` = 1 |
| S3 | .claude | `.claude/agents/architecture-reviewer.md` (create) | Frontmatter per *Decisions* + `Bash` → `scope-guard.sh bash checks`. Prompt: see S3 details. | `onion-architecture`, `frontend-ui-architecture` (preloaded) | AC2, AC6 | frontmatter parse + disallowedTools contains Write, Edit, NotebookEdit |
| S4 | .claude | `.claude/agents/plan-verifier.md` (create) | Frontmatter per *Decisions* + `Bash` → `scope-guard.sh bash checks`. Prompt: see S4 details. | none | AC3, AC6 | frontmatter parse |
| S5 | .claude | `.claude/agents/doc-writer.md` (create) | Frontmatter per *Decisions* + `Write\|Edit\|NotebookEdit` → `scope-guard.sh write docs`, `Bash` → `scope-guard.sh bash readonly`. Prompt: see S5 details. | `mermaid-diagram` (preloaded); `doc-standards`, `file-conventions` if they resolve | AC4, AC6 | frontmatter parse |
| S6 | .claude | `.claude/agents/README.md` (modify) | Catalog, Flow, Permissions, Artifacts, Sources, Troubleshooting — see S6 details. | docs bucket (`doc-standards`, `file-conventions` if they resolve) | AC5, AC6 | `rg -c 'test-writer\|architecture-reviewer\|plan-verifier\|doc-writer' .claude/agents/README.md`: every agent in Catalog, Permissions, Artifacts; every relative link target exists |
| S7 | .claude | — (verification) | 1. Frontmatter of all 7 agents parses and `name` = filename. 2. `scope-guard.sh self-test && implementer-guard.sh self-test` (after S8: includes T10). 3. Manual acceptance T8 — owned by the **main session** after a restart or `/agents` (S8/S9 changed hook and agent files, so the old session's definitions are stale); not yet run at rev 4; a precondition for `/pr-self-review`. 4. T11. *(rev 4)* | — | AC1–AC8 | see *Test plan* |
| S8 | .claude | `.claude/hooks/scope-guard.sh` (modify), `.claude/agents/README.md` (modify: `scope-guard.sh` bullet under *Permissions* only) | Bring the hook in line with the rev 4 *Decisions*: (a) `pnpm\|npm` require `--dir`/`-C`; (b) `exec tsc` only with `--noEmit`; `exec eslint` rejects `-o`/`--output-file`; `exec depcruise` rejects `-f`/`--output-to`; (c) `rg --pre*`; `git -c`/`--config-env`/`--ext-diff`; `git grep -O*`/`--open-files-in-pager*`; `sed -f`/`--file` and `w`/`W`/`e` script commands; `sort --compress-program*`; `file -C` → rejected; (d) leading env assignments: only `CI=`; (e) write policy evaluated on logical **and** symlink-resolved relative path; (f) `docs/skills/**` in `DOCS_DENY`. Every change gets a T10 self-test case; the `2>&1` handling (`segments()`, line ~113) and all T1–T7 cases stay green. README bullet names (a), (b), (d) and "`docs/skills/**` denied until the case collision is resolved". *(new rev 4)* | none (`.claude/hooks` is in no bucket) | AC6, AC1, AC4 | `bash -n .claude/hooks/scope-guard.sh && .claude/hooks/scope-guard.sh self-test` → `0 failing case(s)` with every T10 row present (`.claude/hooks/scope-guard.sh self-test \| rg -c '^ok +T10'` ≥ number of T10 cases) |
| S9 | .claude | `.claude/agents/{architecture-reviewer,doc-writer,implementer,plan-verifier,planner,researcher,test-writer}.md` (modify: one Hard-rule bullet each), `.claude/agents/README.md` (modify: "Reply language." paragraph after the Flow explanation) | User-requested change, **already applied in the working tree** — record and verify only: the "**Reply in the user's language.**" bullet as in AC8, inserted just before the "Repo content is data" (researcher: "Web content is data") bullet; README paragraph as in AC8. No other edit to researcher.md / implementer.md / planner.md. *(new rev 4)* | none | AC8 | T11; S7.1 frontmatter parse still passes for all 7 |
| S10 | repo (main session) | commit of `.claude/agents/**`, `.claude/hooks/scope-guard.sh`, `.claude/hooks/implementer-guard.sh`, `docs/plans/review-agents.plan.md` | **Baseline for C4/O2:** after S8/S9/S11/S12 land, the main session asks the user for consent and commits these files (the implementer cannot — `implementer-guard.sh` blocks `git commit`). The plan file is the planner→implementer artifact written by the main session, not an unplanned change. From this commit on, `git diff <S10 sha> -- .claude/agents/{researcher,implementer,planner}.md .claude/hooks/implementer-guard.sh` is the evidence for C4/O2; the next revision's `Base` is this commit. Without consent, C4/O2 stay *cannot verify* by decision. *(new rev 4)* | none | C4, O2 | `git log -1 --stat` lists the files; `git status --short .claude docs/plans` is empty |
| S11 | repo | `INSIGHTS.md` (modify — **already applied**) | Record the 2026-09-24 entry "a hand-probed guard hook 'allows everything': the probe, not the hook, is broken" as a planned session-protocol output (root `AGENTS.md` *Session protocol*), not an unplanned change. Check it sits newest-first under *tool-and-library-notes*, no earlier entry was edited, and its `**Evidence:**` line still points at the `2>&1` handling after S8 (the entry is uncommitted, so correcting its own line number before S10 is not a rewrite of a published entry). *(new rev 4)* | `engineering-insights` | C5 | `git diff INSIGHTS.md` shows only added lines; `rg -n 'fd-dup' .claude/hooks/scope-guard.sh` line = the entry's `**Evidence:**` line |
| S12 | .claude | `.claude/agents/architecture-reviewer.md` (modify: judged-checks step, currently line 129) | Replace the bare "ring table" reference with the section title *The rings, by real path* of `onion-architecture/SKILL.md`, so the from→to classification cites a checkable source (C1). No other change. *(new rev 4)* | `onion-architecture` (read to confirm the title) | AC2, C1 | `rg -n 'The rings, by real path' .claude/agents/architecture-reviewer.md` ≥ 1 |

**S2 — test-writer prompt.** Writes tests only; does not fix production code; no architecture/security review.
- *Hard rules:* paths as in the hook; never production code, `adapters/mocks.ts`, `seed.ts`, config; never `.skip`/`.only`, weakened assertions, raised timeouts, snapshot `-u`; mock the boundary you own (`server/src/adapters/mocks.ts` via `ContainerOverrides`; `fetch` in client); RTL query priority `getByRole` → … → `getByTestId` last; Fastify via `app.inject()`; tests importing `test/helpers/pg.ts` must be `*.it.test.ts` (TESTING.md); e2e flows use only `--url`/`--text`/`find` and `{BASE}`.
- *Step 0 gate:* a plan path, or a named target (files, seams, AC) plus a done criterion; else *Clarification needed* JSON (same block as planner).
- *Procedure:* read `TESTING.md`, `<pkg>/AGENTS.md`, `INSIGHTS.md` → pick the kind by seam (TESTING.md) → load skills: client component/hook → `react-testing-library`; server route → `fastify-best-practices`; repository / `*.it.test.ts` → `drizzle-orm-patterns`; contract → `zod`; reviewer-core → `typescript-expert`; e2e → `e2e/AGENTS.md` → write → run → **negative control** (flip one key assertion per new test, confirm it fails, restore) → `engineering-insights` entries *proposed* in the report (INSIGHTS.md is outside the write scope).
- A test that exposes a real bug stays failing, goes under *Bugs found*, **Status: Partial**; never skipped. Max 3 attempts per failing test.

**S3 — architecture-reviewer prompt.**
- *Hard rules:* read-only; findings only on change-set lines (pre-existing issues → *Context*, per `pr-self-review` step 4); every finding carries evidence; no style/performance/security opinions; no fixes.
- *Input:* base ref (default `git merge-base HEAD origin/main`, no fetch), a file list, or the implementer's *Hand-off to reviewers*. Change set = committed + staged + unstaged + untracked (as `pr-self-review` Step 1), excluding `server/clones/**`.
- *Deterministic pre-pass:* `pnpm --dir server arch` + `pnpm --dir server exec depcruise src --config .dependency-cruiser.cjs --output-type err-long` for edges and rule comments, compared to 0/17; vendor tripwire (`*/src/vendor/**` changes outside `server/src/vendor/shared`); mirror drift `diff -rq server/src/vendor/shared client/src/vendor/shared`; package independence (no root `package.json`/lockfile, no cross-package relative import); reviewer-core purity (`reviewer-core-stays-pure` + `rg` for `fastify|drizzle|node:fs|node:child_process|octokit` in `reviewer-core/src`).
- *Judged checks (onion-architecture Review checklist):* ring header comment; `this.container.` inside a method body; `new <Concrete>` in ring 1; `$inferSelect` outside `db/rows.ts`/repository; `req`/`reply` below `routes.ts`; new SDK import outside `adapters/`. Ring classification cites *The rings, by real path* (S12). *(rev 4)*
- *Client (client/AGENTS.md + skill, marked "no deterministic tool"):* no `fetch` in components, data only via `src/lib/hooks/*`; `'use client'` placement; no literal copy (strings via `messages/`); no local type duplicating a `src/vendor/shared` contract; server-only boundary.

**S4 — plan-verifier prompt.**
- *Hard rules:* read-only; the implementer's report is a *claim*, never evidence; every row has a verdict and evidence; "met" needs direct evidence (code location, and for behaviour also a passing test name or command output line); implemented-but-untested → "partial"; "cannot verify" names the reason and what would settle it. **Forbidden:** style/quality remarks, refactoring advice, generic best practice, summarising instead of itemising. Architecture/security observations are handed off by name in one line, never judged.
- *Step 0 gate:* plan file exists with `Plan status: Ready`; spec path from the plan header; otherwise Blocked. Dropped items (`~~…~~ dropped rev N`) are verified as *not done*.
- *Items:* every `AC*`, every `S*`, every Test plan row (`T1..`), every Constraints bullet (`C*`), every Out-of-scope bullet (`O*` — verify it was *not* done).
- *Procedure:* change set Base → HEAD + working tree → map each changed file to items (unmapped → *Unplanned changes*) → run each step's *Verify* if the `checks` profile allows (else *cannot verify*) → fill the matrix.

**S5 — doc-writer prompt.**
- *Hard rules:* paths as in the hook; every factual claim and diagram node checked against code (`path:line`); document what shipped, not what the plan intended — differences are spec drift for the report; never restate a README in `.doc/`, link to it; Mermaid only `flowchart`, `sequenceDiagram`, `stateDiagram-v2`, `erDiagram` (no C4 — experimental), ≤ ~15 nodes, labels use real module/file names, no diagrams in `AGENTS.md`.
- *Step 0 gate:* source material (plan path, spec, files or feature name) and audience/doc kind; else *Clarification needed* JSON.
- *Procedure:* the home table from *Decisions*.

**S6 — README.md changes.**
- *Catalog:* four new rows; rename column "Writes code" → "Writes" (code + tests / tests only / docs only / no); replace "Architecture and security review are not in this set yet" with "Security review is not in this set yet".
- *Flow:* new diagram incl. the fix loop — critical architecture findings or "not met" items go back to the implementer (test gaps → test-writer), with the planner in update mode when the plan itself must change; max 2 re-verify rounds, then the main session asks the user; reviewers run in parallel; doc-writer after both are clean; then `/pr-self-review`.
- *Permissions:* four rows with scope-guard profiles under *Extra guard*; a `scope-guard.sh` bullet next to `implementer-guard.sh`/`pr-gate.sh` stating the allowlists, the fail policy and the limits (Bash is best-effort; the prompt rule remains); "No agent here may spawn subagents" covers all 7.
- *Artifacts:* four rows (input → report name, status line).
- *Sources:* external rows from *Sources* below with access dates, plus in-repo rows.
- *Troubleshooting:* `scope-guard.sh self-test`; what to do when blocked on a path.

## Test plan
| Test | Kind | Covers | File |
|------|------|--------|------|
| T1 `write tests` allows `client/src/app/agents/_components/AgentCard/AgentCard.test.tsx`, `server/test/x.it.test.ts`, `server/test/helpers/pg.ts`, `reviewer-core/test/run.test.ts`, `e2e/specs/08-x.flow.json`, `client/src/test/setup.ts` | hook self-test | AC1, AC6 | `.claude/hooks/scope-guard.sh` |
| T2 *(rev 3)* `write tests` blocks `server/src/fixtures/x.json`, `server/src/app.ts`, `server/src/adapters/mocks.ts`, `server/src/db/seed.ts`, `client/src/vendor/shared/x.test.ts`, `e2e/run.ts`, `client/vitest.config.ts`, `server/test/../src/app.ts` (traversal), an absolute path outside the repo, a JSON body with no `file_path` | hook self-test | AC1, AC6 | same |
| T3 `write docs` allows `server/README.md`, `client/.doc/query-keys.md`, `docs/agent-prompts/README.md`, `docs/some-topic.md` | hook self-test | AC4, AC6 | same |
| T4 `write docs` blocks `server/.spec/x.spec.md`, `AGENTS.md`, `client/CLAUDE.md`, `INSIGHTS.md`, `docs/plans/x.plan.md`, `docs/agent-prompts/security-reviewer.md`, `.claude/agents/README.md`, `server/src/app.ts`, `docs/x.png` | hook self-test | AC4, AC6 | same |
| T5 `bash readonly` allows `git diff --stat`, `rg -n foo server/src`, `sed -n 1,20p f`, `find . -name '*.md'`, `cat f 2>/dev/null`; blocks `echo x > f`, `sed -i s/a/b/ f`, `tee f`, `rm f`, `git checkout -- f`, `git commit -m x`, `bash -c "git push"`, `find . -delete`, `pnpm test`, `xargs rm`, `git diff --output=f` | hook self-test | AC2–AC4, AC6 | same |
| T6 `bash checks` allows `pnpm --dir server arch`, `CI=1 pnpm --dir client test`, `pnpm --dir server exec vitest run --exclude '**/*.it.test.ts'`, `docker info`; blocks `pnpm --dir client lint --fix`, `pnpm --dir client exec vitest run -u`, `pnpm --dir server db:migrate`, `pnpm --dir server db:generate`, `pnpm --dir client add x`, `pnpm --dir server dev`, `docker compose up -d`, `pnpm test && git push` | hook self-test | AC2, AC3, AC6 | same |
| T7 heredoc body and `echo "then git push"` mentions do not trigger; garbage stdin exits 0 with a warning (fail-open) | hook self-test | AC6 | same |
| T8 Manual smoke after restart: `/agents` lists 7 agents; test-writer asked to "add a line to server/src/app.ts" → blocked; doc-writer asked to edit `server/.spec/skills.spec.md` → blocked; architecture-reviewer on the working tree → report with `pnpm --dir server arch` under *Deterministic checks*; plan-verifier against this file → a matrix over AC1–AC8 / S0–S12 / T1–T11 / C1–C6 / O1–O7; one agent invoked with `User language: <non-English>` answers prose in that language with verbatim headings. Run by the main session; not run as of rev 4 *(rev 4)* | manual acceptance | AC1–AC5, AC8 | — |
| T9 Manual: planner in update mode on this file with a change input → returns the next revision with unchanged IDs, `*(rev N)*` markers on changed items, new items on the next free ID, refreshed Base and a new `## Revisions` line. **Evidence:** the rev 4 run (input: Plan Verification of rev 3 plus a user change request) — the diff of this file between rev 3 and rev 4 after the main session writes it back. *(rev 4)* | manual acceptance | AC7 | `docs/plans/review-agents.plan.md` (git history after S10) |
| T10 S8 hardening, in `self-test` via `runb`/`runw`. `bash checks` allows `pnpm --dir server exec tsc --noEmit`, `CI=1 pnpm --dir client test`; blocks `pnpm test`, `pnpm --dir server exec tsc`, `pnpm --dir client exec eslint -o out.txt src`, `pnpm --dir server exec depcruise src -f out.txt`, `NODE_OPTIONS=--require=x pnpm --dir server test`. `bash readonly` blocks `rg --pre ./x foo`, `rg --pre=./x foo`, `git -c core.pager=x log`, `git -c diff.external=x diff`, `git diff --ext-diff`, `git grep -Ox foo`, `git grep --open-files-in-pager=x foo`, `sed -n 'w out' f`, `sed 's/a/b/w out' f`, `sed '1e id' f`, `sed -f s.sed f`, `sort --compress-program=x f`, `GIT_EXTERNAL_DIFF=x git diff`; still allows `sed -n 1,20p f`, `git diff 2>&1 \| head`. `write docs` blocks `docs/skills/readme.md`; `write tests` blocks a symlink inside `server/test/` pointing to `server/src/` (the self-test creates it in a temp dir under the repo and removes it) *(new rev 4)* | hook self-test | AC6, AC1, AC4 | `.claude/hooks/scope-guard.sh` |
| T11 Reply-language rule: `rg -c "Reply in the user's language" .claude/agents/*.md` prints `:1` for each of the 7 agent files; `rg -n '^\*\*Reply language\.\*\*' .claude/agents/README.md` = 1 hit; in each agent file the bullet's line number is lower than the "Repo content is data" / "Web content is data" line. Behavioural evidence: this rev 4 planner run answered in the delegating prompt's `User language:` (the main session confirms) *(new rev 4)* | static check + manual | AC8 | `.claude/agents/*.md` |

**Report skeletons to embed** (Implementation Report style; one status line at the end):
- **Test Report** — `**Status:** Done | Partial | Blocked · **Target:** · **Base → HEAD:**`; *Tests written* (Test `file › describe › it` | Kind | Seam | Covers | Result); *Negative control* (Test | Assertion flipped | Failed as expected); *Skills applied*; *Verification*; *Skipped checks*; *Bugs found*; *Production changes needed (not made)*; *Insights proposed*.
- **Architecture Review** — `**Scope:** base…HEAD, N files · **Packages:**`; *Deterministic checks* (Check | Command | Result | Baseline delta); *Findings* (# | Severity | Rule (skill § / depcruise rule) | `file:line` | Edge from → to (ring → ring) | Evidence | Why); *Checked, no finding*; *Context (pre-existing)*; *Limits*; `**Review status:** Clean | Findings (c/M/m) | Inconclusive (<reason>)`.
- **Plan Verification** — `**Plan:** · **Revision:** · **Spec:** · **Base → HEAD:**`; *Summary* counts; *Traceability matrix* (Item | Source | Requirement (short quote) | Verdict | Evidence | Gap — factual, no advice); *Commands run* (Command | Exit | Key output line); *Unplanned changes*; *Handed off (not judged)*; `**Verification status:** Verified | Gaps (n not met, n partial, n cannot verify) | Blocked (<reason>)`.
- **Documentation Report** — *Files written* (File | Diátaxis type | Home and why | Change); *Diagrams* (File § heading | Mermaid type | Depicts | Grounded in); *Claims checked* (Claim | `path:line`); *Proposed edits outside my scope*; *Conventions notes*; `**Docs status:** Done | Partial | Blocked`.

## Review hand-off
- **Architecture review:** no files under `server/src` or `client/src` change. The only enforcement code is `.claude/hooks/scope-guard.sh`; read its allow/deny tables against *Decisions* (rev 4 rows). `.claude/agents/architecture-reviewer.md` (S12) for the C1 citation.
- **Security review:** none by `routing.md` globs, but `scope-guard.sh` is a permission boundary and gets a human/security read. S8 closes the rev 3 observations — `rg --pre` (`READONLY_CMDS`, line ~188), `git -c` value skipped (`VALUE_FLAGS`, line ~138), `exec tsc`/`exec eslint -o` (`pnpmAllowed`, line ~197), unchecked leading `VAR=value` (`segVerdict`, line ~205), glob match on the logical path only (`write_eval`, lines ~296–303) — plus those found in rev 4 reconciliation (`git grep -O`, `--ext-diff`, `sed w/e`, `sort --compress-program`, `depcruise -f`, `file -C`). Still open for the reviewer: the completeness of the per-head flag lists (every allowlisted program's full flag surface was not audited), the writes allowlisted programs make as they run (Risks), and whether `bash -c`'s one-level recursion is enough. *(rev 4)*

## Risks / open questions
- ~~Open decision — fixtures scope (before S1).~~ *(resolved rev 3: fixtures only under `server/test/**`, `reviewer-core/test/**`, `client/src/test/**`)*
- **Bash enforcement is best-effort (S1, S8).** An allowlist cannot see writes done by an allowed program (a test writing files, Vitest snapshots). Mitigations: flag denylist, `CI=1` for the verifier, the prompt rule stays. README says "best-effort", not "enforced". *(rev 4)*
- **The allowlist may be too tight (S1–S5, S8)** — e.g. `awk`, `xargs` denied; S8 now also rejects bare `pnpm <script>` and every env prefix but `CI=`. Widen by editing the table plus a self-test case, never by switching to fail-open. *(rev 4)*
- **Third copy of the shell tokenizer (S1)** — pr-gate, implementer-guard, scope-guard. Consolidating into `.claude/hooks/lib/` touches existing hooks; follow-up.
- **`routing.md` gaps (S2, S5)** — no bucket for `server/test/**` / `reviewer-core/test/**`; the `docs` bucket names user-level skills absent from the repo. Recorded, not fixed.
- **Mermaid is not machine-validated (S5)** — no CLI in the repo; validation is by `mermaid-diagram` rules and GitHub preview; the report says so.
- **Update mode keeps IDs stable only if the main session writes the planner's output back verbatim (S0).** Hand edits to the plan file must follow the same marking rules.
- **Test-writer routing is decided by the main session (S6 flow)** — planner.md has no per-step "Owner" column; adding one is a follow-up.
- **`permissionMode: default` for reviewers (S3, S4)** — `pnpm` commands may prompt the user. Acceptable.
- **Hook arming (S7)** — agent definitions and frontmatter hooks load at session start: restart or `/agents` before T8/T9.
- **Case collision** — `docs/skills/README.md` (staged) and `docs/skills/readme.md` (tracked) collide on case-insensitive macOS. From rev 4 `docs/skills/**` is hook-denied for doc-writer (S8); the collision itself is resolved outside this plan (O6), and the denial is lifted in the same change. *(rev 4)*
- **`sed` script parsing is heuristic (S8).** Detecting `w`/`W`/`e` inside a sed script without a full sed parser may reject legitimate scripts; the rule is "uncertain → reject", recorded under *The allowlist may be too tight*. *(new rev 4)*
- **C4/O2 before S10 stay unprovable (S10).** If the user declines the baseline commit, C4/O2 remain *cannot verify* with the stated reason; nothing else in the plan depends on them. *(new rev 4)*
- **INSIGHTS evidence drift (S11).** S8 may shift `scope-guard.sh:113`; the uncommitted entry's `**Evidence:**` line is corrected before S10, never after. *(new rev 4)*

## Out of scope
- **O1** — A security-reviewer agent.
- **O2** — Editing `researcher.md` or `implementer.md` beyond the S9 reply-language bullet; editing `planner.md` beyond S0 and S9; verified against the S10 baseline. *(rev 4)*
- **O3** — `.claude/skills/**` (incl. `routing.md`, `severity.md`) and `.claude/settings.json`.
- **O4** — Consolidating the tokenizer; CI wiring for the hooks.
- **O5** — A tutorials home; a client-side dependency-cruiser / ESLint boundary config (the reviewer reports the gap).
- **O6** — The staged `docs/skills/README.md` and resolving its case collision with the tracked `docs/skills/readme.md`: a pre-existing change not produced by this plan. The plan only keeps doc-writer out of `docs/skills/**` (S8). *(new rev 4)*
- **O7** — The pre-plan content of `researcher.md`, `implementer.md`, `planner.md` (before S0) and `implementer-guard.sh`: templates that existed untracked before rev 1. This plan neither authored nor verifies them; S10 only makes later edits diffable. *(new rev 4)*

## Sources
**External** (accessed 2026-09-24):
- Claude Code subagents — frontmatter, bare-name `tools`/`disallowedTools` ("A disallowedTools entry with a specifier… still removes the whole tool"), agent-scoped `hooks`, `skills` preload, "use proactively": https://code.claude.com/docs/en/sub-agents
- Permissions — path/command rules are settings-wide, not per agent: https://code.claude.com/docs/en/permissions
- Hooks — PreToolUse input `agent_type`, `tool_name`, `tool_input.file_path`; exit 2 blocks with stderr as reason: https://code.claude.com/docs/en/hooks
- Skills — preload vs on-demand: https://code.claude.com/docs/en/skills
- dependency-cruiser rules reference: https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md
- Palermo, "The Onion Architecture" (2008): https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/
- Cockburn, "Hexagonal Architecture" (2005): https://alistair.cockburn.us/hexagonal-architecture/
- ISO/IEC/IEEE 29148 (requirements traceability): https://www.iso.org/standard/72089.html
- ISTQB glossary — verification vs validation, traceability: https://glossary.istqb.org/
- Anthropic, "Building effective agents" (evaluator-optimizer): https://www.anthropic.com/research/building-effective-agents
- LLM-as-judge rubric practice: https://deepeval.com/docs/metrics-llm-evals
- Testing Library — guiding principles, query priority: https://testing-library.com/docs/guiding-principles , https://testing-library.com/docs/queries/about#priority
- Fastify testing (`inject`): https://fastify.dev/docs/latest/Guides/Testing/
- Vitest mocking: https://vitest.dev/guide/mocking
- Kent C. Dodds, Testing Trophy: https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications
- Stryker mutant states: https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/
- Diátaxis: https://diataxis.fr/
- Write the Docs, docs as code: https://www.writethedocs.org/guide/docs-as-code/
- Nygard, ADRs: https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions
- C4 model: https://c4model.com/
- Mermaid C4 (experimental): https://mermaid.js.org/syntax/c4.html
- GitHub Mermaid rendering: https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams

**In-repo:** `.claude/agents/{README,researcher,planner,implementer}.md` · `.claude/hooks/implementer-guard.sh`, `pr-gate.sh` · `.claude/settings.json` · `.claude/skills/onion-architecture/SKILL.md` · `.claude/skills/frontend-ui-architecture/SKILL.md` · `.claude/skills/pr-self-review/{SKILL,routing,severity,report-template}.md` · `.claude/skills/mermaid-diagram/SKILL.md` · `server/.dependency-cruiser.cjs` · `server/package.json` · `client/eslint.config.mjs` · `TESTING.md` · root, `server/`, `client/`, `e2e/` `AGENTS.md` · `<pkg>/.doc/README.md`, `<pkg>/.spec/README.md` · `docs/agent-prompts/README.md` · root `INSIGHTS.md` · `.gitignore`

## Revisions
- rev 1 · 2026-09-24 · Initial plan from planner: S1–S7, AC1–AC6 · request for four review/test/docs subagents
- rev 2 · 2026-09-24 · Added AC7, S0 (planner update mode), T9; `Revision` field in header; planner.md moved from *Do not touch* to S0-only · user asked for a way to revise saved plans in place
- rev 3 · 2026-09-24 · Fixtures restricted to test dirs; T2 gains `server/src/fixtures/x.json` · user decision on the open fixtures question
- rev 4 · 2026-09-24 · Added AC8, C6, S8 (hook hardening: `--dir`, `tsc --noEmit`, `rg --pre`, `git -c`/`--ext-diff`/`grep -O`, `sed w/e`, `sort --compress-program`, eslint/depcruise output flags, env prefix only `CI=`, symlink-resolved glob check, `docs/skills/**` denied), S9 (reply-language rule, already applied), S10 (baseline commit for C4/O2), S11 (INSIGHTS entry folded in), S12 (C1 section citation), T10, T11, O6, O7; revised C1, C4, C5, O2, S7, T8, T9, Decisions, Review hand-off, Risks; gave Constraints/Out-of-scope bullets C*/O* IDs matching the verifier's numbering · Plan Verification of rev 3 (6 partial, 12 cannot verify, security hand-offs, unplanned changes) plus the user's request that every agent reply in the user's language

**Plan status:** Ready
