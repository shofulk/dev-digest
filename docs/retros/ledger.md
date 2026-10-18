# Run ledger

One row per finished `/sdd-engineering:run-plan` run, appended by
`/sdd-engineering:workflow-retro`, newest last. The row is a snapshot on the run's last day:
the usage numbers come from the run's transcripts and the verdicts from the plan's final
verification. Rows are never edited; a correction is a new row with
`correction of <date> <feature>` in *Notes*. The detail of each run is in
`docs/retros/<feature>.md`.

The ledger is how the harness is compared across runs: fewer fix rounds, fewer partial
items on the first verifier run and fewer tokens per AC mean a harness change worked.
`harness-analyst` reads it as committed evidence.

On 2026-10-18 the table moved to the plugin's columns: *AC met* and *Plugins* were added and
*Shipped* was dropped. Rows before that date come from the project's own `/sdd-run`: they
keep their values, with `—` in the two new columns and the *Shipped* value in *Notes*.

| Date | Feature | Spec | Plan rev · mode | Lanes | Fix rounds (budget) | First verifier run (met · partial · not met · cannot) | Final verifier run | AC met | Subagent runs | Input · output tokens | Not verified | Plugins | Retro | Notes |
|------|---------|------|-----------------|-------|---------------------|--------------------------------------------------------|--------------------|--------|---------------|-----------------------|--------------|---------|-------|-------|
| 2026-10-04 | pr-brief | SPEC-02 · 71 AC | 1 · multi-agent | 8 | 5 (3) | 141 · 12 · 2 · 1 | 0 not met · 0 partial · 1 cannot | — | 56 | 336.6M · 455k | NFR-10, AC-52 (manual) | — | [pr-brief](pr-brief.md) | first ledger row; earlier runs predate the ledger; shipped `8546f69`, PR #11; a `/sdd-run` row: *AC met* and *Plugins* were not recorded |
