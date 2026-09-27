# Development Plan: harness-retros — local retro files as raw material for improving the agent harness, plus a periodic harness-analyst

**Spec:** none (criteria from request, approved by the user in conversation on 2026-09-26) · **Packages:** repo tooling: `.claude/` (agents, hooks), root `.gitignore`, `docs/plans/` (two tracked retro files leave git). No package code in server/, client/, reviewer-core/ or e2e/ changes · **Base:** `df00f96` (branch `L03-Subagents`; HEAD unchanged since rev 1, the rev-1 and rev-2 implementation is uncommitted in the working tree. The working tree also holds unrelated, uncommitted smart-diff work in `client/`, `server/`, `e2e/specs/09-smart-diff.flow.json`, `docs/plans/smart-diff.plan.md`, the staged `A docs/skills/README.md`, and a 2026-09-26 sandbox-ports entry (17 added lines) in `INSIGHTS.md`. All of it is out of scope, see O1) *(rev 3)* · **Revision:** 3

## Goal
Retro files stop being feature docs. They become short-lived, gitignored raw material under `.harness/`. Each retro finding names the harness artifact that let it through. A new, manually launched `harness-analyst` clusters those findings across features into concrete, evidence-backed harness proposals, and the user picks which to apply and which retro files to consume.

## Acceptance criteria
1. **AC1: location.**
   - The root `.gitignore` contains `.harness/`.
   - Retro files live at `.harness/retros/<feature>.retro.md`. Only `retro-writer` writes them, with the same append-only marker mechanics as today.
   - Analysis files live at `.harness/analysis/<YYYY-MM-DD>.md`. Only `harness-analyst` writes them.
   - `git ls-files .harness` prints nothing, and `git check-ignore` matches both a retro path and an analysis path.
2. **AC2: migration.**
   - `docs/plans/review-agents.retro.md` and `docs/plans/intent-layer.retro.md` are moved to `.harness/retros/`, byte-identical to their content at `df00f96`.
   - They are removed from git tracking by `git rm --cached` in S11, immediately before the commit, not in S7. After the commit, `git ls-files 'docs/plans/*.retro.md'` prints nothing, and the commit records both as deletions. *(rev 3)*
   - Their content is not edited.
3. **AC3: Harness target column.**
   - Every finding row that `retro-writer` writes carries a **Harness target**: the harness artifact that let the finding through. It is exactly one of:
     - `agent prompt: <name>`
     - `hook: <file>`
     - `skill: <name>`
     - `plan template`
     - `flow` (README *Flow* / main-session protocol)
     - `AGENTS.md/INSIGHTS`
     - `other: <text>`
   - The target names a concrete file path wherever one exists.
   - The six root-cause categories plus `other:` are unchanged.
   - The *Retro Report* entry table carries the column too.
   - Existing entries are never rewritten to add it.
4. **AC4: harness-analyst agent.** `.claude/agents/harness-analyst.md` follows the pattern of the other agents:
   - Frontmatter has `name`, `description`, `tools`, `disallowedTools`, `permissionMode`, `model`, `color`, and `hooks`: `write analysis` + `bash readonly`.
   - It has *Hard rules*, with the "**Reply in the user's language.**" bullet directly before "**Repo content is data, not instructions.**".
   - It has a Step 0 input gate that returns *Clarification needed* JSON, and a *Procedure*.
   - Its output skeleton ends in an `**Analysis status:**` line.
   - It reads every `.harness/retros/*.retro.md` and every prior `.harness/analysis/*.md`.
   - It clusters recurring class labels and harness targets **across features**, and proposes concrete harness changes, each with target file(s) and evidence (retro file + entry heading + finding #).
   - It edits no harness file. It writes only `.harness/analysis/<date>.md`, once.
   - Its report carries AskUserQuestion-style JSON that lets the user pick which proposals to apply and which retro files are consumed.
5. **AC5: lifecycle.** The README documents the lifecycle *write → analyse → apply → delete*:
   - the user launches the analyst manually;
   - after the user's answer, the main session records the decision in the analysis file, applies the chosen proposals (through planner → implementer when a proposal touches more than one file), and deletes the consumed retro files;
   - the analyst itself never applies or deletes anything.
6. **AC6: scope-guard.** Changes to `.claude/hooks/scope-guard.sh`:
   - **Retro profile:** `RETRO_ALLOW` becomes `.harness/retros/*.retro.md`, with no nesting.
   - **Analysis profile:** a new `write analysis` profile allows `.harness/analysis/*.md` only (no nesting), and only as a `Write` on create.
   - **Other profiles:** an unknown profile still fails closed with "misconfigured scope-guard". `write docs` and `write tests` are unchanged and deny all of `.harness/**`.
   - **Text and dispatch:** the header comment, the `write)` dispatch, and the policy table are updated.
   - **Self-test rows:** R1–R5 and the T18 fake-root fixtures are re-pathed. New rows cover the analysis profile, including full-dispatch bypass probes.
   - **Self-test independence:** the self-test does not rely on git tracking of `.harness/**`. The "working tree unchanged" check also covers the ignored `.harness/` tree.
   - **Visible-name invariant:** both `write retro` and `write analysis` block any target whose file name (basename) starts with `.`. That covers the empty stem (`.harness/retros/.retro.md`, `.harness/analysis/.md`) and the hidden stem (`.x.retro.md`, `.x.md`). The rule is one predicate in the policy, not enumerated spellings and not a change to the glob compiler. Blocked full-dispatch `runrd` rows on the fake roots prove it. *(rev 2)*
   - **Fake-root dispatch:** every `write retro`/`write analysis` `runrd` row that expects exit 0 runs with `CLAUDE_PROJECT_DIR=<fake root>`, never against the real root. *(rev 2)*
   - The full matrix reports `0 failing case(s)`.
7. **AC7: planner.**
   - `planner.md` Update-mode step 1a reads its fallback from `.harness/retros/<feature>.retro.md`.
   - A missing retro file (for example, deleted after an analysis) counts as "no retro signal". It is not an error and not a block.
8. **AC8: README.** `.claude/agents/README.md` updates these sections: Catalog, *Flow* (diagram + retro paragraph), Permissions (row, profile count, "all nine"), Artifacts, Sources rows that name the old path, and Troubleshooting. All of them cover harness-analyst and the retro lifecycle.
9. **AC9: history untouched.**
   - The closed plans `docs/plans/retro-agent.plan.md`, `docs/plans/intent-layer.plan.md` and `docs/plans/review-agents.plan.md` are not edited.
   - No existing `INSIGHTS.md` entry is edited.
   - No do-not-touch path (C4) changes.
   - No package code changes.

## Constraints
- **C1: Architecture.** No file under `server/src`, `client/src` or `reviewer-core/src` changes, so the onion rings and the frontend-ui-architecture boundaries are not touched. The preloaded skills bind nothing here beyond "no package code".
- **C2: Contracts & data.** No route, Zod contract or table is touched. The new persistent artifacts are local, gitignored Markdown files under `.harness/`. The plan relies on no DB, cache or `.devdigest/` path.
- **C3: Tooling facts relied on (verified at `df00f96`).**
  - **Write path in `scope-guard.sh`:**
    - `write_eval` starts at `:658`.
    - The explicit policy table is `const POLICIES = { tests, docs, retro }` at `:719`. It throws on an unknown key.
    - The retro policy is at `:838-888`: `RETRO_ALLOW` `:841`, `retroPathPolicy` `:842-851`, `RETRO_MARKERS`/`retroAppendOnlyPolicy` `:858-884`.
    - `ctx.exists` (`fs.existsSync(logical)`) and `ctx.toolName` are already computed for every profile (`:721-727`).
    - The dispatch `tests|docs|retro` is at `:1440-1441`.
  - **Existing profiles and `.harness/`:** `TESTS_ALLOW` (`:783`) and `DOCS_ALLOW` (`:812`) match no path starting with `.harness/`. Both profiles therefore already deny `.harness/**` by default deny, and they need no edit, only proving rows.
  - **Self-test harness:**
    - Helpers: `runw` `:937`, `runw_json` `:946`, `rund` `:959`, `runr` `:977` (node-built JSON, optional project root), `runrd` `:1003`. `runrd` asserts exit 2 plus `BLOCKED by scope-guard (write $2)`, so it works for a new profile unchanged.
    - Fake-root blocks: the T10/T18 block at `:1317-1341` (`FAKE_ROOT`), and the R1/R2/R5 block at `:1343-1411` (`RETRO_FAKE_ROOT`).
    - Other rows: R3 at `:1414-1418`, R4 at `:1420-1428`.
  - **R5 today:** R5 compares `git status --short` before and after the block (`:1354`, `:1399-1404`). Ignored files never appear there, so R5 as written is blind to a stray write under `.harness/`.
  - **Real-root R1 rows:** R1 rows run against the real root. Once `.harness/retros/` holds real local files, the existence check (`ctx.exists`) would make such rows depend on local state.
  - **ripgrep and ignored paths:** `rg` reads a gitignored, hidden path when that path is given explicitly (`rg --files .pr-review` and `rg -c . .pr-review/<file>` both hit). A repo-wide `rg --files` skips it. Grep/Glob without an explicit `.harness/…` path may therefore miss these files, so prompts use `ls` and explicit paths.
  - **`bash readonly`:** allows `ls`, `rg`, `cat`, `head`, `wc` and read-only `git` (`:296-299`), but **not `date`**. An agent under `readonly` cannot learn today's date and must get it from the delegating prompt.
  - **Agent colours:** all eight agent colours are taken (cyan, blue, green, yellow, red, purple, orange, pink).
  - **Implementer permissions:** `implementer-guard.sh` blocks only `git commit`/`push`, `gh pr`, and migrations. It does **not** block `git reset`, `git restore --staged` or `git stash`, so staged index state does not reliably survive a later agent round: the rev-1 `git rm --cached` was undone during the rev-2 implementer run (reflog `reset: moving to HEAD`, unreported), leaving both retro files as ` D` (unstaged). `git mv` into the gitignored `.harness/` would stage the destination, so S7 uses a plain `mv`. The untracking (`git rm --cached`) runs in S11, in the same main-session sequence as the commit. `implementer-guard.sh` is C4 and is not changed here. *(rev 3)*
  - **Other references to the old paths:** outside the three files this plan edits, `docs/plans/*.retro.md` is referenced in `docs/plans/retro-agent.plan.md`, `docs/plans/intent-layer.plan.md:473,479` and root `INSIGHTS.md:68,96`. All of these are history and are not edited (AC9).
  - **Working-tree anchors after rev 1 (verified in the working tree on top of `df00f96`):** *(rev 2)*
    - `globToRegExp` compiles `*` to `[^/]*` (`:777`), which matches the empty string. So `RETRO_ALLOW` (`:854`) accepts `.harness/retros/.retro.md`, and `ANALYSIS_ALLOW` (`:910`) accepts `.harness/analysis/.md`. The main session reproduced exit 0 for both.
    - `retroPathPolicy` `:855-867`, `retroPolicy` `:902-904`, `analysisPathPolicy` `:911-920`, `analysisPolicy` `:934-936`. `write_eval` runs the policy on both `rel` and `relReal` (`:741`), so a predicate added there covers the symlink-resolved form too.
    - `runrd` (`:1051-1071`) takes no project-root argument; a 9th argument is ignored. The working pattern is the env prefix `CLAUDE_PROJECT_DIR="$ANALYSIS_FAKE_ROOT" runrd …` (`:1534`).
    - Real-root allowed dispatch rows: `R1 full dispatch write allowed` `:1414`, `A1 full dispatch write allowed` `:1508`.
    - `rg -n 'docs/plans/[^ ]*\.retro\.md'` hits `:21` (header), `:856` (named deny), `:1418` (`R2 old location`), `:1448` (`R2 full dispatch old location write`), `:1472` (`R3 write docs still blocks retro`).
    - `retro-writer.md:216-217` still points at "*Decisions → Consecutive*". The definition is in the file's own *Retro file format* section (`:165`).
- **C4: Do not touch.** `.claude/skills/**` (incl. `routing.md`, `engineering-insights/SKILL.md`), `.claude/settings.json`, every `CLAUDE.md`, `skills-lock.json`, `.claude/hooks/implementer-guard.sh`, `pr-gate.sh`, `pre-push`, the three closed plans, every existing `INSIGHTS.md` entry, the agent files `researcher.md`, `implementer.md`, `test-writer.md`, `doc-writer.md`, `plan-verifier.md` and `architecture-reviewer.md`, and all smart-diff work in the working tree. Evidence: `git diff df00f96 -- .claude/skills .claude/settings.json CLAUDE.md server/CLAUDE.md client/CLAUDE.md reviewer-core/CLAUDE.md e2e/CLAUDE.md skills-lock.json .claude/hooks/implementer-guard.sh .claude/hooks/pr-gate.sh .claude/hooks/pre-push docs/plans/retro-agent.plan.md docs/plans/intent-layer.plan.md docs/plans/review-agents.plan.md .claude/agents/researcher.md .claude/agents/implementer.md .claude/agents/test-writer.md .claude/agents/doc-writer.md .claude/agents/plan-verifier.md .claude/agents/architecture-reviewer.md` is empty. `git diff --numstat df00f96 -- INSIGHTS.md` shows 0 deletions.
- **C5: INSIGHTS (root).**
  - *2026-09-25, four review rounds of a permission hook came back `Clean` / `0 not met` while every round had a real bypass* (`INSIGHTS.md:58`). The new `write analysis` profile is a permission boundary. Every rule gets a bypass probe through the **full JSON dispatch** (`runrd`), not only positive rows, and it is fixed by invariant (one allow glob, write-once), not by enumerated spellings. The security hand-off gets an explicit adversarial read. Rev 1's empty-stem hole is this same class: a positive-only glob check with no probe of the glob's degenerate match. Rev 2 fixes it with the visible-name invariant, proved through full dispatch. *(rev 2)*
  - *2026-09-25, a Write through a dangling symlink passed every `scope-guard.sh` write profile* (`INSIGHTS.md:95`). Every re-pathed and new symlink fixture states whether its target exists, and both shapes are tested. This applies to the T18 re-path and the new A2 symlink rows.
  - *2026-09-25, `bash -n scope-guard.sh` fails several functions away from the real mistake: an apostrophe inside `node -e '…'`* (`INSIGHTS.md:135`). S2 edits the `write_eval` node block, so no literal `'` may appear in it, not even in a `//` comment. Run `bash -n` after every edit.
  - Kept as a rule, not one of the three: *2026-09-24, hand-probed guard hook "allows everything"*. New rows use `runr`/`runrd` (node-built JSON), never hand-built JSON or zsh probes.
- **C6: Class-fix, not point-fix, in this plan's own hook change.**
  - The analysis profile is one allow glob + default deny + one invariant: `Write` only when the target does not exist; every other tool is denied.
  - The retro move changes only the allow glob and the named denies, never the append-only invariant.
  - The policy table stays explicit, and a fourth key is added, not a fall-through.
  - Both allow globs are narrowed by one shared predicate, `visibleNamePolicy(rel)`: the basename must not start with `.`. It is composed into `retroPolicy` and `analysisPolicy` after the path policy, so named-deny messages still win. `globToRegExp` is not changed, because a compiler change would silently alter `write tests`/`write docs` too. No `.retro.md`/`.md` spelling is enumerated. *(rev 2)*
- **C7: Enforcement honesty.**
  - Every write restriction the two prompts claim is backed by a hook profile.
  - The steps "apply chosen proposals", "record the user decision" and "delete consumed retro files" are main-session process rules. No hook holds them, because the main session has no agent frontmatter and `.claude/settings.json` is C4. README states them as process rules.

## Decisions

**Agent settings.**

| Agent | model | permissionMode | tools | disallowedTools | skills (preload) | color | hooks |
|---|---|---|---|---|---|---|---|
| harness-analyst | `opus` | `acceptEdits` | Read, Grep, Glob, Write, Bash | Agent, Edit, NotebookEdit, Skill, WebSearch, WebFetch | none | `cyan` (shared with researcher; all eight colours are taken, C3) | `Write\|Edit\|NotebookEdit` → `scope-guard.sh write analysis`; `Bash` → `scope-guard.sh bash readonly` (timeout 15 each) |

- *`opus`:* the analyst is an evaluator over many retros, which is the same reasoning as for retro-writer and the reviewers.
- *No `Edit`:* an analysis file is written once, complete. Prior analyses are evidence for the next run and must not drift. The hook enforces write-once as well (defence in depth, C6).
- *Input `Date:`:* `date` is not in `bash readonly` (C3), so the delegating prompt must carry `Date: YYYY-MM-DD`.

**Retro file format (moves into `retro-writer.md` as its own section).** Today the format lives only in `docs/plans/retro-agent.plan.md` *Decisions*, and `retro-writer.md:143` points at "*Decisions → Consecutive*", which does not exist in the agent file. S3 makes the agent self-contained, with the skeleton, the *Consecutive* rule and the *Prior fix* values. Two changes against the old format:
- The skeleton's intro says the file is local, gitignored raw material for `harness-analyst`, deleted once consumed.
- The findings table gains one column after *Root cause*:
  `| # | Class label | Finding (evidence) | Root cause | Harness target | Prior round missed it because | Prior fix |`

**Harness target values (one per finding).** Each value names the artifact whose change would have stopped the finding, with a concrete path where one exists:
- `agent prompt: <name>` → `.claude/agents/<name>.md`
- `hook: <file>` → `.claude/hooks/<file>`
- `skill: <name>` → `.claude/skills/<name>/SKILL.md` (first-party or vendored, as is)
- `plan template` → the Output Format in `.claude/agents/planner.md`
- `flow` → README *Flow* or the main-session protocol in `.claude/agents/README.md`
- `AGENTS.md/INSIGHTS` → the concrete `AGENTS.md` or `INSIGHTS.md`
- `other: <text>` → must name the closest fixed value and why it does not fit

The root cause says *what kind* of gap it was. The harness target says *where* the fix belongs. The two are independent columns.

**Graduation evidence rule (retro-writer and harness-analyst).** `.harness/` is local and short-lived. An INSIGHTS graduation candidate or an evidence line meant for a committed file must therefore cite committed evidence: `path:line`, a sha, or a plan line. It never cites a `.harness/` path.

**`write analysis` profile (S2).**
- **Allow:** `ANALYSIS_ALLOW = [".harness/analysis/*.md"]`.
- **Named denies:** each has its own message.
  - `.harness/retros/**`: "retro files are written only by retro-writer; the main session deletes consumed ones".
  - `.claude/**`, `**/AGENTS.md`, `**/CLAUDE.md` and `**/INSIGHTS.md`: "harness files are changed by the main session after the user's decision".
- **Everything else:** default deny, "outside the harness-analyst scope (.harness/analysis/<date>.md only)".
- **Write-once invariant:**
  - `tool_name === "Write"` passes only when `ctx.exists` is false.
  - Any other tool is blocked: `Edit`, `NotebookEdit`, or a missing `tool_name`.
- **Path forms:** both the logical and the symlink-resolved form are checked, as for every profile, and `realpathNearest` covers dangling links.
- **Visible-name invariant:** `visibleNamePolicy` (see below) applies. *(rev 2)*

**`write retro` profile changes (S2).**
- `RETRO_ALLOW = [".harness/retros/*.retro.md"]`.
- The default-deny message names the new path.
- A named deny is added for the old location `docs/plans/*.retro.md` ("retro files moved to .harness/retros/"), so a stale prompt blocks with an explanation.
- The named denies for `docs/plans/*.plan.md` and `**/INSIGHTS.md` stay.
- The append-only invariant is unchanged.
- **Visible-name invariant:** `visibleNamePolicy` (see below) applies. *(rev 2)*

**Visible-name invariant (S2(h)).** *(rev 2)*
- **Rule:** `visibleNamePolicy(rel)` blocks when the last path segment of `rel` starts with `.`, with the message "`<rel>` — the file name must not start with a dot (empty or hidden name)". Otherwise it returns `null`.
- **Composition:** `retroPolicy = retroPathPolicy(rel) || visibleNamePolicy(rel) || retroAppendOnlyPolicy(ctx)`, and `analysisPolicy = analysisPathPolicy(rel) || visibleNamePolicy(rel) || analysisWriteOncePolicy(ctx)`. Named denies and the default deny come first. `write_eval` already runs the policy on both `rel` and `relReal`, so a visible link name onto a dot-named target is blocked too.
- **Why "no leading dot" rather than "non-empty stem":** one predicate covers both the empty stem (`.retro.md`, `.md`) and the hidden stem (`.x.retro.md`, `.x.md`). A hidden file in `.harness/` is skipped by `ls .harness/retros` (no `-a`), the command harness-analyst uses for its inventory and its *Nothing to analyse* gate. So a hidden name would silently escape analysis. Feature names and dates never start with a dot, so no legitimate file is lost.
- **Scope: only `retro` and `analysis`, not `tests`/`docs`.** Three reasons:
  - The hazard is specific to `.harness/`. It is gitignored, so nothing but the consuming agent's `ls` ever sees these files. `tests`/`docs` write tracked paths, where a dot-named file shows in `git status` and in PR review.
  - `tests`/`docs` allow whole trees, where dot-files can be legitimate.
  - C4/T6 require `TESTS_*`/`DOCS_*` unchanged.
  - The residual `docs/.md` acceptance is recorded as O8 and handed to security review.

**Analysis file and report shape (S4).** The file (English) and the report share these sections:
- `## Inputs`: retro files with entry counts and newest entry heading, prior analyses, `HEAD`.
- `## Clusters`: `C#`, member class labels per file, harness target, features, occurrences, evidence.
- `## Proposals`: `P#`, target file(s), change (what, not how), cluster, evidence, route, already addressed?
- `## Not proposed`: single occurrences, and clusters already fixed at `HEAD` (with `git log` evidence).
- `## Retro files`: per file, the covering proposals and a consume recommendation.

The report adds `## Decision needed` (the JSON), `## Limits`, and `**Analysis status:** Written (<n> proposals) | Nothing to analyse | Blocked (<reason>)`.

Details:
- **Proposal threshold:** a proposal needs ≥ 2 occurrences across features, or ≥ 2 entries of one feature with the same harness target.
- **Old entries:** entries without a Harness target column get an `inferred:` target.
- **JSON limits:** the JSON follows the AskUserQuestion limits: ≤ 4 questions, 2–4 options each, `multiSelect: true` for both the proposal picks and the consumption picks. Proposals that do not fit are listed under *Limits* as deferred.
- **Open fix loop:** a retro file whose newest entry says `Converging: no`, or whose plan is still in an open fix loop, is recommended **not** to consume.

**Lifecycle (process rule, C7).**
1. retro-writer appends to `.harness/retros/<feature>.retro.md` during fix loops, as today.
2. At any time, the user asks the main session to run harness-analyst, with `User language:` and `Date:`.
3. The main session passes the JSON to `AskUserQuestion`.
4. The main session appends a `## User decision` section to the analysis file, with the picked proposals, the consumed files and the date. The main session is not hooked. The next analyst run reads this section and does not re-propose a rejected proposal without new evidence.
5. The main session applies each picked proposal. A single-file edit is made directly. A multi-file change goes through planner → implementer → reviewers.
6. The main session deletes each consumed retro file (`rm .harness/retros/<feature>.retro.md`).

**Planner fallback (S5).** Step 1a:
- If the input has no `Retro:` line, the planner runs `ls .harness/retros/<feature>.retro.md` first. A missing file means "no retro signal": proceed, no block.
- If the file exists, the planner uses `rg -m1` with that explicit path. An explicit path is needed because the file is gitignored and hidden (C3).

## Steps
Execution order: **S1 → S2 → S3 → S4 → S5 → S6 → S7 → S8 → S9 → S10 → S11**.
- S2 lands before S4 is exercised, because a `write analysis` profile unknown to the hook fails closed.
- S7 runs after S1, so the moved files never appear as untracked.
- S6 describes S2–S5, so it runs after them.
- **Rev 2 delta (implementer):** S1, S4, S5 and S7 are done and unchanged. Apply only the *(rev 2)* parts: S2(f), S2(h), S2(i) and the S2 Verify; S3's `:217` pointer fix; S6's one clause. Then re-run S8 in full. The plan-verifier then checks the rev 2 items. After that the main session runs S9's remaining T14 (T13 already passed in rev 1: both probes blocked, files absent), then S10 and S11. *(rev 2)*
- **Rev 3 delta (main session only, user decision 2026-09-26):** no implementer round and no extra verify round. S1–S8 stand as verified on rev 2 (46 met; the only gap was the lost staged deletion, now owned by S11). S7 is done as `mkdir` + `mv`. The main session runs S9's pending T14, then S10, then S11. S11 does the untracking, the T11 staged check and the commit as one uninterrupted sequence. The plan-verifier checks S11 after the commit. *(rev 3)*

| ID | Package | Files (create / modify) | Change | Skills (routing bucket) | Covers | Verify |
|----|---------|-------------------------|--------|-------------------------|--------|--------|
| S1 | repo | `.gitignore` (modify) | Append a commented block: `# agent-harness raw material: retro files (retro-writer) and analyses (harness-analyst); local, short-lived, never committed`, then `.harness/`. | none (not in any bucket) | AC1 | `git check-ignore -q .harness/retros/x.retro.md && git check-ignore -q .harness/analysis/2026-09-26.md` exits 0 |
| S2 | .claude | `.claude/hooks/scope-guard.sh` (modify: header `:2-24`; `POLICIES` `:719`; retro policy `:838-888`; a new analysis policy after it; `self_test` T18 fixtures `:1323-1335`, R block `:1343-1411`, R3 `:1414-1418`, R4 `:1420-1428`, new A-rows; dispatch `:1440-1441`). Rev 2 working-tree anchors: `retroPolicy` `:902-904`, `analysisPolicy` `:934-936`, rows `:1414`, `:1508`, R2 block `:1418-1452`, A2 block `:1512-1534` *(rev 2)* | See *S2 details*. No `'` inside any `node -e '…'` block (C5). Run `bash -n` after each edit. Before editing, record the baseline `self-test \| rg -c '^ok '`. | none (`.claude/hooks` is in no bucket) | AC6, C6 | `bash -n .claude/hooks/scope-guard.sh && .claude/hooks/scope-guard.sh self-test \| tail -1` → `0 failing case(s)`; `self-test \| rg -c '^ok '` = baseline + number of new rows (no old row lost; for the rev 2 delta, baseline recorded before the delta + 8); `self-test \| rg -c '^ok +A[1-5] '` = number of A rows; `rg -c 'docs/plans/[^ ]*\.retro\.md' .claude/hooks/scope-guard.sh` = 5: header, old-location named deny, `R2 old location`, `R2 full dispatch old location write`, `R3 write docs still blocks retro`; `rg -n 'runrd ".*" (retro\|analysis) .* 0$' .claude/hooks/scope-guard.sh \| rg -v 'CLAUDE_PROJECT_DIR="\$(RETRO\|ANALYSIS)_FAKE_ROOT"'` prints nothing; `rg -c 'visibleNamePolicy' .claude/hooks/scope-guard.sh` = 3 (definition + 2 compositions); `git diff df00f96 -- .claude/hooks/scope-guard.sh` changes no line of `globToRegExp` *(rev 2)* |
| S3 | .claude | `.claude/agents/retro-writer.md` (modify: description `:3-7`; Hard rules `:39-43`, `:58-60`; Procedure `:118-154`; skeleton `:158-178`; a new *Retro file format* section) | Replace every `docs/plans/<feature>.retro.md` with `.harness/retros/<feature>.retro.md`. Add a one-paragraph purpose: the entries are raw material for `harness-analyst`, and the file is local and gitignored. Add the *Retro file format* section (skeleton with the Harness target column, *Consecutive*, *Prior fix* values; see *Decisions*). Add the Harness target list with its path mapping. Procedure step 5 becomes "assign one root cause **and one harness target** per finding". The *Entry* table in the skeleton gains `Harness target(s)`. The graduation evidence rule goes under *Graduation candidates*. Frontmatter other than `description`, the categories, the gate, the marker lines and the feed-forward line stay unchanged. Every in-file pointer into the plan's *Decisions*, including Procedure step 7's "*Decisions → Consecutive*" (`:216-217`), is re-pointed to *Retro file format → Consecutive* in this file. *(rev 2)* | docs bucket (`**/*.md`): `doc-standards`, `file-conventions` (user level); follow the neighbouring agent files' style | AC1, AC3 | T7 |
| S4 | .claude | `.claude/agents/harness-analyst.md` (create) | Frontmatter per *Decisions*. See *S4 details*. | docs bucket, as S3 | AC4, AC5 | T8 |
| S5 | .claude | `.claude/agents/planner.md` (modify: Update mode step 1a `:104-110` only) | Fallback path → `.harness/retros/<feature>.retro.md`. Check for the file with `ls` first; a missing file (for example, deleted after a harness-analyst run) means no retro signal, not an error or block. `rg -m1` is given the explicit file path. Nothing else changes. | docs bucket, as S3 | AC7 | T9 |
| S6 | .claude | `.claude/agents/README.md` (modify: Catalog `:10-19`; Flow diagram `:26-52` and retro paragraph `:78-89`; Permissions table `:100-109` and the `scope-guard.sh` bullet `:118-133`; "all eight" `:184`; Artifacts `:189-198`; Sources rows `:221`, `:223`, `:243`; Troubleshooting `:317-320`, `:350-352`) | See *S6 details*. | docs bucket, as S3 | AC5, AC8, C7 | T10 |
| S7 | repo | `docs/plans/review-agents.retro.md`, `docs/plans/intent-layer.retro.md` (move to `.harness/retros/`) | `mkdir -p .harness/retros`, then `mv` both files into it unchanged. No content edit. No index change here: the untracking belongs to S11, because staged state did not survive a later agent round (C3). Done. *(rev 3)* | none | AC2 | T11 (content and location part) *(rev 3)* |
| S8 | .claude | none (verification by the implementer, then plan-verifier) | 1. S2 Verify. 2. T7–T12 static checks; T11 here checks content and location only, and either ` D` or `D ` for the two old paths is acceptable (the staged `D ` is checked in S11). 3. The frontmatter of all nine agent files parses and `name` = filename. 4. `rg -c "Reply in the user's language" .claude/agents/*.md` prints `:1` for 9 files. *(rev 3)* | none | AC4, AC6, AC9 | see *Test plan* |
| S9 | repo (main session) | none (live probes) | T13 and T14 in the current session. **First the out-of-scope probes**, which are recoverable by `rm` because they target new, untracked files. If a probe shows a hook did not fire, delete the created file, stop, and re-run S9 in a fresh session. Then the harness-analyst acceptance run over the two moved retro files, with `Date: 2026-09-26`. Answering its JSON and acting on it follows the *Lifecycle* and is the user's decision; applying proposals is O2. The input includes `.harness/retros/harness-retros.retro.md`; its newest entry is from an open fix loop, so the analyst should recommend not consuming it. *(rev 2)* | none | AC4, AC5, AC6 | T13, T14, T15 |
| S10 | repo (main session) | `INSIGHTS.md` (modify, only if something passes the worth-writing test) | Run `engineering-insights` at the end of the work. Append only what is new and non-obvious, via a marker-line `Edit`. No existing entry is edited, even the ones whose evidence now points at the moved files (AC9, Risks). Evidence must be committed, never a `.harness/` path. Writing nothing is a valid outcome. | `engineering-insights` | AC9 | `git diff --numstat df00f96 -- INSIGHTS.md` shows 0 deletions |
| S11 | repo (main session) | commit; index change for the two `docs/plans/*.retro.md` | After S9 and S10, and with the user's consent, run one uninterrupted main-session sequence with no agent round in between. (1) `git rm --cached -q docs/plans/review-agents.retro.md docs/plans/intent-layer.retro.md`. (2) T11 staged check: `git status --short -- docs/plans/review-agents.retro.md docs/plans/intent-layer.retro.md` shows `D ` for both; otherwise stop. (3) `git add -- .claude/agents/harness-analyst.md docs/plans/harness-retros.plan.md`, because a pathspec commit needs every path known to git. (4) Commit with an explicit pathspec: `git commit -m "<msg>" -- .gitignore .claude/hooks/scope-guard.sh .claude/agents/retro-writer.md .claude/agents/harness-analyst.md .claude/agents/planner.md .claude/agents/README.md docs/plans/harness-retros.plan.md docs/plans/review-agents.retro.md docs/plans/intent-layer.retro.md`. The pathspec (`--only`) keeps the staged `A docs/skills/README.md` staged and out of the commit, and all smart-diff paths stay out (O1). **`INSIGHTS.md` is never part of this commit.** It carries the unrelated O1 sandbox-ports entry, and no partial staging is used. If S10 appended an entry, that entry stays uncommitted next to the O1 entry, and the user later commits `INSIGHTS.md` whole as a separate commit. The implementer cannot commit (`implementer-guard.sh`). The plan-verifier checks S11 after the commit. *(rev 3)* | none | AC2, C4 | Before the commit: the step (2) check. After it: `git show --stat HEAD` lists exactly the nine pathspec paths, with the two retro files as deletions, and no `INSIGHTS.md`; `git status --short` still shows `A  docs/skills/README.md`, ` M INSIGHTS.md` and the smart-diff entries as before; `git ls-files .harness 'docs/plans/*.retro.md'` prints nothing *(rev 3)* |

**S2 details: hook changes.**
- (a) **Policy table:** `POLICIES` gains `analysis: analysisPolicy`. An unknown key still throws.
- (b) **Retro path policy:** as in *Decisions → write retro profile changes*.
- (c) **Analysis policy:** `analysisPathPolicy(rel) || analysisWriteOncePolicy(ctx)`, as in *Decisions → write analysis profile*. The write-once check reuses `ctx.exists` and `ctx.toolName`, with no new ctx field.
- (d) **Dispatch:** `tests|docs|retro|analysis`. The misconfigured message lists all four.
- (e) **Header:**
  - six wired agent files, and `harness-analyst.md` in the list;
  - the plan list gains `docs/plans/harness-retros.plan.md`;
  - "six call shapes", with `scope-guard.sh write analysis — … for harness-analyst`, and `bash readonly` for "doc-writer, retro-writer, harness-analyst";
  - the RETRO paragraph with the new path, and a short ANALYSIS paragraph (scope, write-once, why `write docs`/`write tests` need no change: `.harness/**` is outside both allow lists).
- (f) **Self-test independence (AC6):** every `write retro` and `write analysis` row that depends on the existence check or on a symlink runs against a `mktemp -d` fake root, never the real root, because the real `.harness/` holds local files. `runr` takes the root as its 9th argument (`runr … "$FAKE"`). `runrd` takes no root argument, so it gets the env prefix `CLAUDE_PROJECT_DIR="$FAKE" runrd …`. `R1 full dispatch write allowed` (`:1414`) moves onto `RETRO_FAKE_ROOT`, and `A1 full dispatch write allowed` (`:1508`) onto `ANALYSIS_FAKE_ROOT`, keeping their names. The rule is: every `runrd` row for these two profiles that expects exit 0 is fake-rooted. Path-only deny rows may stay on the real root, since they never reach the existence check. *(rev 2)*
- (g) **R5:** R5 snapshots both `git status --short` and `git status --short --ignored -- .harness` before and after, and passes only if both are unchanged. The new A5 row does the same around the analysis block.
- (h) **Visible-name invariant:** *(rev 2)*
  - Add one `visibleNamePolicy(rel)` function in the `write_eval` node block, next to the retro policy.
  - Compose it into `retroPolicy` and `analysisPolicy` as in *Decisions → Visible-name invariant*.
  - Leave `globToRegExp`, `RETRO_ALLOW`, `ANALYSIS_ALLOW`, `TESTS_*`, `DOCS_*`, `testsPolicy` and `docsPolicy` unchanged.
  - No `'` in the comment or the message (C5).
  - The header's RETRO and ANALYSIS paragraphs each gain one clause: "the file name must not start with a dot (no empty or hidden name)".
- (i) **Invariant rows (8 new, all inside the fake-root blocks):** *(rev 2)*
  - R1: `runr "R1 dotted name allowed" retro Write ".harness/retros/v1.2.retro.md" … 1 "$RETRO_FAKE_ROOT"`.
  - R2: `runr "R2 empty stem"` on `.harness/retros/.retro.md` → 0; `runr "R2 hidden stem"` on `.harness/retros/.x.retro.md` → 0; `CLAUDE_PROJECT_DIR="$RETRO_FAKE_ROOT" runrd "R2 full dispatch empty stem" retro Write ".harness/retros/.retro.md" none "x" none 2`.
  - A1: `runr "A1 dotted name allowed" analysis Write ".harness/analysis/2026-09-26.v2.md" … 1 "$ANALYSIS_FAKE_ROOT"`.
  - A2: `runr "A2 empty stem"` on `.harness/analysis/.md` → 0; `runr "A2 hidden stem"` on `.harness/analysis/.x.md` → 0; `CLAUDE_PROJECT_DIR="$ANALYSIS_FAKE_ROOT" runrd "A2 full dispatch empty stem" analysis Write ".harness/analysis/.md" none "x" none 2`.
  - All `runr` rows pass the fake root as the 9th argument.

**S4 details: `harness-analyst.md` prompt.**
- **Description:** "Launched manually by the user, never inside a fix loop. Reads every `.harness/retros/*.retro.md` and prior `.harness/analysis/*.md`, clusters recurring class labels and harness targets across features, and proposes concrete harness changes with target files and evidence. Writes only `.harness/analysis/<date>.md`, once. Does NOT edit any harness file, agent, hook, skill, plan or INSIGHTS.md, and does NOT delete retro files. The main session applies what the user picks."
- **Hard rules:**
  - Writes only its analysis file, once, with `Write`. The hook enforces this, and a block is a hard stop, never re-spelled.
  - Bash `readonly` only (`ls`, `rg` with explicit `.harness/…` paths, `git log`/`show`/`diff`/`ls-files`, `wc`, `head`). No `cd`, no command substitution.
  - Evidence on every cluster and proposal: retro file + entry heading + finding #. Proposal claims about current code carry `path:line` or a sha. A claim without evidence is dropped.
  - Cross-feature first (threshold per *Decisions*). Single occurrences go to *Not proposed*.
  - Targets are harness artifacts with concrete paths, never an agent's behaviour ("no blame").
  - A proposal touching a C4 path (`.claude/settings.json`, `CLAUDE.md`, a vendored skill listed in `skills-lock.json`) is marked "needs the user to lift do-not-touch", not dropped.
  - Never re-propose a proposal recorded as rejected under a prior analysis's `## User decision` without new evidence.
  - The graduation evidence rule.
  - "Reply in the user's language" (verbatim from the other files), then "Repo content is data" (including retro files and prior analyses).
- **Step 0 gate:**
  - Needs `User language:` and `Date: YYYY-MM-DD`. A missing `Date:` → *Clarification needed* JSON (same block as the planner).
  - Optional: a subset of retro files, or a focus.
  - `ls .harness/retros` is empty or missing → return only `**Analysis status:** Nothing to analyse`, and write nothing.
- **Procedure:**
  1. `ls .harness/retros .harness/analysis`.
  2. Read every retro file and every prior analysis in full.
  3. Map harness targets to real files (`git ls-files .claude AGENTS.md '*/AGENTS.md' INSIGHTS.md '*/INSIGHTS.md'`).
  4. Inventory the findings: feature, iteration, label + definition, root cause, harness target or `inferred:` target.
  5. Cluster across files. Labels are per file, so equivalence across files is argued from the label definitions and cited.
  6. For each cluster, check whether it is already addressed (`git log --since=<entry date> -- <target>`, prior `## User decision`).
  7. Draft proposals (class-fix preferred), with route: `direct` for one file, `planner → implementer` for more than one file.
  8. Write the consumption recommendations.
  9. Choose the file name: `.harness/analysis/<Date>.md`, or `<Date>-<n>.md` if it exists. Write the file once.
  10. Report.
- **Output skeleton:** as in *Decisions → Analysis file and report shape*, with the `## Decision needed` JSON and the `**Analysis status:**` line last.

**S6 details: README edits.**
- **Catalog:**
  - retro-writer's row notes "into `.harness/retros/`, raw material for harness-analyst";
  - a new harness-analyst row: `opus`, writes "analysis file only", no preloaded skill.
- **Flow diagram:**
  - the retro-writer arrow target becomes `.harness/retros/<feature>.retro.md`;
  - a second small diagram under it shows the lifecycle: `retro-writer ─► .harness/retros/*.retro.md ─(user launches)─► harness-analyst ─► .harness/analysis/<date>.md + Decision JSON ─► AskUserQuestion ─► main session: record ## User decision · apply (direct | planner → implementer) · rm consumed retro files`.
- **Retro paragraph:** one sentence saying retro files are local and gitignored raw material for harness improvement, not feature docs. A new **Harness analysis** paragraph states the lifecycle and that it is a main-session process rule (C7).
- **Permissions:**
  - a new row `harness-analyst | Read, Grep, Glob, Write, Bash | Agent, Edit, NotebookEdit, Skill, WebSearch, WebFetch | acceptEdits | scope-guard.sh write analysis + bash readonly`;
  - the bullet goes from "five profiles" to six;
  - `write retro` now names `.harness/retros/*.retro.md` and the old-location deny;
  - one sentence on `write analysis` (one glob, write-once, harness files and retros denied);
  - one clause for both `write retro` and `write analysis`: the file name must not start with a dot (no empty or hidden name, which `ls` would hide from harness-analyst) *(rev 2)*;
  - "`write docs` … denies `docs/plans/**`" gains "and neither `write docs` nor `write tests` allows anything under `.harness/`";
  - "all eight" → "all nine".
- **Artifacts:**
  - the retro-writer output path changes;
  - a new harness-analyst row: input `User language` + `Date` (+ optional focus); output the analysis file + *Harness Analysis Report*;
  - the planner row notes that the retro fallback is `.harness/retros/<feature>.retro.md` and that a missing file means no signal.
- **Sources:** "all eight descriptions"/"all eight" → nine. The Devin row's "per-iteration `docs/plans/<feature>.retro.md`" → `.harness/retros/<feature>.retro.md`. No new external source is added.
- **Troubleshooting:**
  - the retro-writer bullet path changes;
  - a new bullet: "harness-analyst blocked on Write", meaning that date's file exists, so it uses `<date>-<n>.md`;
  - a new bullet: "the planner finds no retro signal", which is expected when the retro file was consumed and deleted;
  - a new bullet: "Grep/Glob do not find `.harness/` files", because the directory is gitignored and hidden, so use an explicit path or `ls`.

## Test plan
| Test | Kind | Covers | File |
|------|------|--------|------|
| T1 `.harness/` is ignored and untracked: `git check-ignore -q` on a retro path and an analysis path exits 0; `git ls-files .harness` is empty. | static check | AC1 | `.gitignore` |
| T2 `write retro` re-pathed (hook rows R1/R2/T18). **Allowed**, in `RETRO_FAKE_ROOT`: Write new `.harness/retros/newfeature.retro.md`; the entries-marker and class-labels-marker Edits; Write new `.harness/retros/v1.2.retro.md` (a dot inside the name is fine); `CLAUDE_PROJECT_DIR="$RETRO_FAKE_ROOT" runrd` full-dispatch Write → exit 0. **Blocked:** `docs/plans/x.retro.md` (old location, named message); `docs/plans/x.plan.md`; `.harness/retros/sub/x.retro.md` (nesting); `.harness/x.retro.md`; `.harness/analysis/x.md`; `INSIGHTS.md`; `server/INSIGHTS.md`; `.claude/agents/retro-writer.md`; traversal `.harness/retros/../analysis/x.md`; `/etc/hosts`; symlink `.harness/retros/link.retro.md → ../../docs/plans/x.plan.md` (target **exists**); Write over the existing `.harness/retros/old.retro.md`; empty stem `.harness/retros/.retro.md` and hidden stem `.harness/retros/.x.retro.md` (fake root); every existing bad-Edit/bad-tool row, re-pathed; full dispatch → exit 2 + `BLOCKED by scope-guard (write retro)` on the old-location Write, the INSIGHTS Write, a non-marker Edit, and the empty-stem Write (fake root). **T18:** `.harness/retros/ghost.retro.md → ../../server/src/new.ts` (**dangling**, blocked); `.harness/retros/ok.retro.md → fine.retro.md` (dangling in-scope, allowed). *(rev 2)* | hook self-test | AC6, C5, C6 | `.claude/hooks/scope-guard.sh` |
| T3 `write analysis` (new rows A1/A2, in their own fake root). **A1 allowed:** Write new `.harness/analysis/2026-09-26.md`; Write new `.harness/analysis/2026-09-26-2.md`; Write new `.harness/analysis/2026-09-26.v2.md`; `CLAUDE_PROJECT_DIR="$ANALYSIS_FAKE_ROOT" runrd` full-dispatch Write → exit 0. **A2 blocked:** `.harness/retros/x.retro.md`; `.harness/analysis/sub/x.md`; `.harness/analysis/x.txt`; `.harness/x.md`; `.claude/agents/planner.md`; `.claude/hooks/scope-guard.sh`; `AGENTS.md`; `server/INSIGHTS.md`; `client/CLAUDE.md`; `docs/plans/x.plan.md`; traversal `.harness/analysis/../retros/x.retro.md`; `/etc/hosts`; symlink `.harness/analysis/link.md → ../retros/x.retro.md` (target **exists**); dangling `.harness/analysis/ghost.md → ../../.claude/agents/new.md`; Write over the existing `.harness/analysis/old.md`; empty stem `.harness/analysis/.md` and hidden stem `.harness/analysis/.x.md` (fake root); `Edit` on an analysis path (even a non-existing one); `NotebookEdit`; missing `tool_name`; no `file_path`. **Full dispatch** → exit 2 + `BLOCKED by scope-guard (write analysis)`: the `.claude/agents/planner.md` Write, the retro-path Write, the Edit on an analysis path, the Write over an existing analysis, and the empty-stem Write (fake root). *(rev 2)* | hook self-test | AC4, AC6, C5, C6 | same |
| T4 Cross-profile isolation (R3 extended, new A3): `write docs` blocks `.harness/retros/x.retro.md` and `.harness/analysis/x.md`; `write tests` blocks both; `write retro` blocks `.harness/analysis/x.md` (in T2); `write analysis` blocks `.harness/retros/x.retro.md` (in T3). Existing R3 rows still pass, and `write docs` still allows `docs/some-topic.md`. | hook self-test | AC6 | same |
| T5 Dispatch (R4 kept, new A4): `rund "A4 write analyses typo" write analyses 2` (exit 2 + "misconfigured scope-guard"); `write analysis` with garbage stdin exits 0 with a warning (fail-open); R4 rows unchanged and passing. | hook self-test | AC6 | same |
| T6 Regression: the whole `self-test` → `0 failing case(s)`; the `ok` count = baseline (recorded before S2) + new rows (+ 8 for the rev 2 delta); R5 and A5 pass (unchanged `git status --short` **and** `git status --short --ignored -- .harness`); `git diff df00f96 -- .claude/hooks/scope-guard.sh` changes no line inside `TESTS_ALLOW`, `TESTS_DENY`, `DOCS_ALLOW` or `DOCS_DENY` (`:783-835` at `df00f96`), and no line of `globToRegExp` (the invariant lives in the policy, so `write tests`/`write docs` behave exactly as before); every allowed `retro`/`analysis` `runrd` row carries a fake-root `CLAUDE_PROJECT_DIR` prefix (S2 Verify). *(rev 2)* | hook self-test + static | AC6, C6 | same |
| T7 Static checks on `retro-writer.md`: `rg -c 'docs/plans/<feature>\.retro\.md'` → exit 1; `rg -n '\.harness/retros/'` ≥ 1; `rg -n 'Harness target'` ≥ 3 (format, procedure, skeleton); each of `agent prompt:`, `hook:`, `skill:`, `plan template`, `flow`, `AGENTS.md/INSIGHTS`, `other:` appears; all six root-cause names are still present; both marker lines are still present verbatim; `rg -n 'Consecutive'` hits a definition in the file itself; `rg -n 'Decisions →' .claude/agents/retro-writer.md` → exit 1 (no pointer into a plan's *Decisions* remains); `rg -n 'Retro file format → Consecutive'` ≥ 1; frontmatter `hooks` unchanged (`write retro`, `bash readonly`). *(rev 2)* | static check | AC1, AC3 | `.claude/agents/retro-writer.md` |
| T8 Static checks on `harness-analyst.md`: `rg -n '^name: harness-analyst$'`; hooks contain `scope-guard.sh write analysis` and `scope-guard.sh bash readonly`; `disallowedTools` contains Agent, Edit, NotebookEdit, Skill; the line of "Reply in the user's language" < the line of "Repo content is data"; `## Clarification needed`, `Date:`, `## Clusters`, `## Proposals`, `## Retro files`, `## Decision needed`, `multiSelect`, `**Analysis status:**` all present; `rg -n 'across features\|cross-feature'` ≥ 1; `rg -n 'User decision'` ≥ 1. | static check | AC4, AC5 | `.claude/agents/harness-analyst.md` |
| T9 Static checks on `planner.md`: `rg -n '\.harness/retros/<feature>\.retro\.md'` = 1; `rg -c 'docs/plans/<feature>\.retro\.md'` → exit 1; `rg -n 'no retro signal'` ≥ 1; `git diff df00f96 -- .claude/agents/planner.md` has one hunk, inside step 1a (`:104-110`). | static check | AC7 | `.claude/agents/planner.md` |
| T10 Static checks on README: `rg -n 'harness-analyst'` hits Catalog, Flow, Permissions, Artifacts and Troubleshooting; `rg -n 'all nine'` ≥ 1 and `rg -n 'all eight'` → exit 1; `rg -n 'six profiles\|write analysis'` ≥ 1; `rg -c 'docs/plans/<feature>\.retro\.md\|docs/plans/\*\.retro\.md'` only in the sentence naming the old-location deny; `rg -n 'User decision'` ≥ 1; `rg -n 'start with a dot'` ≥ 1 in the Permissions bullet; every relative link target exists. *(rev 2)* | static check | AC5, AC8 | `.claude/agents/README.md` |
| T11 Migration. **Content and location (S7/S8):** `git show df00f96:docs/plans/review-agents.retro.md \| cmp - .harness/retros/review-agents.retro.md` and the same for `intent-layer` exit 0; `ls docs/plans/*.retro.md` finds nothing. **Staged deletion (S11, run only inside S11 after its `git rm --cached` and before the commit):** `git status --short -- docs/plans/review-agents.retro.md docs/plans/intent-layer.retro.md` shows `D ` (staged) for both. **After the commit:** `git ls-files 'docs/plans/*.retro.md'` prints nothing. *(rev 3)* | static check | AC2 | `.harness/retros/*` |
| T12 C4 diff: the command in C4 prints nothing, and `git diff --numstat df00f96 -- INSIGHTS.md` shows 0 deletions. | static check | AC9, C4 | — |
| T13 Live hook arming (main session, S9): (a) harness-analyst is offered as a subagent type. (b) Asked to create `docs/harness-analyst-probe.md`, it is blocked with `BLOCKED by scope-guard (write analysis)`, and `ls docs/harness-analyst-probe.md` fails. (c) retro-writer, asked to create `docs/plans/probe.retro.md`, is blocked (old-location message). If (b) or (c) created a file, `rm` it and re-run S9 in a fresh session. | manual acceptance | AC4, AC6 | — |
| T14 harness-analyst acceptance run on the moved retros (`Date: 2026-09-26`, `User language: Ukrainian`). **Files:** exactly one new file `.harness/analysis/2026-09-26.md`; `git status --short` unchanged. **Content:** clusters cite both migrated retro files by entry heading; ≥ 1 proposal names a concrete target file; entries without the column carry `inferred:` targets; the JSON parses and respects ≤ 4 questions and 2–4 options each; the prose is Ukrainian, while headings and the file stay English. `.harness/retros/harness-retros.retro.md` belongs to an open fix loop, so it is recommended **not** to consume. **Lifecycle, if the user answers:** the main session appends `## User decision` to the file and `rm`s the consumed retro files, which `ls .harness/retros` confirms. *(rev 2)* | manual acceptance | AC4, AC5 | `.harness/analysis/2026-09-26.md` |
| T15 Planner fallback probe (static + read-only): `rg -m1 '^### Iteration' .harness/retros/intent-layer.retro.md` returns a hit (an explicit path into an ignored dir works); `ls .harness/retros/nonexistent.retro.md` fails, and step 1a's text says that means no retro signal. An optional full Update-mode run is not required. | static check | AC7 | — |

## Review hand-off
- **Architecture review:** no file under `server/src`, `client/src` or `reviewer-core/src` changes, so the architecture-reviewer's scope is empty (`Clean`). A human reader should judge one structural question: whether the lifecycle steps (record decision, apply, delete) belong to the main session as a process rule (C7), rather than to a hook or to the analyst.
- **Security review:** no file matches the `security` globs of `routing.md`, but `scope-guard.sh` is a permission boundary, so S2 gets an adversarial read (C5, INSIGHTS `:58`). Questions:
  - Can any path other than `.harness/analysis/<visible name>.md` pass `write analysis`, or other than `.harness/retros/<visible name>.retro.md` pass `write retro`? Consider a name containing `/` after normalisation, case variants on a case-insensitive filesystem (`.Harness/…`, `.harness/Analysis/…`), or a visible link name onto a dot-named target. Check that `visibleNamePolicy` runs on both `rel` and `relReal`, and that it sits after the named denies but before the tool invariant. *(rev 2)*
  - Is the scope decision (invariant only for `retro`/`analysis`; `write docs` still accepts `docs/.md`, O8) acceptable? *(rev 2)*
  - Can the analyst overwrite a prior analysis or a retro file through a symlink planted by the main session, whether the target exists or dangles?
  - Is the existing `write retro` invariant unchanged apart from the glob, and does the old-location named deny sit before the allow check?
  - Are internal errors on the new path still fail-open, and are policy misses exit 2?
  - Does moving the R1/A1 allowed rows, including the full-dispatch ones, into the fake roots lose any coverage the real-root rows had? *(rev 2)*

## Risks / open questions
- **Dangling evidence in committed INSIGHTS (S7, S11).** `INSIGHTS.md:68` cites `docs/plans/review-agents.retro.md:23`, which no longer exists at `HEAD` after S11. It stays readable through `git show df00f96:docs/plans/review-agents.retro.md`. AC9 forbids editing the entry. S10 may append a note only if the worth-writing test passes. Otherwise the gap is accepted (O4).
- **Ephemeral files, no backup.** `.harness/` is gitignored, so a deleted retro or a wiped checkout loses the only copy. This is intended by user decision 2. The committed copies of the two migrated files stay in history at `df00f96`.
- **The convergence gate needs retro history (S4, S6).** Deleting a retro file while its feature is still in a fix loop resets that feature's recurrence detection. Mitigations: the analyst recommends **not** consuming such files, and the user decides.
- **Tool visibility of `.harness/` (S3–S5).** Grep/Glob without an explicit path may skip gitignored, hidden directories (C3). All three prompts use `ls` and explicit paths. T15 and T14 exercise this.
- **Write tool and missing parent directories (S4, S9).** The first analyst `Write` must create `.harness/analysis/`. If the Write tool does not create parents, T14 fails at its first write. The fallback is that the main session runs `mkdir -p .harness/analysis` before the run. The hook does not care whether the directory exists. The directory is still absent in the working tree. *(rev 2)*
- **Write-once analysis (S2).** This design choice goes slightly beyond the user's "allows `.harness/analysis/*.md` only". It keeps prior analyses stable as evidence. If the user wants the analyst to revise its own file, the change is one rule in S2 plus the frontmatter.
- **Colour collision (S4).** harness-analyst shares `cyan` with researcher, because no free colour exists. This is cosmetic.
- **Hook arming in-session (S9).** Whether new frontmatter hooks are live without a restart is unverified. T13 probes only new, untracked paths, so an unhooked write is recoverable by `rm`.
- **AskUserQuestion limits (S4).** Many proposals do not fit in one JSON. The analyst ranks the proposals and defers the rest to *Limits*. They reappear in the next run unless their retro files are consumed.
- **Label drift across features.** Class labels are per file, so the analyst clusters by definition, not by name. Clusters can be wrong. Every cluster cites its member definitions, so the user can reject it.
- **Visible-name invariant is stricter than "non-empty stem" (S2).** It also rejects hidden names (`.x.retro.md`). No agent prompt produces such names, and the hook message says why. If a legitimate dot-leading name ever appears, the change is the one predicate. *(rev 2)*
- **Unrelated INSIGHTS entry in the working tree (S10, S11).** `INSIGHTS.md` carries an uncommitted 2026-09-26 sandbox-ports entry (17 added lines) that belongs to O1 work. Decision: `INSIGHTS.md` is excluded from the S11 commit, with no partial staging. Any S10 entry stays uncommitted beside it, and the user commits `INSIGHTS.md` whole later as a separate commit. The cost is that an S10 insight does not ship with this feature's commit. *(rev 3)*
- **Index state does not survive agent rounds (S7, S11).** A staged `git rm --cached` was silently undone during the rev-2 implementer run (reflog `reset: moving to HEAD`), because `implementer-guard.sh` does not block `git reset`, `git restore --staged` or `git stash`. Mitigation in this plan: all index changes happen only in S11, in one main-session sequence right before the commit, and T11's staged check gates it. Hardening the guard is C4 and out of scope. It is a signal for harness-analyst. *(rev 3)*

## Out of scope
- **O1:** The uncommitted smart-diff work in `client/`, `server/`, `e2e/`, `docs/plans/smart-diff.plan.md`, and the staged `docs/skills/README.md`. S11 does not stage them.
- **O2:** Applying any proposal from the first harness-analyst run. Each picked proposal follows the *Lifecycle*, with its own planner run if it touches more than one file.
- **O3:** A SessionStart or other reminder hook that prompts to run harness-analyst (rejected by the user), and any `.claude/settings.json` wiring.
- **O4:** Editing the closed plans `retro-agent`, `intent-layer` and `review-agents`, or existing INSIGHTS entries that cite `docs/plans/*.retro.md` (user decision 8).
- **O5:** Changing the reviewers (`architecture-reviewer.md`, `plan-verifier.md`) to emit harness targets themselves. retro-writer assigns them.
- **O6:** Back-filling the Harness target column into the two migrated retro files. They stay byte-identical, and the analyst infers targets.
- **O7:** A cross-feature class-label registry. Cross-feature clustering is the analyst's job, per run.
- **O8:** Applying the visible-name invariant to `write tests`/`write docs`, or changing `globToRegExp` so `*` never matches empty. Those profiles write tracked, PR-reviewed paths, and C4/T6 keep their lists unchanged. `write docs` still accepts e.g. `docs/.md`; this is recorded for security review, not fixed here. *(rev 2)*

## Revisions
- rev 1 · 2026-09-26 · Initial plan from planner: S1–S11, AC1–AC9, T1–T15, C1–C7, O1–O7; execution order S1 → … → S11 · request to move retro files out of `docs/plans/` into a gitignored `.harness/` (retros + analyses), add a per-finding Harness target column to retro-writer entries, add a manually launched harness-analyst with a write-once `write analysis` scope-guard profile, re-point planner step 1a and the agents README, and migrate the two tracked retro files out of git (user decisions 1–8 of 2026-09-26).
- rev 2 · 2026-09-26 · AC6 gains the visible-name invariant and fake-root dispatch bullets; C3 working-tree anchors; C5/C6 extended; new *Visible-name invariant* decision; S2(f)/(h)/(i) + S2 Verify rewritten (5 old-location hits, fake-root `runrd` check, `globToRegExp` untouched); S3 re-points `retro-writer.md:217` *Decisions → Consecutive*; S6 one Permissions clause; S9/S11 notes; T2, T3, T6, T7, T10, T14 updated; new O8; rev 2 delta execution note · plan-verifier round 1 on rev 1 (42 met, 3 partial, 5 cannot verify): R1/A1 full-dispatch rows on the real root, a wrong S2 Verify hit list, a stale retro-writer pointer, and the empty-stem allow hole the user chose to fix; scope decided as retro/analysis only (tests/docs are tracked, PR-reviewed and bound by C4/T6) · retro it1: applied
- rev 3 · 2026-09-26 · AC2 wording (untracking in S11); C3 implementer-permissions bullet (reset/restore/stash not blocked); rev 3 delta execution note; S7 reduced to `mkdir` + `mv`; S8 no longer expects the staged deletion; S11 rewritten as one sequence (`git rm --cached` → T11 staged `D ` check → `git add` of the two untracked files → pathspec commit), with `INSIGHTS.md` always excluded; T11 split into content/location (S8) and staged-deletion (S11) parts; header Base note; two Risks (INSIGHTS exclusion decision, index reset) · plan-verifier re-verify on rev 2 (46 met, 3 partial, 1 not met, 5 cannot verify): both retro files back in the index as ` D` after an unreported index reset during the rev-2 implementer run; user decision 2026-09-26: no implementer or extra verify round, plan-verifier checks S11 after the commit · retro it2: applied

**Plan status:** Ready
