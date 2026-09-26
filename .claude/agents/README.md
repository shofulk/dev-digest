# Agents

Project subagents for DevDigest. Each `<name>.md` here is the agent's definition and the
source of truth for its rules — this file is only the map: who does what, with which
permissions, and what passes between them. To change an agent, edit its file, then update
the matching row here.

## Catalog

| Agent | Responsibility | Model | Writes | Preloaded skills |
|-------|----------------|-------|--------|-------------------|
| [researcher](researcher.md) | Answers one concrete question with evidence — in-repo (A), external docs (B), or both | `sonnet` | no | — |
| [planner](planner.md) | Turns a spec or feature request into a Development Plan bound to the modules, skills, INSIGHTS and architecture rules; given an existing plan's path plus a change, revises it in place (Update mode) | `opus` | no | `onion-architecture`, `frontend-ui-architecture` |
| [implementer](implementer.md) | Executes an approved plan in server/, client/, reviewer-core/, e2e/; runs the package checks; self-checks its own diff | `sonnet` | code + tests | `engineering-insights`, `onion-architecture`, `frontend-ui-architecture` |
| [test-writer](test-writer.md) | Writes client RTL, server hermetic and `*.it.test.ts`, reviewer-core and e2e flow tests for code the implementer (or a plan step) left untested; never touches production code | `sonnet` | tests only | `engineering-insights` |
| [architecture-reviewer](architecture-reviewer.md) | Checks a change set against onion rings, frontend-ui-architecture, reviewer-core purity, vendor mirrors, the DI-container rule and package independence; reuses `pnpm --dir server arch` | `opus` | no | `onion-architecture`, `frontend-ui-architecture` |
| [plan-verifier](plan-verifier.md) | Builds a per-item traceability matrix over every plan item and spec AC — verdict + evidence, never generic advice | `opus` | no | — |
| [doc-writer](doc-writer.md) | Documents a shipped feature — turns a plan or code into README/`.doc`/root-README material, with Mermaid diagrams checked against the code | `sonnet` | docs only | `mermaid-diagram` |
| [retro-writer](retro-writer.md) | After a non-clean reviewer round, records why the loop has not converged — findings by class label, one root cause each, point-fix/class-fix, one Decision sentence, a hard non-convergence gate — into `.harness/retros/`, raw material for harness-analyst | `opus` | retro file only | — |
| [harness-analyst](harness-analyst.md) | Launched manually, never in a fix loop: reads every retro file and prior analysis, clusters recurring class labels and harness targets across features, proposes concrete harness changes with evidence | `opus` | analysis file only | — |

Security review is **not** in this set yet — it belongs to a future reviewer agent. The
pre-PR gate stays the [`pr-self-review`](../skills/pr-self-review/SKILL.md) skill. Until
such an agent exists, a reproduced permission-boundary bypass fails the round exactly like
any other unmet item — see [*The fix loop*](#flow).

## Flow

```
request / .spec ─► planner ─► Development Plan ─► user approves ─► docs/plans/<feature>.plan.md
     ▲                                                                        │
     │ Clarification needed (JSON → AskUserQuestion)                         ▼
     │                                                        implementer ─► code + tests + INSIGHTS entries
     │                                                             │
     │                                                             ▼
     │                                                test-writer? ─► tests + INSIGHTS entries (proposed)
     │                                                             │
     │                                            main session: manual acceptance
     │                                                             │
     │                                   ┌── architecture-reviewer ┤  (run in parallel)
     │                                   └── plan-verifier ────────┘
     │                                                             │
     │                    clean / all items met ◄──────────────────┴──────────► critical finding / item not met / reproduced bypass
     │                                   │                                                    │
     │                                   ▼                                                    ▼
     │                            doc-writer ─► /pr-self-review ─► PR                   retro-writer ─► .harness/retros/<feature>.retro.md
     │                                                                                         │
     │                                                              converging ◄────────────────────────────► not converging
     │                                                                   │                                            │
     │                                                                   ▼                                            ▼
     │                                                   (fix loop, max 2 rounds, then ask user)      ask user (sign-off with changed approach)
     │                                                   implementer (code) · test-writer (tests)                     │
     └── plan itself needs to change ── planner, Update mode ◄── change request / Implementation Report /   Sign-off: <option> · date
                                                                  Plan Verification / Retro (Retro: line + Sign-off:)

researcher — called on demand by any step that needs evidence before a decision.
```

The retro/analysis lifecycle runs alongside the loop above, on the user's own schedule:

```
retro-writer ─► .harness/retros/*.retro.md ─(user launches)─► harness-analyst ─►
  .harness/analysis/<date>.md + Decision JSON ─► AskUserQuestion ─► main session:
  record ## User decision · apply (direct | planner → implementer) · rm consumed retro files
```

The main session is the orchestrator: subagents cannot ask the user, so a *Clarification
needed* block comes back to the main session, which asks and re-invokes the agent. The
planner cannot write, so the main session saves the approved plan to
`docs/plans/<feature>.plan.md` and gives the implementer that path.

**Reply language.** Every agent answers in the language the user started the conversation
in, so every delegating prompt carries a `User language: <language>` line (without it, the
agent falls back to the prompt's own language). Only prose follows it: IDs, paths, code,
command output and the section headings of each agent's skeleton stay verbatim, and files
written to the repo stay in English.

**The fix loop.** architecture-reviewer and plan-verifier run in parallel after the
implementer (and test-writer, when one ran). A critical architecture finding or a plan
item verified "not met"/"partial" goes back to the implementer for a code fix, or to
test-writer for a test gap; if the finding means the *plan* was wrong, the main session
re-invokes the planner in **Update mode** with the Implementation Report or Plan
Verification as the change input, and the corrected plan flows through implementer →
reviewers again. After 2 re-verify rounds with no clean result, the main session stops
looping and asks the user. doc-writer runs once both reviewers are clean, then
`/pr-self-review` gates the PR. Updating a plan is not only a fix-loop step: any time an
approved plan needs to change, the main session hands the planner that plan's path plus
the change (a request in words, an Implementation Report, or a Plan Verification), and
gets back the whole revised plan to save over the same file.

The main session reproduces every plan-verifier `bypass-candidate` through the
**full JSON dispatch**, a `node`-built `JSON.stringify` payload piped into the hook, with
the agent's own profile arguments as separate quoted arguments, from `bash -c`. Reproduced
(the hook allows what the boundary should block), it **fails the round** exactly like "not
met": the payload, exit code and stderr go to retro-writer with the reviewer reports, then
the fix loop, fixed by class invariant, not by the reported spelling. A candidate that is
not reproduced is recorded — the payload and exit code — and does not fail the round. A
malformed probe that fails open proves nothing; it is not a reproduced bypass.

**Manual acceptance.** Between the implementer (and test-writer, when one ran) and the
reviewers, the main session runs or delegates every `manual acceptance:` line from the
Implementation Report's *Open issues*. An implementer `Partial` whose only open items are
`manual acceptance:` lines routes to this step, not a fix round. For a running stack it
first checks the real `API_PORT`/`WEB_PORT` and reuses a healthy running stack, rather than
assuming 3000/3001 or re-running `dev.sh` on top of one — root `INSIGHTS.md` 2026-09-26
("this sandbox's `server/.env`/`client/.env` already override the default ports"). It
passes each result (the command or action plus the key output line) to plan-verifier as a
`Manual acceptance:` block. An item it cannot run stays *cannot verify*, never `met`.

**The retro step.** The main session runs retro-writer after every non-clean reviewer
round and before the fix round starts — this is an explicit main-session step, not a hook
trigger. When a class label recurs across two consecutive entries, retro-writer reports
`Converging: no` and a sign-off proposal; the main session then starts **no further fix
round of any kind** — planner Update mode, an implementer or test-writer fix, or an
in-place main-session fix — until the user signs off, because an earlier in-place fix once
bypassed both the planner and the reviewers entirely and a narrower gate would leave that
path open. This complements, not replaces, the 2-round rule above: the 2-round rule is a
*budget* that catches whack-a-mole across different classes, while the retro's class gate
is a *diagnosis* that can fire as early as round 2, on a single repeated class. Only the
retro's `Retro:` feed-forward line, plus `Sign-off:` when there is one, goes to the
planner — never the whole retro file. The retro file itself is local, gitignored raw
material for harness improvement, not a feature doc: it lives at
`.harness/retros/<feature>.retro.md`.

**Harness analysis.** At any time, the user can launch `harness-analyst` manually — never
automatically, never inside a fix loop — to read every `.harness/retros/*.retro.md` and
every prior `.harness/analysis/*.md`, cluster recurring class labels and harness targets
**across features**, and propose concrete harness changes (a prompt, a hook, a skill, the
plan template, the README flow, an `AGENTS.md`/`INSIGHTS.md`), each with evidence and a
route. This whole lifecycle — write → analyse → apply → delete — is a **main-session
process rule** (C7 of `docs/plans/harness-retros.plan.md`), not a hook rule: no hook holds
"apply chosen proposals," "record the user decision" or "delete consumed retro files",
because the main session has no agent frontmatter for a hook to bind. After the user
answers the analyst's `AskUserQuestion` JSON, the main session appends a `## User decision`
section to the analysis file, applies each picked proposal (directly for one file, through
planner → implementer for more than one), and deletes each consumed retro file. The
analyst itself never applies or deletes anything.

**Gate enforcement.** The convergence gate is a main-session process rule, not a hook
rule: the main session has no agent frontmatter for `.claude/settings.json` to bind, so no
`PreToolUse` hook can hold it directly. Its one mechanical backstop is the planner's own
refusal to apply a change while the retro signal says `Converging: no` and the input
carries no `Sign-off:` (Update mode step 1a/7) — an in-place main-session fix that skips
the planner is held by the process rule alone.

## Permissions

| Agent | Allowed tools | Denied tools | Mode | Extra guard |
|-------|---------------|--------------|------|-------------|
| researcher | Read, Grep, Glob, Bash (read-only commands), WebSearch, WebFetch, AskUserQuestion | Write, Edit, NotebookEdit, Skill | default | — |
| planner | Read, Grep, Glob, Bash (read-only commands) | Write, Edit, NotebookEdit, Agent, Skill, WebSearch, WebFetch | `plan` | — |
| implementer | Read, Grep, Glob, Edit, Write, Bash, Skill | Agent, NotebookEdit, WebSearch, WebFetch | `acceptEdits` | [`implementer-guard.sh`](../hooks/implementer-guard.sh) |
| test-writer | Read, Grep, Glob, Edit, Write, Bash, Skill | Agent, NotebookEdit, WebSearch, WebFetch | `acceptEdits` | [`scope-guard.sh`](../hooks/scope-guard.sh) `write tests` + `bash checks` |
| architecture-reviewer | Read, Grep, Glob, Bash | Write, Edit, NotebookEdit, Agent, Skill, WebSearch, WebFetch | `default` | [`scope-guard.sh`](../hooks/scope-guard.sh) `bash checks` (no write tool at all) |
| plan-verifier | Read, Grep, Glob, Bash | Write, Edit, NotebookEdit, Agent, Skill, WebSearch, WebFetch | `default` | [`scope-guard.sh`](../hooks/scope-guard.sh) `bash checks` (no write tool at all) |
| doc-writer | Read, Grep, Glob, Edit, Write, Bash, Skill | Agent, NotebookEdit, WebSearch, WebFetch | `acceptEdits` | [`scope-guard.sh`](../hooks/scope-guard.sh) `write docs` + `bash readonly` |
| retro-writer | Read, Grep, Glob, Edit, Write, Bash | Agent, NotebookEdit, Skill, WebSearch, WebFetch | `acceptEdits` | [`scope-guard.sh`](../hooks/scope-guard.sh) `write retro` + `bash readonly` |
| harness-analyst | Read, Grep, Glob, Write, Bash | Agent, Edit, NotebookEdit, Skill, WebSearch, WebFetch | `acceptEdits` | [`scope-guard.sh`](../hooks/scope-guard.sh) `write analysis` + `bash readonly` |

"Read-only commands" is a prompt rule, not a tool restriction: the allowed list lives in
each agent's *Hard rules*. Hard enforcement exists only where a hook backs it:

- **`implementer-guard.sh`** — `PreToolUse(Bash)` hook declared in the implementer's own
  frontmatter, so it applies to that agent only. Blocks `git commit`, `git push`,
  `gh pr …`, `db:migrate` (script or `tsx src/db/migrate.ts`) and `drizzle-kit
  migrate|push`. Fail-open on internal errors, like `pr-gate.sh`.
<!-- scope-guard canonical: begin -->
- **[`scope-guard.sh`](../hooks/scope-guard.sh)** — one shared, parametrized hook behind
  six profiles (`write tests`, `write docs`, `write retro`, `write analysis`, `bash
  readonly`, `bash checks`), each agent's own frontmatter wiring only the profiles in the
  table above. `write tests`/`write docs`/`write retro`/`write analysis` is a
  `PreToolUse(Write|Edit|NotebookEdit)` allow/deny glob check on the resolved path, checked
  on both the logical path and its symlink-resolved form; `bash readonly`/`bash checks` is
  a `PreToolUse(Bash)` allowlist per shell segment (`checks` = `readonly` + package-script
  commands such as `typecheck`/`lint`/`test`/`arch`). `write retro` is one allow glob
  (`.harness/retros/*.retro.md`, no nesting) plus a default deny, with the old location
  (`docs/plans/*.retro.md`), `docs/plans/*.plan.md` and `**/INSIGHTS.md` each getting their
  own named block message; append-only is mechanical, not a list of forbidden edits —
  `Write` only when the target does not exist yet, `Edit` only when `old_string` is exactly
  one of the two marker lines and `new_string` starts with that same marker (followed by a
  newline) exactly once, with `replace_all` not `true`. `write analysis` is one allow glob
  (`.harness/analysis/*.md`, no nesting) plus a default deny, with `.harness/retros/**`,
  `.claude/**`, `**/AGENTS.md`, `**/CLAUDE.md` and `**/INSIGHTS.md` each getting their own
  named block message; write-once, not append-only — `Write` only when the target does not
  exist yet, every other tool (`Edit`, `NotebookEdit`, a missing `tool_name`) is blocked
  outright. Both `write retro` and `write analysis` also apply one shared invariant: the
  file name must not start with a dot (no empty or hidden name, which `ls` — without `-a` —
  would hide from harness-analyst); `write tests`/`write docs` are unchanged and keep no
  such rule, since they write tracked, PR-reviewed paths. `write docs` is unchanged: it
  still denies all of `docs/plans/**`, retro files included, and neither `write docs` nor
  `write tests` allows anything under `.harness/**` — no path in either allow list starts
  with `.harness/` — so the four write profiles never both claim the same path.

  Every write profile also judges the symlink-resolved path, not only the logical one: a path the resolver cannot resolve is denied.

  **Bash (`readonly`/`checks`) grammar — five invariants.** (1) Every admitted head is
  judged against its own argument grammar — boolean short clusters, value flags (attached
  or as the next token), exact long flags only, and an operand policy — defined once in
  `HEAD_ARGS` (the readonly heads) and `GIT_ARGS` (one row per git subcommand). (2) A head
  must be a bare command name with no `/`, except the literal `CHECKS_EXACT` strings, and a
  shell invoker (`bash`/`sh`/`zsh`/`dash`) is admitted only as `-c <program>` with no other
  operand and no input redirection; `eval` evaluates its operands joined by one space.
  (3) Every judged path — `pnpm` positional arguments and `-p`/`--project`, `--dir`/`-C`
  values, and the path inside a `CHECKS_EXACT` command — goes through one symlink-following
  resolver and is judged on the resolved path; a value starting with `~` or containing `$`,
  `*`, `?` or `[` is rejected outright. (4) The tokenizer only understands single/double
  quoting: a word the tokenizer does not model is rejected — a `\`/`$` outside single
  quotes, an assignment-only segment (only the exact `CI=1` prefix is admitted), an unquoted glob character at any position (`*`, `?`, `[`, whatever precedes it — a literal, an empty quote pair, or another quoted part), or an unquoted `>`/`<` glued to the middle of a word outside the leading digit*+operator prefix a redirection check already models — checked before every other rule, at every recursion
  depth. (5) **Every `checks` command runs from the repo root** — when the Bash call's own working directory is not `$CLAUDE_PROJECT_DIR`
  (fallback: its own repo), every `pnpm` segment and every `CHECKS_EXACT` command is
  blocked ("run from the repo root (cwd: …)"), even with no `cd` in the command line
  itself. The canonical, exhaustive allow-lists are `HEAD_ARGS`, `GIT_ARGS`, the `pnpm`
  argument allowlist and `CHECKS_EXACT`, all defined once in
  [`scope-guard.sh`](../hooks/scope-guard.sh) — this bullet names the invariants, not every
  flag; widening the grammar is one table edit plus a matched allowed/blocked pair of
  self-test rows. `docs/skills/**` is denied to `write docs` until its case-collision with
  the tracked `docs/skills/readme.md` is resolved (O6). Failure policy: an internal runtime
  error (unreadable stdin, unparsable JSON, an unresolvable project root) fails open (exit 0
  + warning); a resolver failure and any exception thrown while evaluating a parsed command
  are a POLICY-DENY, never fail-open; a parsed command or path outside the allow set —
  including a cwd mismatch — exits 2 and blocks; **an unknown mode or profile argument also
  exits 2** ("misconfigured scope-guard") rather than failing open — it comes from the
  calling agent's own frontmatter, so a typo there should be loud and local, not a silently
  disarmed guard. Both evaluators allow on exactly one exit code, `SG_ALLOW_RC`; any other evaluator exit is denied, not allowed — a crash, a kill or a missing `node` all block loudly instead of failing open. `pr-gate.sh`/`implementer-guard.sh` keep failing open on an unknown mode
  and never apply the cwd/`cd`/`git -C` rules. **Bash enforcement is best-effort** — an
  allowlisted program can still write files the allowlist never sees (e.g. a test writing a
  snapshot); the prompt rule in each agent's *Hard rules* remains the primary control,
  the hook is a backstop.
<!-- scope-guard canonical: end -->
- **`pr-gate.sh`** — project-wide hook from `.claude/settings.json`; applies to every
  agent and the main session.

No agent here may spawn subagents (`Agent` is denied on all nine), so review never
happens inside implementation.

## Artifacts

| Agent | Input | Output |
|-------|-------|--------|
| researcher | A question with type, scope and a done criterion | *Repo Research Report* and/or *External Research Report* — findings with confidence, evidence (`path:line`, sha, URL), *Not found* table, **Answer status** line |
| planner | Feature request + `<pkg>/.spec/<feature>.spec.md` (or numbered acceptance criteria) — **or**, in Update mode, an existing `docs/plans/<feature>.plan.md` path plus a change request / Implementation Report / Plan Verification, plus the `Retro:` line and `Sign-off:` when there is one. The retro fallback is `.harness/retros/<feature>.retro.md`; a missing file means no retro signal, not a block | *Development Plan* — Goal, AC, Constraints (incl. 3 INSIGHTS entries per package), Steps table with skills per step, Test plan, Review hand-off, `**Revision:**` + `## Revisions`, **Plan status** — or *Clarification needed*. Update mode returns the whole revised plan (stable IDs, `*(rev N)*` markers, refreshed `Base`, a new `## Revisions` line), never a diff |
| implementer | Path to an approved `docs/plans/<feature>.plan.md` (`Plan status: Ready`) | Working-tree changes (uncommitted), appended `INSIGHTS.md` entries, *Implementation Report* — steps, deviations, verification table, skipped checks, self-check, reviewer hand-off, open issues |
| test-writer | A plan path, or a named target (files, seams, AC) plus a done criterion | New test files only, *Test Report* — tests written, negative control per test, skills applied, verification, bugs found, production changes needed (not made), insights proposed |
| architecture-reviewer | A base ref (default `git merge-base HEAD origin/main`), a file list, or the implementer's *Hand-off to reviewers* | *Architecture Review* — deterministic checks table (with baseline delta), findings (rule, `file:line`, edge, severity, evidence), checked-no-finding, pre-existing context, `**Review status:**` |
| plan-verifier | A plan path (`Plan status: Ready`) + optional `Manual acceptance:` block | *Plan Verification* — per-item traceability matrix (verdict + evidence) over every AC/S/T/C/O item, commands run, unplanned changes, handed-off (not judged) items, `**Verification status:**` |
| doc-writer | Source material (plan path, spec, files or feature name) + audience/doc kind | Doc files per the Diátaxis home table, *Documentation Report* — files written, diagrams, claims checked against code, proposed edits outside scope, conventions notes, `**Docs status:**` |
| retro-writer | Plan path + inline reviewer report(s) + `HEAD` sha + clean-round flag, or a backfill instruction — plus the retro file's existing labels and newest entries, when one exists | `.harness/retros/<feature>.retro.md` entry (via marker-line `Edit`, `Write` only on first create), *Retro Report* — entry table, why the loop is (not) converging, feed-forward line, sign-off JSON when not converging, graduation candidates, `**Retro status:**` |
| harness-analyst | `User language:` + `Date:` (+ optional retro-file subset or focus) | `.harness/analysis/<date>.md` (`Write`, once), *Harness Analysis Report* — inputs, clusters, proposals, not-proposed, per-retro-file consume recommendation, `AskUserQuestion` decision JSON, limits, `**Analysis status:**` |

The link between planner and implementer is the **Skills** column of the plan: the
planner routes every step's files through
[`pr-self-review/routing.md`](../skills/pr-self-review/routing.md), and the implementer
loads exactly those skills (plus any bucket its real files hit). The same table later
drives `/pr-self-review`, so planning, implementation and the pre-PR gate judge a file by
the same skills.

## Sources

The planner and implementer rules were derived from a `researcher` report (2026-09-24)
over these sources, plus the repo's own conventions. The test-writer, architecture-reviewer,
plan-verifier and doc-writer rules (and the planner's Update mode) were derived from three
further `researcher` reports plus the planner itself (2026-09-24), covering the sources
below. The retro-writer rules (and the planner's `Retro:`/`Sign-off:` handling) were
derived from a further `researcher` report (2026-09-25), covering the additional sources
below.

### External

| Practice | Where it shows up | Source |
|----------|-------------------|--------|
| `description` drives automatic delegation; state scope and what the agent does *not* do | all nine descriptions | [Subagents][s1] |
| Least privilege via `tools` allowlist + `disallowedTools` denylist | Permissions table | [Subagents][s1] |
| Subagents can nest by default — deny `Agent` to keep review out of implementation | all nine | [Subagents][s1] |
| Fresh context per subagent — the plan must be self-contained | planner output, plan file handoff | [Subagents][s1] |
| Return a concise structured summary, not raw logs | all output formats | [Subagents][s1] |
| Agent-scoped `hooks`, `permissionMode`, `model`, `skills` frontmatter; `disallowedTools` with a specifier still removes the whole tool | implementer/scope-guard hooks, modes | [Subagents][s1] |
| `skills:` preloads the full skill body; other skills load on demand via `Skill` | preload only the architecture skills, route the rest per step | [Skills][s2] |
| Progressive disclosure — keep preloaded context small | on-demand loading of practice skills | [Skills][s2] |
| Permission path/command rules are settings-wide, not per agent — hence a per-agent hook, not a settings rule, for scope | `scope-guard.sh` design | [Permissions][s3] |
| `PreToolUse` hook input carries `tool_input.file_path`; exit 2 blocks with stderr as the reason | `scope-guard.sh` write profiles | [Hooks][s4] |
| dependency-cruiser rule set and `--output-type err`/`err-long` | architecture-reviewer's deterministic pre-pass | [dependency-cruiser rules][s5] |
| Onion Architecture — rings point inward | `onion-architecture` skill, reused by architecture-reviewer | [Palermo][s6] |
| Hexagonal / ports-and-adapters — the adapter boundary | `onion-architecture` skill | [Cockburn][s7] |
| Requirements traceability (matrix of item → evidence) | plan-verifier's traceability matrix | [ISO/IEC/IEEE 29148][s8] |
| Verification vs validation terminology | plan-verifier verdicts (met / partial / not met) | [ISTQB glossary][s9] |
| Evaluator-optimizer pattern — a judge agent scores another agent's output | architecture-reviewer / plan-verifier as evaluators of the implementer | [Building effective agents][s10] |
| Evaluator-optimizer pattern, applied to the loop itself — a separate evaluator judges *why* the implementer/reviewer pair did not converge | retro-writer as a second-order evaluator over a whole review round, not one output | [Building effective agents][s10] |
| A short verbal evaluator signal fed into the next attempt, instead of the whole trace | retro-writer's one-line `Retro:` feed-forward, read by the planner via `rg -m1` only | [Reflexion][s24] |
| Iterative feedback and refinement, with explicit stopping criteria | retro-writer's clean-round stop, and the hard convergence gate as a stronger stop that needs a changed approach, not another attempt | [Self-Refine][s25] |
| Blameless, evidence-based postmortems; action items over narrative | retro-writer's "no blame" rule and its one-sentence Decision requirement | [Postmortem Culture][s26] |
| A single causal chain hides independent causes | retro-writer's "≥ 2 independent causes → ≥ 2 finding rows" rule | 5 Whys limitations (title only, as cited in the 2026-09-25 researcher report — no URL given there) |
| What was planned, what happened, why, and what to change; no blame | the retro entry's field shape (Inputs / Findings / root cause / Decision) | US Army, *A Leader's Guide to After-Action Reviews* (TC 25-20) (title only) |
| Per-session retrospective of agent runs | retro-writer's per-iteration `.harness/retros/<feature>.retro.md` | Cognition, *Devin Session Insights* (title only) |
| Fix the class with an invariant, not by enumerating cases | the point-fix/class-fix column, and C7's rule for the `write retro` profile itself | "Whack-a-mole is losing" invariants essay (title only) |
| LLM-as-judge needs a fixed rubric and cited evidence, not free-form opinion | plan-verifier's "forbidden: generic advice" rule | [LLM-as-judge rubric practice][s11] |
| Testing Library guiding principles and query priority (`getByRole` → … → `getByTestId`) | test-writer RTL rules | [Testing Library][s12], [Query priority][s13] |
| Fastify `app.inject()` for route tests | test-writer server rules | [Fastify testing][s14] |
| Mocking the boundary you own, not the unit under test | test-writer mocking rule | [Vitest mocking][s15] |
| Testing Trophy — weight integration over unit | test-writer's seam-based test kind choice | [Kent C. Dodds][s16] |
| A mutant/test that should fail but doesn't is a live bug signal | test-writer's negative control | [Stryker mutant states][s17] |
| Diátaxis four doc types (tutorial / how-to / reference / explanation) | doc-writer homes table | [Diátaxis][s18] |
| Docs as code — docs live and are reviewed next to the code they describe | doc-writer writing to `<pkg>/README.md`/`.doc/` | [Write the Docs][s19] |
| Architecture Decision Records | doc-writer `.doc/<topic>.md` "decisions" home | [Nygard, ADRs][s20] |
| C4 model levels | doc-writer diagram scope discussion | [C4 model][s21] |
| Mermaid C4 support is experimental — avoid it | doc-writer's allowed Mermaid diagram types | [Mermaid C4][s22] |
| Mermaid renders natively in GitHub previews | doc-writer's validation method (no local Mermaid CLI) | [GitHub Mermaid][s23] |

[s1]: https://code.claude.com/docs/en/sub-agents
[s2]: https://code.claude.com/docs/en/skills
[s3]: https://code.claude.com/docs/en/permissions
[s4]: https://code.claude.com/docs/en/hooks
[s5]: https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md
[s6]: https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/
[s7]: https://alistair.cockburn.us/hexagonal-architecture/
[s8]: https://www.iso.org/standard/72089.html
[s9]: https://glossary.istqb.org/
[s10]: https://www.anthropic.com/research/building-effective-agents
[s11]: https://deepeval.com/docs/metrics-llm-evals
[s12]: https://testing-library.com/docs/guiding-principles
[s13]: https://testing-library.com/docs/queries/about#priority
[s14]: https://fastify.dev/docs/latest/Guides/Testing/
[s15]: https://vitest.dev/guide/mocking
[s16]: https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications
[s17]: https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/
[s18]: https://diataxis.fr/
[s19]: https://www.writethedocs.org/guide/docs-as-code/
[s20]: https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions
[s21]: https://c4model.com/
[s22]: https://mermaid.js.org/syntax/c4.html
[s23]: https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams
[s24]: https://arxiv.org/abs/2303.11366
[s25]: https://arxiv.org/abs/2303.17651
[s26]: https://sre.google/sre-book/postmortem-culture/

s1–s23 accessed 2026-09-24; s24–s26 accessed 2026-09-25. The docs do not prescribe
plan-on-disk over plan-as-text; the file handoff is a project decision (visible to people
and reviewers).

### In-repo

| Rule | Source |
|------|--------|
| Read `INSIGHTS.md` before work, name the three relevant entries; append after | root [`AGENTS.md`](../../AGENTS.md) *Session protocol*, [`engineering-insights`](../skills/engineering-insights/SKILL.md) |
| No spec → ask before planning | root `AGENTS.md` *Read when*, `<pkg>/.spec/README.md` |
| File → skill → check routing | [`pr-self-review/routing.md`](../skills/pr-self-review/routing.md) |
| Ring and boundary rules | [`onion-architecture`](../skills/onion-architecture/SKILL.md), [`frontend-ui-architecture`](../skills/frontend-ui-architecture/SKILL.md) |
| Do-not-touch paths, no new tables, contracts only in `server/src/vendor/shared` | root and `<pkg>/AGENTS.md` |
| Per-package check commands, hermetic vs `*.it.test.ts` | `<pkg>/AGENTS.md`, [`TESTING.md`](../../TESTING.md) |
| Clarify gate returned as JSON for `AskUserQuestion` | [`researcher.md`](researcher.md) Step 0 |
| Command matcher and fail-open policy of the guard | [`pr-gate.sh`](../hooks/pr-gate.sh) |
| Tokenizer and fail-open pattern reused by `scope-guard.sh` | [`implementer-guard.sh`](../hooks/implementer-guard.sh) |
| Severity mapping (`error` → critical, `warn` → major) reused by architecture-reviewer | [`pr-self-review/severity.md`](../skills/pr-self-review/severity.md) |
| Mermaid diagram rules (allowed types, node cap, no `AGENTS.md` diagrams) | [`mermaid-diagram`](../skills/mermaid-diagram/SKILL.md) |
| "Marker line alone in `old_string`" as the mechanical form of append-only | [`engineering-insights`](../skills/engineering-insights/SKILL.md) *Never overwrite*, reused by `scope-guard.sh`'s `write retro` profile |

## Troubleshooting

- **A new or edited agent is not offered.** Definitions load at session start — restart
  Claude Code or open `/agents`.
- **The implementer is blocked on a command.** Expected for commits, pushes, PRs and
  migrations: they belong to the main session. Check the matcher with:

  ```bash
  .claude/hooks/implementer-guard.sh self-test
  ```

- **test-writer / architecture-reviewer / plan-verifier / doc-writer / retro-writer /
  harness-analyst is blocked on a Write, Edit or Bash command.** Expected outside their
  profile's allow-list — production code for test-writer, anything but a doc path for
  doc-writer, anything but `.harness/retros/<feature>.retro.md` (and only through the
  marker lines) for retro-writer, anything but `.harness/analysis/<date>.md` (and only
  `Write`, once) for harness-analyst, any write tool at all for the two review agents, and
  any command outside `readonly`/`checks` for Bash. The report's *not made* / *cannot
  verify* sections say what to do in the main session instead. Check the matcher, the
  canonical tables (`HEAD_ARGS`, `GIT_ARGS`, the `pnpm` allowlist, `CHECKS_EXACT`) in
  [`scope-guard.sh`](../hooks/scope-guard.sh), and every path/command case in the plan's
  Test plan, with:

  ```bash
  .claude/hooks/scope-guard.sh self-test
  ```

- **An agent is blocked on every single Write/Edit or Bash call, saying "misconfigured
  scope-guard".** Its frontmatter names a `write`/`bash` profile the hook does not
  recognise (a typo, e.g. `write test` instead of `write tests`) — this fails closed on
  purpose (S15(e)) rather than silently allowing everything, so it shows up on the agent's
  very first call. Fix the profile name in the agent's `hooks:` block; the message names
  the mode and sub-profile it received.

- **A `checks`-profile agent is blocked on `pnpm`/a hook self-check, saying "run from the repo
  root".** The Bash call's own working directory is not the project root (S19) — the
  agent cannot `cd` back (rejected in every profile), so it reports *cannot verify* /
  *Limits* naming the command, never a retry with a different spelling; the main session
  re-invokes it once the cwd is right.

- **The planner returns *Clarification needed*.** Answer the questions (the main session
  passes the JSON to `AskUserQuestion`) and re-invoke it with the answers, or write the
  spec first.
- **A plan needs to change after it was approved.** Re-invoke the planner with the
  existing plan's path plus the change (a request in words, an Implementation Report, or a
  Plan Verification) — Update mode returns the whole revised plan, IDs unchanged, save it
  over the same `docs/plans/<feature>.plan.md`.
- **retro-writer is blocked on a Write.** The retro file already exists — use `Edit` on one
  of the two marker lines (`<!-- newest first: class-labels -->` or `<!-- newest first:
  retro-entries -->`) instead of `Write`.
- **The planner returns Blocked: not converging.** Get the user's sign-off on the
  retro-writer's proposed changed approach, then pass `Sign-off: <option> · YYYY-MM-DD` in
  the next planner or implementer prompt — the planner refuses to apply a change while the
  retro signal says `Converging: no` and no `Sign-off:` is present (Update mode step 7).
- **harness-analyst is blocked on a Write.** That date's analysis file already exists —
  analysis files are write-once, so the analyst chooses `<date>-<n>.md` instead of editing
  the existing one.
- **The planner finds no retro signal.** Expected once `.harness/retros/<feature>.retro.md`
  has been consumed and deleted by a prior harness-analyst decision — the planner proceeds
  with no retro input, it does not block.
- **Grep/Glob do not find files under `.harness/`.** The directory is gitignored and
  hidden, so a repo-wide Grep/Glob skips it; use `ls` or an explicit `.harness/…` path
  (`rg` does read it when given the path directly).
