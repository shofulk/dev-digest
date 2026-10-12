# /sdd-run — delegation prompts

Every prompt starts with `User language: <language the user wrote in>`. Fill `<…>`; drop a
block that would be empty rather than sending it with "none". Paste reports and briefs
inline — the reviewers' Bash cannot run `.claude/scripts/*` (`scope-guard.sh` `bash
checks`), so whatever they need from those scripts comes in the prompt.

## Interface or implementation lane — `implementer`

```
User language: <…>
Plan: docs/plans/<feature>.plan.md · Revision <N>
Lane: L<n> — lanes <list> are Done.
Lane brief:
<output of node .claude/scripts/lane-brief.mjs <plan> L<n>>
Red tests (frozen — turn them green, never edit them):
<Red proof table from the red lane's report, rows whose Covers meet this lane>
Run notes (guidance only, no AC changes):
<classified notes>
Designs (client lanes only — Read the images; they show intent, the spec is binding):
<paths / URLs>
Earlier lanes' open issues that touch this lane:
<lines, with report paths>
End the lane with `.claude/scripts/checks.sh run <feature> --quick <packages you touched>`.
```

## Red lane — `test-writer`

```
User language: <…>
Mode: red
Plan: docs/plans/<feature>.plan.md · Revision <N> · Spec: <spec path>
Lane: L<n> — interface lane L<m> is Done; its files: <list from its report>.
Lane brief:
<lane-brief output>
Write every `red` Test-plan row of the brief; read the spec and the interface files only.
```

## After lane or test gap — `test-writer`

```
User language: <…>
Mode: after
Plan: docs/plans/<feature>.plan.md · Revision <N>
Target: <Test-plan rows with Phase: after | fix-list items T-…>
Designs: <for client RTL only>
```

## Review round — all three in one message

Common block, sent to each:

```
User language: <…>
Plan: docs/plans/<feature>.plan.md · Revision <N> · Spec: <path>
Change set: base <git merge-base HEAD origin/main sha> → working tree.
Checks: .harness/checks/<feature>.md — fresh (checks.sh status printed `fresh` at <time>)
```

- **architecture-reviewer**: + the implementers' *Hand-off to reviewers → Architecture*
  lines, merged.
- **security-reviewer**: + the merged *Hand-off → Security* lines and the plan's
  *Review hand-off → Security review* bullet.
- **plan-verifier**: + `Red tests:` (every red lane's *Red proof* table) and
  `Manual acceptance:` (the `NN-manual-acceptance.md` entries, each with its key output
  line), and the resolution of any `red-test dispute`.

## Fix — `implementer` (fix mode)

```
User language: <…>
Mode: fix · Round <r>
Plan: docs/plans/<feature>.plan.md · Revision <N>
Fix list (fix exactly these; nothing else changes):
| ID | Source report | Severity | file:line | Finding (verbatim) | Expected after the fix |
Red tests (still frozen): <table>
Previous reports: <paths>
End with `.claude/scripts/checks.sh run <feature> --quick <packages you touched>`.
```

## Re-review (delta) — the reviewer that had open items

```
User language: <…>
Re-review · Round <r>
Plan: docs/plans/<feature>.plan.md · Revision <N>
Previous report: .harness/runs/<feature>/<file>
Items to re-judge: <IDs and one-line findings>
Delta: `git diff --name-only <snapshot sha>` is the fix diff; judge every changed line
in it as a new change set, and re-judge each listed item as resolved / not resolved with
evidence. Items outside the delta keep their previous verdict.
Checks: .harness/checks/<feature>.md — fresh
```

## retro-writer

```
User language: <…>
Plan: docs/plans/<feature>.plan.md · Reviewed revision: <N> · HEAD: <sha>
Clean round since the newest retro entry: <yes / no>
Reports (verbatim):
<the round's reports>
```

## doc-writer

```
User language: <…>
Source: docs/plans/<feature>.plan.md (Revision <N>) and the shipped code.
Reports: <paths of the last Implementation Reports and Plan Verification>
Doc kind: <reference / explanation / cross-package overview — from the plan's doc steps>
```
