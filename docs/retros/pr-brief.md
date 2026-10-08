# Run retro: pr-brief (SPEC-02)

**Spec:** `specs/pr-brief.spec.md` (SPEC-02, `approved`) · **Plan:** `docs/plans/pr-brief.plan.md`
rev 1, multi-agent · **Run:** `/sdd-run`, 2026-10-04 · **Shipped:** `8546f69` (PR #11, base
`L05`), follow-ups `ab20308`, `c88f3a6` · **Verification:** `docs/plans/pr-brief.verification.md`

This is the committed result of one run. The per-round retro entries and run files under
`.harness/` are local raw material; every claim here cites a committed file, a sha or the
usage digest.

## Outcome

| Measure | Value | Source |
|---------|-------|--------|
| Lanes | 8 (L1 interface · L2–L3 red · L4–L7 implementation · L8 e2e after) | `pr-brief.plan.md` *Execution* |
| Fix rounds | 5, budget 3 (rounds 4 and 5 approved by the user) | `pr-brief.verification.md` *Runs* |
| Plan-verifier, run 1 → final | 141 met · 12 partial · 2 not met · 1 cannot verify → 0 not met · 0 partial · 1 cannot verify (156 items) | `pr-brief.verification.md` |
| Checks at the end | server 380 unit + 117 it, client 454, arch 0 errors, hermetic e2e 10/10 | `pr-brief.verification.md` *Final result* |
| Not verified | NFR-10 (axe 0 A/AA, keyboard pass) and the manual half of AC-52 (severity colour) — no browser channel during the run | `pr-brief.verification.md` |
| Red tests | 12 frozen oracle files, hashes matched at the end | `pr-brief.verification.md` *Red tests* |
| Subagent runs · tokens | 56 runs · 336.6M input · 455k output (2 sessions) | `node .claude/scripts/harness-usage.mjs`, run 2026-10-05, *By feature* · `pr-brief` |
| Launches by type | implementer 13 · test-writer 12 · plan-verifier 6 · retro-writer 5 · architecture-reviewer 4 · security-reviewer 2 · implementation-planner 1 · general-purpose 10 · doc-writer 2 | same digest, *Rounds per feature* · `pr-brief` |

## What went well

- **Test-first held.** The red lanes froze 12 oracle files before the code, and no
  implementer edited one; every verifier run re-checked the hashes.
- **Parallel lanes paid off.** Server (L4–L5) and client (L6–L7) lanes ran side by side on
  disjoint files; no lane needed a re-cut.
- **The loop converged on its own evidence.** Labelled findings per round went 12 → 6 → 3
  → 0 → 4, and the last round was tests only — no code defect was left.

## What went wrong

| # | Class | What happened | Cost |
|---|-------|---------------|------|
| 1 | test oracle weaker than the plan | Tests named by the plan passed on code that broke the AC (one constant message for every error code, a copied attribute, red only against an empty state). Found in 4 of 5 rounds. | Most of rounds 2–5 |
| 2 | AC detail unverified | A plan restatement dropped a dimension of the AC clause it claimed ("icon per kind" without the severity colour; a token budget measured on the fact set, not on the prompt). | Round 1, round 2 |
| 3 | unenumerated client state | The brief banner's failed state had exits nobody listed (retry after a reused job, a later error masked by an earlier one), so each fix opened the next round. | Rounds 3–5 |
| 4 | late client lens | Six majors (F12–F17) came from the `/pr-self-review` frontend buckets after all three reviewers were clean. | One extra round |
| 5 | oracle not runnable by its author | The e2e lane could not run its own flow under its guard profile; flow 12 first ran in manual acceptance and failed (page area does not scroll in headless `agent-browser`). | Round 1 |

## Harness changes taken

- **Applied** (`40eab59`, analysis 2026-10-04 P1 and P5): the planner checks restatement
  fidelity, joint satisfiability and contract types per AC clause; the plan-verifier scores
  a clause by its named assertion and has an `awaiting manual` verdict.
- **Applied** (2026-10-05): requirement clarification moved fully to `spec-creator` — open
  points stay in the draft as `[NEEDS CLARIFICATION: Q-n]`, `spec-lint` blocks approval
  while one is left, and the planner returns *Plan blocked* instead of asking. Class 2 above
  now stops at the spec, not in a fix round.
- **Not applied yet** (same analysis): P2 wrong-variant control per test (class 1), P3
  oracle-first fix rounds with a clause column (class 3), P4 a client-behaviour lens in the
  review round (class 4), P6–P7 e2e author can run its flow and a viewport convention
  (class 5), P8–P10.

## For the next run

- Expect class 1 again until P2 lands; ask `test-writer` for a named wrong variant per
  test in the dispatch.
- Connect the browser channel before Phase 3, or the a11y and visual items stay
  unverified again.
