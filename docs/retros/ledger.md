# Run ledger

One row per finished `/sdd-run`, appended by the main session in Phase 6 right after
`summary.md`, newest last. The row is a snapshot on the run's last day: the usage numbers
come from `node .claude/scripts/harness-usage.mjs` (*By feature* and *Rounds per feature*,
row = the plan slug) and the verdicts from the plan's final verification. Rows are never
edited; a correction is a new row with `correction of <date> <feature>` in *Notes*. The
detail of each run is in `docs/retros/<feature>.md`.

The ledger is how the harness is compared across runs: fewer fix rounds, fewer partial
items on the first verifier run and fewer tokens per AC mean a harness change worked.
`harness-analyst` reads it as committed evidence.

| Date | Feature | Spec | Plan rev · mode | Lanes | Fix rounds (budget) | First verifier run (met · partial · not met · cannot) | Final verifier run | Subagent runs | Input · output tokens | Not verified | Shipped | Retro | Notes |
|------|---------|------|-----------------|-------|---------------------|--------------------------------------------------------|--------------------|---------------|-----------------------|--------------|---------|-------|-------|
| 2026-10-04 | pr-brief | SPEC-02 · 71 AC | 1 · multi-agent | 8 | 5 (3) | 141 · 12 · 2 · 1 | 0 not met · 0 partial · 1 cannot | 56 | 336.6M · 455k | NFR-10, AC-52 (manual) | `8546f69`, PR #11 | [pr-brief](pr-brief.md) | first ledger row; earlier runs predate the ledger |
