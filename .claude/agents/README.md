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

Security review is **not** in this set yet — it belongs to a future reviewer agent. The
pre-PR gate stays the [`pr-self-review`](../skills/pr-self-review/SKILL.md) skill.

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
     │                                   ┌── architecture-reviewer ┤  (run in parallel)
     │                                   └── plan-verifier ────────┘
     │                                                             │
     │                    clean / all items met ◄──────────────────┴──────────► critical finding / item not met
     │                                   │                                                    │
     │                                   ▼                                (fix loop, max 2 rounds, then ask user)
     │                            doc-writer ─► /pr-self-review ─► PR                          │
     │                                                                    implementer (code) · test-writer (tests)
     └── plan itself needs to change ── planner, Update mode ◄── change request / Implementation Report /
                                                                  Plan Verification

researcher — called on demand by any step that needs evidence before a decision.
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

"Read-only commands" is a prompt rule, not a tool restriction: the allowed list lives in
each agent's *Hard rules*. Hard enforcement exists only where a hook backs it:

- **`implementer-guard.sh`** — `PreToolUse(Bash)` hook declared in the implementer's own
  frontmatter, so it applies to that agent only. Blocks `git commit`, `git push`,
  `gh pr …`, `db:migrate` (script or `tsx src/db/migrate.ts`) and `drizzle-kit
  migrate|push`. Fail-open on internal errors, like `pr-gate.sh`.
- **[`scope-guard.sh`](../hooks/scope-guard.sh)** — one shared, parametrized hook behind
  four profiles (`write tests`, `write docs`, `bash readonly`, `bash checks`), each agent's
  own frontmatter wiring only the profiles in the table above. `write tests`/`write docs`
  is a `PreToolUse(Write|Edit|NotebookEdit)` allow/deny glob check on the resolved path,
  checked on both the logical path and its symlink-resolved form; `bash readonly`/`bash
  checks` is a `PreToolUse(Bash)` allowlist per shell segment (`checks` = `readonly` +
  package-script commands such as `typecheck`/`lint`/`test`/`arch`). **Every `checks`
  command runs from the repo root:** `pnpm` is only allowed with `--dir`/`-C` before the
  script, given as its **own token and a bare package name** — `server`, not an absolute
  path, `./server` or `--dir=server` (the attached/`=`/`--prefix*` spellings are rejected
  outright, since they slip a second, unvalidated directory value past the check) — every
  `--dir`/`-C` value is exactly one of `server`, `client`, `reviewer-core`, `e2e`, and
  `--dir e2e` allows only `typecheck`/`lint` (its `test` runs the browser flows). `npm` is
  not allowed at all (it has no `--dir`, only `-C`, which means `--prefix`). `cd`/`pushd`/
  `popd`/`builtin`/`command` are unknown heads in both profiles — a `cd` anywhere in a
  segment, including inside `bash -c`/`( … )`, blocks the whole command — and `git`
  rejects `-C`/`--git-dir*`/`--work-tree*` for pointing at another tree. A shell invoker
  (`bash`/`sh`/…) needs a `-c` command, which is checked like any other segment — piping or
  redirecting a program into it (`… | bash`, `bash < f`) is blocked, and so are `sed -I`/
  clustered `-ni`, attached `sort -oFILE`, and `uniq <in> <out>`. Beyond that,
  **when the Bash call's own working directory is not the project root, every `pnpm`
  segment and the four hook self-check commands below are blocked** ("run from the repo root
  (cwd: …)"), even with no `cd` in the command line itself — the hook compares the
  hook JSON's `cwd` field (fallback: its own process cwd) against `$CLAUDE_PROJECT_DIR`
  (fallback: its own repo). Script forms (`typecheck`/`lint`/`arch`) take **no trailing
  argument**; `test` and `exec vitest run` take only the vitest argument allowlist
  (positional filters, `--exclude`, `-t`/`--testNamePattern`, `--reporter` with a built-in
  name, `--passWithNoTests`, `--silent`); `exec tsc` takes `--noEmit` (required) and
  `-p`/`--project`; `exec depcruise` takes a path under `src`, `--config`/`-c` pinned to
  `.dependency-cruiser.cjs`, `-T err|err-long|text`, `--include-only` — the
  architecture-reviewer uses `-T` for `depcruise`'s output-type flag, since the long form
  is rejected as `--output*` in every segment; `exec eslint` takes a path,
  `--max-warnings <n>`, `-f`/`--format stylish|json`. A positional path argument is
  rejected if absolute, if any segment is `..`, or if any segment is `clones`. Only a
  `CI=` leading environment assignment is accepted (any other `VAR=value` prefix is
  rejected). A backtick or `$(` outside single quotes is rejected as command substitution,
  including in the body of a heredoc whose delimiter is unquoted (a quoted delimiter,
  `<<'EOF'`, keeps the body inert data). Four exact commands are allowed in `checks` only,
  ahead of the normal recursion (and subject to the same repo-root cwd check):
  `bash -n .claude/hooks/scope-guard.sh`, `bash -n .claude/hooks/implementer-guard.sh`,
  `.claude/hooks/scope-guard.sh self-test`, `.claude/hooks/implementer-guard.sh
  self-test` — so a reviewer can run the hooks' own tests. `docs/skills/**`
  is denied to `write docs` until its case-collision with the tracked
  `docs/skills/readme.md` is resolved (O6). Failure policy: an internal runtime error
  (unreadable stdin, unparsable JSON, an unresolvable project root) fails open (exit 0 +
  warning); a parsed command or path outside the allow set — including a cwd mismatch —
  exits 2 and blocks; **an unknown mode or profile argument also exits 2** ("misconfigured
  scope-guard") rather than failing open — it comes from the calling agent's own
  frontmatter, so a typo there should be loud and local, not a silently disarmed guard.
  `pr-gate.sh`/`implementer-guard.sh` keep failing open on an unknown mode and never apply
  the cwd/`cd`/`git -C` rules. **Bash enforcement is best-effort** — an allowlisted
  program can still write files the allowlist never sees (e.g. a test writing a
  snapshot); the prompt rule in each agent's *Hard rules* remains the primary control,
  the hook is a backstop.
- **`pr-gate.sh`** — project-wide hook from `.claude/settings.json`; applies to every
  agent and the main session.

No agent here may spawn subagents (`Agent` is denied on all seven), so review never
happens inside implementation.

## Artifacts

| Agent | Input | Output |
|-------|-------|--------|
| researcher | A question with type, scope and a done criterion | *Repo Research Report* and/or *External Research Report* — findings with confidence, evidence (`path:line`, sha, URL), *Not found* table, **Answer status** line |
| planner | Feature request + `<pkg>/.spec/<feature>.spec.md` (or numbered acceptance criteria) — **or**, in Update mode, an existing `docs/plans/<feature>.plan.md` path plus a change request / Implementation Report / Plan Verification | *Development Plan* — Goal, AC, Constraints (incl. 3 INSIGHTS entries per package), Steps table with skills per step, Test plan, Review hand-off, `**Revision:**` + `## Revisions`, **Plan status** — or *Clarification needed*. Update mode returns the whole revised plan (stable IDs, `*(rev N)*` markers, refreshed `Base`, a new `## Revisions` line), never a diff |
| implementer | Path to an approved `docs/plans/<feature>.plan.md` (`Plan status: Ready`) | Working-tree changes (uncommitted), appended `INSIGHTS.md` entries, *Implementation Report* — steps, deviations, verification table, skipped checks, self-check, reviewer hand-off, open issues |
| test-writer | A plan path, or a named target (files, seams, AC) plus a done criterion | New test files only, *Test Report* — tests written, negative control per test, skills applied, verification, bugs found, production changes needed (not made), insights proposed |
| architecture-reviewer | A base ref (default `git merge-base HEAD origin/main`), a file list, or the implementer's *Hand-off to reviewers* | *Architecture Review* — deterministic checks table (with baseline delta), findings (rule, `file:line`, edge, severity, evidence), checked-no-finding, pre-existing context, `**Review status:**` |
| plan-verifier | A plan path (`Plan status: Ready`) | *Plan Verification* — per-item traceability matrix (verdict + evidence) over every AC/S/T/C/O item, commands run, unplanned changes, handed-off (not judged) items, `**Verification status:**` |
| doc-writer | Source material (plan path, spec, files or feature name) + audience/doc kind | Doc files per the Diátaxis home table, *Documentation Report* — files written, diagrams, claims checked against code, proposed edits outside scope, conventions notes, `**Docs status:**` |

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
below.

### External

| Practice | Where it shows up | Source |
|----------|-------------------|--------|
| `description` drives automatic delegation; state scope and what the agent does *not* do | all seven descriptions | [Subagents][s1] |
| Least privilege via `tools` allowlist + `disallowedTools` denylist | Permissions table | [Subagents][s1] |
| Subagents can nest by default — deny `Agent` to keep review out of implementation | all seven | [Subagents][s1] |
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

All accessed 2026-09-24. The docs do not prescribe plan-on-disk over plan-as-text; the
file handoff is a project decision (visible to people and reviewers).

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

## Troubleshooting

- **A new or edited agent is not offered.** Definitions load at session start — restart
  Claude Code or open `/agents`.
- **The implementer is blocked on a command.** Expected for commits, pushes, PRs and
  migrations: they belong to the main session. Check the matcher with:

  ```bash
  .claude/hooks/implementer-guard.sh self-test
  ```

- **test-writer / architecture-reviewer / plan-verifier / doc-writer is blocked on a Write,
  Edit or Bash command.** Expected outside their profile's allow-list — production code for
  test-writer, anything but a doc path for doc-writer, any write tool at all for the two
  review agents, and any command outside `readonly`/`checks` for Bash. The report's *not
  made* / *cannot verify* sections say what to do in the main session instead. Check the
  matcher, and every path/command case in the plan's Test plan, with:

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
