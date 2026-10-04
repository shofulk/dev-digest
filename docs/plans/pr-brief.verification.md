# Plan verification: pr-brief

**Plan:** `docs/plans/pr-brief.plan.md` · Revision 1 · **Spec:** `specs/pr-brief.spec.md`
(SPEC-02) · **Verifier:** `plan-verifier` agent · **Date:** 2026-10-04

The verifier builds a matrix over every `AC*`, `S*`, `T*`, `C*` and `O*` item of the plan
(156 items) and backs each verdict with a file and line, a named test assertion or a
command's output line. An implementer's own report counts as a claim, never as evidence.

## Final result

**0 not met · 0 partial · 1 cannot verify** (after fix round 5).

| Item | Verdict | Why |
|------|---------|-----|
| All ACs, steps, test rows, constraints, out-of-scope items except the one below | met | named tests pass; full checks green (server 380 unit + 117 integration, client 454, arch 0 errors, hermetic e2e 10/10) |
| NFR-10 / C32 (axe 0 A/AA, keyboard-only pass) and the manual half of AC-52 (risk severity colour) | cannot verify | needs a real browser; no browser automation was available during the run |

## Runs

| Run | When | Result |
|-----|------|--------|
| 1 | after all eight lanes | 141 met · 12 partial · 2 not met · 1 cannot verify. Not met: AC-71 and T15 (e2e flow 12 did not reach the Files changed tab). |
| 2 | after fix round 1 | 154 met · 1 partial · 0 not met · 1 cannot verify |
| 3 | after fix round 2 | 153 met · 2 partial · 0 not met · 1 cannot verify. The round's fix put an English string in a hook (constraint C-strings / NFR-11). |
| 4 | after fix round 3 | 155 met · 0 partial · 0 not met · 1 cannot verify |
| 5 | after fix round 4 | delta rows: 9 met · 2 partial (test gaps on the retry exits, no code defect) |
| 6 | after fix round 5 (tests only) | delta rows: 9 met · 0 partial · 0 not met · 1 cannot verify |

From run 3 on, every fix had to map each AC clause it touched to a named test assertion,
not to a code line alone. From run 5 on, the verifier also traced every exit of the
brief banner's failed state through `BriefService.generate()` on the server.

## Red tests

Acceptance tests were written before the code and frozen by `git hash-object`. Every run
re-checked the hashes; all matched at the end (12 frozen oracle files).
