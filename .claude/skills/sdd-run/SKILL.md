---
name: sdd-run
description: Runs the execution half of DevDigest's Spec Driven Development for one feature whose plan already exists — lanes (interface → red tests → implementation), the full checks gate, manual acceptance, the parallel review round (architecture, security, plan traceability), and fix rounds until the reviewers are clean, then docs and /pr-self-review. Takes a spec or plan path, optional extra notes and optional designs. Does NOT run spec-creator or implementation-planner — those are run by hand before it. Invoke only when the user types /sdd-run.
argument-hint: <spec-or-plan path> [notes: "<extra requirements>"] [design: <png|url> …] [--rounds N] [--resume] [--from lanes|gate|review|fix|finish]
disable-model-invocation: true
---

# /sdd-run — run an approved plan to a reviewed change set

The main session is the orchestrator: it dispatches every agent, owns every user question,
writes every run file, and never writes product code itself. The agents' rules live in
`.claude/agents/*.md`; the flow and its reasons in `.claude/agents/README.md` (*Flow*,
*Lanes and briefs*, *Test-first*, *Checks run once*, *The fix loop*). This skill is the
procedure that strings them together. Delegation prompts are in `prompts.md`, finding
triage in `triage.md` — read each when its phase starts.

**Not in this command:** `spec-creator` (writes and approves the spec) and
`implementation-planner` (writes and revises the plan). When a phase needs either, the run
**stops** and tells the user which one to run and with what input; it never calls them.

## Arguments

| Input | Meaning |
|-------|---------|
| `<path>` | A plan `docs/plans/<feature>.plan.md`, or a spec — then the plan is the one whose `**Spec:**` header names it. Required. |
| `notes: "…"` | Extra requirements for this run. See *Notes* below. |
| `design: …` | Zero or more image paths, a `http://localhost:…` page, or a Figma link (usable only with a Figma MCP tool; otherwise ask for a PNG). |
| `--rounds N` | Fix-round budget after the first review round. Default **3**. |
| `--resume` | Continue from `.harness/runs/<feature>/state.md`. |
| `--from <phase>` | Start at a phase; earlier phases must be `done` in the state file. |

**Notes** are classified before anything runs. Guidance that leaves every `AC*` and the
scope unchanged ("reuse `useRepoQuery`", "keep the old endpoint alive") goes to every lane
as `Run notes:`. Anything that adds, removes or changes behaviour is a plan change: stop
and tell the user to run `implementation-planner` in Update mode with the plan path and
the notes as the change request. When unsure which it is, ask (`AskUserQuestion`).

**Designs** go to the lanes that touch `client/`, to the after-mode `test-writer`, and to
manual acceptance; never to server lanes or to the reviewers.

## Run files

Everything lives under `.harness/runs/<feature>/` (gitignored): `state.md` — phase, plan
revision, lanes done, round, open items; one file per agent report, `NN-<agent>-<lane or
round>.md`, written verbatim the moment the agent returns. Later phases cite these paths
instead of carrying reports in context, and `--resume` rebuilds the run from them. Update
`state.md` after every phase.

## Phase 0 — Preflight

1. Resolve the plan. Stop if: no plan exists for the spec (→ "run implementation-planner
   with `<spec>`"); `**Plan status:**` is not `Ready`; the spec is not `approved`.
2. `node .claude/scripts/lane-brief.mjs <plan> --lanes` — the lane table. A plan without
   lanes, or with a lane over 6 steps, was written before *Lanes* existed: say so and ask
   whether to run it as is or have the planner re-cut it (Update mode).
3. Branch: on `main`, create `feat/<feature>` (`git switch -c`) — never commit.
4. Environment: `docker info` (decides `*.it.test.ts`), and the real `API_PORT`/`WEB_PORT`
   from `server/.env`/`client/.env` plus `curl` on both, per root `INSIGHTS.md`
   2026-09-26, so manual acceptance knows whether a stack is up.
5. Classify `notes:`; check every `design:` path exists.
6. Write `state.md`, then print a five-line run summary (plan + revision, lanes and agents,
   red lane yes/no, Docker/stack, round budget) and start. Do not ask for confirmation —
   the user started the command.

## Phase 1 — Lanes

Dispatch lanes in `## Execution` order with the `prompts.md` templates. A lane starts only
after every lane in its *Depends on* returned `Done`; lanes marked *Parallel with* each
other go out in one message. Pass each lane its brief inline (`Lane brief:`), never the
plan.

After each lane returns, write its report file, then:

| Report | Action |
|--------|--------|
| `Done` | next lane |
| test-writer red, `Done` | check its *Red proof* has a hash for every `red` row of its brief; keep the table — every later implementer lane and plan-verifier gets it as `Red tests:` |
| `Partial`, only `manual acceptance:` items | collect them for Phase 3, next lane |
| `Partial`, `red-test dispute` | ask the user: fix the test (re-run test-writer red on that row), or the spec reading is wrong (stop → planner Update mode) |
| `Partial`, a failing check after 3 attempts | one fix dispatch of the same lane with the failure excerpt and its report path; still failing → stop and ask |
| `Blocked` | stop, show the gate reason; a plan problem → planner Update mode |

## Phase 2 — Checks gate

`.claude/scripts/checks.sh run <feature> <every touched package>` (full mode). A failure
goes back to the implementer of the package that fails, with the excerpt, as a gate fix
(at most 2; not a review round). Then `.claude/scripts/checks.sh status <feature>` must
print `fresh` before Phase 4, and again after every later edit.

## Phase 3 — Manual acceptance

Run every collected `manual acceptance:` line the session can run: reuse a healthy stack
(Phase 0 step 4), never start a second one on top of it. With `design:` inputs and a stack
up, open the touched pages with the browser tools and compare them with the designs —
missing states, copy, layout. Record each result as the command or action plus its key
output line in `NN-manual-acceptance.md`. What the session could run with a stack, Docker
or a probe but did not stays *cannot verify*. An item only the user or an absent browser
channel can run (visual check, axe/keyboard, an e2e flow with no `agent-browser`) is written
as `awaiting manual: <item> — <what to run> — <why it could not run>`; plan-verifier counts
it separately, and it reaches the user through `summary.md`.

## Phase 4 — Review round

In one message, in parallel: `architecture-reviewer`, `security-reviewer`,
`plan-verifier` — with `Checks: … — fresh`, `Red tests:`, `Manual acceptance:` and the
change set (`prompts.md`). Write the three reports, then triage them (`triage.md`) into
one numbered fix list. Clean on all three → Phase 6.

## Phase 5 — Fix rounds

Round `r` = 1 … `--rounds`:

1. **Retro first.** `retro-writer` with the plan path, revision, the round's reports
   verbatim and `HEAD` (README *The retro step*). `Converging: no` → stop all fixing and
   ask the user with its sign-off options.
2. **Snapshot**: `git stash create` (prints a sha, changes nothing; empty output means a
   clean tree — use `HEAD`). The delta review below diffs against it.
3. **Dispatch fixes** from the fix list: code items to `implementer` (fix mode), test items
   to `test-writer` (after mode), grouped by package; groups with disjoint files go out in
   parallel. Plan-level items are not fixed here — stop and name the planner input.
4. **Gate**: Phase 2 again.
5. **Re-review the delta**: only the reviewers that had open items, each told the snapshot
   sha, the previous report path and the item IDs it must re-judge (`prompts.md`,
   *Re-review*). plan-verifier always re-runs when any fix touched a file a plan item names.
6. Triage again. Clean → Phase 6. Items left and budget left → next round. Budget spent →
   ask the user: one more round, accept the rest as known issues, or stop for a planner
   Update.

A finding the main session believes is wrong is never dropped silently: it is verified
against the code first and, if rejected, recorded with the evidence under *Rejected* in the
fix list, so the next reviewer round sees why.

## Phase 6 — Finish

1. `doc-writer` with the plan path and the run's report paths, if the plan or the change
   needs docs (a README, `.doc/`, a Mermaid diagram); otherwise skip and say why.
2. `/pr-self-review` (the `pr-self-review` skill). It reuses the fresh full checks record.
   A confirmed critical → one more fix round, if budget is left.
3. When plan-verifier reported every `AC*` met, set the spec's `Status:` to `implemented`
   (this is the main session's step, README *Approved is frozen*).
4. `engineering-insights` wrap-up for the touched packages, and the graduation candidates
   retro-writer listed.
5. Write `summary.md` and print it short: lanes, rounds, findings fixed / rejected /
   accepted, open minors, what is not verified, the PR draft path. Then ask whether to
   commit and open the PR — never do either unasked.

## Stop rules

- A stop always says **why**, **what to run next** (with the exact input), and that
  `/sdd-run <path> --resume` continues afterwards.
- Never edit product code, tests, plans or specs in the main session to "save a round" —
  README *The retro step*: an in-place fix once bypassed every gate.
- One `AskUserQuestion` per decision cluster, recommended option first.
