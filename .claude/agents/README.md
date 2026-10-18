# Agents

Project subagents for DevDigest. Each `<name>.md` here is the agent's definition and the
source of truth for its rules — this file is only the map: who does what, with which
permissions, and what passes between them. To change an agent, edit its file, then update
the matching row here.

The spec-driven flow itself — spec-creator, implementation-planner, implementer,
plan-verifier, researcher and architecture-reviewer, and the `run-plan` and `workflow-retro`
skills — comes from the `sdd-engineering` plugin and its dependencies (root
[`AGENTS.md`](../../AGENTS.md) *Plugins*). The plugin's README is the map of that flow; the
agents below are the project's own, and the plugin calls the first four of them through
`.sdd/config.json` → `agents`.

## Catalog

| Agent | Responsibility | Model | Writes | Preloaded skills |
|-------|----------------|-------|--------|-------------------|
| [test-writer](test-writer.md) | Red mode: before the code, writes the plan's acceptance tests from the spec and the interface skeleton and proves each red on an assertion (hashes frozen). After mode: client RTL, server hermetic and `*.it.test.ts`, reviewer-core and e2e flow tests for code the implementer left untested; never touches production code | `sonnet` | tests only | `engineering-insights` |
| [security-reviewer](security-reviewer.md) | Checks a change set for exploitable vulnerabilities — prompt injection past `wrapUntrusted`/`INJECTION_GUARD`, secrets leaving `LocalSecretsProvider`, clone/command/path handling, SSRF, unvalidated Fastify routes, raw SQL, client XSS; HIGH-confidence findings only, traced source → sink | `opus` | no | `engineering-paved-path:security` |
| [doc-writer](doc-writer.md) | Documents a shipped feature — turns a plan or code into README/`.doc`/root-README material, with Mermaid diagrams checked against the code | `sonnet` | docs only | `sdd-engineering:mermaid-diagram` |
| [retro-writer](retro-writer.md) | After a non-clean reviewer round, records why the loop has not converged — findings by class label, one root cause each, point-fix/class-fix, one Decision sentence, a hard non-convergence gate — into `.harness/retros/`, raw material for harness-analyst | `opus` | retro file only | — |
| [harness-analyst](harness-analyst.md) | Launched manually, never in a fix loop: reads every retro file, prior analysis and `INSIGHTS.md` plus the transcript digest (`harness-usage.mjs`: tokens per feature/agent/run, skills invoked, repeated actions, cost outliers), clusters recurring class labels, harness targets, actions and anomalies across features, proposes concrete harness changes with evidence | `opus` | analysis file only | — |

Security review belongs to security-reviewer; it complements, not replaces, the `security`
bucket of the pre-PR gate [`pr-self-review`](../skills/pr-self-review/SKILL.md).

## Where they run

`/sdd-engineering:run-plan <plan>` runs an approved plan; it uses each agent above when it
is listed in `.sdd/config.json` → `agents`:

- **test-writer** — the red lane after the interface skeleton, and the after-mode lane for
  `Phase: after` rows;
- **security-reviewer** — in the review round, in parallel with
  `architecture-review:architecture-reviewer` and `sdd-engineering:plan-verifier`;
- **retro-writer** — after every non-clean review round, before the fix round;
- **doc-writer** — once the reviewers are clean, before `/pr-self-review` gates the PR.

The run's own retro and ledger row (`docs/retros/<feature>.md`, `docs/retros/ledger.md`)
come from `/sdd-engineering:workflow-retro`. The retro/analysis lifecycle stays local and
runs on the user's schedule:

```
retro-writer ─► .harness/retros/*.retro.md ─(user launches)─► harness-analyst ─►
  .harness/analysis/<date>.md + Decision JSON ─► AskUserQuestion ─► main session:
  record ## User decision · apply (direct | sdd-engineering:implementation-planner →
  sdd-engineering:implementer) · rm consumed retro files
```

**Reply language.** Every agent answers in the language the user started the conversation
in, so every delegating prompt carries a `User language: <language>` line (without it, the
agent falls back to the prompt's own language). Only prose follows it: IDs, paths, code,
command output and the section headings of each agent's skeleton stay verbatim, and files
written to the repo stay in English.

**The retro step.** The main session runs retro-writer after every non-clean reviewer
round and before the fix round starts — this is an explicit main-session step, not a hook
trigger. When a class label recurs across two consecutive entries, retro-writer reports
`Converging: no` and a sign-off proposal; the main session then starts **no further fix
round of any kind** until the user signs off. Only the retro's `Retro:` feed-forward line,
plus `Sign-off:` when there is one, goes to `sdd-engineering:implementation-planner` —
never the whole retro file. The retro file itself is local, gitignored raw material for harness
improvement, not a feature doc: it lives at `.harness/retros/<feature>.retro.md`.

**Harness analysis.** At any time, the user can launch `harness-analyst` manually — never
automatically, never inside a fix loop — to read every `.harness/retros/*.retro.md` and
every prior `.harness/analysis/*.md` and every `INSIGHTS.md`, run
`node .claude/scripts/harness-usage.mjs` (a digest of the local Claude Code transcripts:
tokens per feature, agent type and run, skills invoked, repeated launches and commands,
cost outliers — the only Bash beyond `readonly` it may run), cluster recurring class
labels, harness targets, actions and anomalies **across features**, and propose concrete
harness changes (a prompt, a hook, a skill, the plan template, the flow, an
`AGENTS.md`/`INSIGHTS.md`), each with evidence and a route. This whole lifecycle — write →
analyse → apply → delete — is a **main-session process rule** (C7 of
`docs/plans/harness-retros.plan.md`), not a hook rule. After the user answers the analyst's
`AskUserQuestion` JSON, the main session appends a `## User decision` section to the
analysis file, applies each picked proposal (directly for one file, through
`sdd-engineering:implementation-planner` → `sdd-engineering:implementer` for more than
one, and as a change to the plugin in `shofulk/sdd-marketplace` for an `upstream:` route),
and deletes each consumed retro file. The analyst itself never applies or deletes
anything.

## Permissions

| Agent | Allowed tools | Denied tools | Mode | Extra guard |
|-------|---------------|--------------|------|-------------|
| test-writer | Read, Grep, Glob, Edit, Write, Bash, Skill | Agent, NotebookEdit, WebSearch, WebFetch | `acceptEdits` | [`scope-guard.sh`](../hooks/scope-guard.sh) `write tests` + `bash checks` |
| security-reviewer | Read, Grep, Glob, Bash | Write, Edit, NotebookEdit, Agent, Skill, WebSearch, WebFetch | `default` | [`scope-guard.sh`](../hooks/scope-guard.sh) `bash readonly` (no write tool at all) |
| doc-writer | Read, Grep, Glob, Edit, Write, Bash, Skill | Agent, NotebookEdit, WebSearch, WebFetch | `acceptEdits` | [`scope-guard.sh`](../hooks/scope-guard.sh) `write docs` + `bash readonly` |
| retro-writer | Read, Grep, Glob, Edit, Write, Bash | Agent, NotebookEdit, Skill, WebSearch, WebFetch | `acceptEdits` | [`scope-guard.sh`](../hooks/scope-guard.sh) `write retro` + `bash readonly` |
| harness-analyst | Read, Grep, Glob, Write, Bash | Agent, Edit, NotebookEdit, Skill, WebSearch, WebFetch | `acceptEdits` | [`scope-guard.sh`](../hooks/scope-guard.sh) `write analysis` + `bash readonly` |

"Read-only commands" is a prompt rule, not a tool restriction: the allowed list lives in
each agent's *Hard rules*. Hard enforcement exists only where a hook backs it. Each plugin
guards its own agents from its own `hooks/hooks.json` (`research-tools:researcher` has no
guard beyond its tool list); the scripts below stay for the project agents,
`/pr-self-review` and harness-analyst:

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
- **`implementer-guard.sh`**, `spec-lint.mjs`'s `pre`/`post` modes, the `write spec`
  profile of `scope-guard.sh` and `.claude/scripts/lane-brief.mjs` are no longer wired to a
  project agent: the plugin's implementer and spec-creator carry their own copies. They
  stay as a reference; `spec-lint.mjs check` still serves the `specs` bucket of
  `/pr-self-review`.

No agent here may spawn subagents (`Agent` is denied on all five), so review never happens
inside implementation.

## Artifacts

| Agent | Input | Output |
|-------|-------|--------|
| test-writer | A plan path, or a named target (files, seams, AC) plus a done criterion | New test files only, *Test Report* — tests written, negative control per test, skills applied, verification, bugs found, production changes needed (not made), insights proposed |
| security-reviewer | A base ref (default `git merge-base HEAD origin/main`), a file list, or the implementer's *Hand-off to reviewers → Security* line | *Security Review* — deterministic checks (secret scan, dangerous sinks, injection guard), findings (category, `file:line`, source → sink, exploit path, severity, evidence), needs-verification, checked-no-finding, pre-existing context, limits, `**Review status:**` |
| doc-writer | Source material (plan path, spec, files or feature name) + audience/doc kind | Doc files per the Diátaxis home table, *Documentation Report* — files written, diagrams, claims checked against code, proposed edits outside scope, conventions notes, `**Docs status:**` |
| retro-writer | Plan path + inline reviewer report(s) + `HEAD` sha + clean-round flag, or a backfill instruction — plus the retro file's existing labels and newest entries, when one exists | `.harness/retros/<feature>.retro.md` entry (via marker-line `Edit`, `Write` only on first create), *Retro Report* — entry table, why the loop is (not) converging, feed-forward line, sign-off JSON when not converging, graduation candidates, `**Retro status:**` |
| harness-analyst | `User language:` + `Date:` (+ optional retro-file subset or focus) | `.harness/analysis/<date>.md` (`Write`, once), *Harness Analysis Report* — inputs, usage, recurring actions, anomalies, clusters, proposals, not-proposed, per-retro-file consume recommendation, `AskUserQuestion` decision JSON, limits, `**Analysis status:**` |

A plan's **Skills** column routes every step's files through
[`pr-self-review/routing.md`](../skills/pr-self-review/routing.md); the implementer and
test-writer load exactly those skills, and the same table later drives `/pr-self-review`,
so planning, implementation and the pre-PR gate judge a file by the same skills.

## Sources

The rules of these agents were derived from `researcher` reports (2026-09-24 and
2026-09-25), written when all eleven agents lived here, plus the repo's own conventions.
The rows below are the ones that still apply to the five project agents.

### External

| Practice | Where it shows up | Source |
|----------|-------------------|--------|
| `description` drives automatic delegation; state scope and what the agent does *not* do | all five descriptions | [Subagents][s1] |
| Least privilege via `tools` allowlist + `disallowedTools` denylist | Permissions table | [Subagents][s1] |
| Subagents can nest by default — deny `Agent` to keep review out of implementation | all five | [Subagents][s1] |
| Return a concise structured summary, not raw logs | all output formats | [Subagents][s1] |
| Agent-scoped `hooks`, `permissionMode`, `model`, `skills` frontmatter; `disallowedTools` with a specifier still removes the whole tool | scope-guard hooks, modes | [Subagents][s1] |
| `skills:` preloads the full skill body; other skills load on demand via `Skill` | test-writer, security-reviewer and doc-writer preload one skill; test-writer and doc-writer load the rest per step with `Skill` | [Skills][s2] |
| Permission path/command rules are settings-wide, not per agent — hence a per-agent hook, not a settings rule, for scope | `scope-guard.sh` design | [Permissions][s3] |
| `PreToolUse` hook input carries `tool_input.file_path`; exit 2 blocks with stderr as the reason | `scope-guard.sh` write profiles | [Hooks][s4] |
| Evaluator-optimizer pattern, applied to the loop itself — a separate evaluator judges *why* the implementer/reviewer pair did not converge | retro-writer as a second-order evaluator over a whole review round, not one output | [Building effective agents][s10] |
| A short verbal evaluator signal fed into the next attempt, instead of the whole trace | retro-writer's one-line `Retro:` feed-forward | [Reflexion][s24] |
| Iterative feedback and refinement, with explicit stopping criteria | retro-writer's clean-round stop, and the hard convergence gate as a stronger stop that needs a changed approach, not another attempt | [Self-Refine][s25] |
| Blameless, evidence-based postmortems; action items over narrative | retro-writer's "no blame" rule and its one-sentence Decision requirement | [Postmortem Culture][s26] |
| A single causal chain hides independent causes | retro-writer's "≥ 2 independent causes → ≥ 2 finding rows" rule | 5 Whys limitations (title only, as cited in the 2026-09-25 researcher report — no URL given there) |
| What was planned, what happened, why, and what to change; no blame | the retro entry's field shape (Inputs / Findings / root cause / Decision) | US Army, *A Leader's Guide to After-Action Reviews* (TC 25-20) (title only) |
| Per-session retrospective of agent runs | retro-writer's per-iteration `.harness/retros/<feature>.retro.md` | Cognition, *Devin Session Insights* (title only) |
| Fix the class with an invariant, not by enumerating cases | the point-fix/class-fix column, and C7's rule for the `write retro` profile itself | "Whack-a-mole is losing" invariants essay (title only) |
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
[s10]: https://www.anthropic.com/research/building-effective-agents
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

s1–s23 accessed 2026-09-24; s24–s26 accessed 2026-09-25.

### In-repo

| Rule | Source |
|------|--------|
| Read `INSIGHTS.md` before work, name the three relevant entries; append after | root [`AGENTS.md`](../../AGENTS.md) *Session protocol*, [`engineering-insights`](../skills/engineering-insights/SKILL.md) |
| File → skill → check routing | [`pr-self-review/routing.md`](../skills/pr-self-review/routing.md) |
| Ring and boundary rules | root [`AGENTS.md`](../../AGENTS.md) *Backend rings*, `engineering-paved-path:onion-architecture`, `engineering-paved-path:frontend-ui-architecture` |
| Do-not-touch paths, no new tables, contracts only in `server/src/vendor/shared` | root and `<pkg>/AGENTS.md` |
| Per-package check commands, hermetic vs `*.it.test.ts` | `<pkg>/AGENTS.md`, [`TESTING.md`](../../TESTING.md) |
| Command matcher and fail-open policy of the guard | [`pr-gate.sh`](../hooks/pr-gate.sh) |
| Tokenizer and fail-open pattern reused by `scope-guard.sh` | [`implementer-guard.sh`](../hooks/implementer-guard.sh) |
| Mermaid diagram rules (allowed types, node cap, no `AGENTS.md` diagrams) | [`doc-writer.md`](doc-writer.md) *Hard rules*; syntax in `sdd-engineering:mermaid-diagram` |
| "Marker line alone in `old_string`" as the mechanical form of append-only | [`engineering-insights`](../skills/engineering-insights/SKILL.md) *Never overwrite*, reused by `scope-guard.sh`'s `write retro` profile |

## Troubleshooting

- **A new or edited agent is not offered.** Definitions load at session start — restart
  Claude Code or open `/agents`.
- **A plugin agent or skill is missing** (`sdd-engineering:…`, `engineering-paved-path:…`).
  Run `claude plugin list --json`: the four plugins should be listed, enabled, with no
  `errors`. If they are not, run `claude plugin marketplace add shofulk/sdd-marketplace#stable`
  and `claude plugin install sdd-engineering@sdd-stable --scope project`; its three
  dependencies come with it.
- **test-writer / security-reviewer / doc-writer / retro-writer / harness-analyst is blocked
  on a Write, Edit or Bash command.** Expected outside their profile's allow-list —
  production code for test-writer, anything but a doc path for doc-writer, anything but
  `.harness/retros/<feature>.retro.md` (and only through the marker lines) for retro-writer,
  anything but `.harness/analysis/<date>.md` (and only `Write`, once) for harness-analyst,
  any write tool at all for security-reviewer, and any command outside `readonly`/`checks`
  for Bash. The report's *not made* / *cannot verify* sections say what to do in the main
  session instead. Check the matcher, the canonical tables (`HEAD_ARGS`, `GIT_ARGS`, the
  `pnpm` allowlist, `CHECKS_EXACT`) in [`scope-guard.sh`](../hooks/scope-guard.sh), and every
  path/command case in the plan's Test plan, with:

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
- **retro-writer is blocked on a Write.** The retro file already exists — use `Edit` on one
  of the two marker lines (`<!-- newest first: class-labels -->` or `<!-- newest first:
  retro-entries -->`) instead of `Write`.
- **harness-analyst is blocked on a Write.** That date's analysis file already exists —
  analysis files are write-once, so the analyst chooses `<date>-<n>.md` instead of editing
  the existing one.
- **Grep/Glob do not find files under `.harness/`.** The directory is gitignored and
  hidden, so a repo-wide Grep/Glob skips it; use `ls` or an explicit `.harness/…` path
  (`rg` does read it when given the path directly).
