# Run cost — `server`

## Goal

Every agent run records what it cost in USD, and that cost is served on the run
timeline, the run trace and as a per-PR total on the pull-request list.

## Background

`reviewer-core` already returns `costUsd` on every `ReviewOutcome` (provider-
reported when available, else estimated from the price book), but the server
discarded it and `agent_runs.cost_usd` was dropped in migration `0009`. This spec
restores the persistence and exposes it.

## Acceptance criteria

1. A completed review run persists `agent_runs.cost_usd` = `ReviewOutcome.costUsd`.
2. A run whose model is absent from the price book persists `NULL`, never `0`.
3. Failed and cancelled runs persist `NULL` cost.
4. `GET /pulls/:id/runs` returns `cost_usd` on every `RunSummary`.
5. `GET /runs/:id/trace` returns `stats.cost_usd`.
6. `GET /repos/:id/pulls` returns `cost_usd` per PR = `SUM(agent_runs.cost_usd)`
   over **every** run of that PR, so re-reviews accumulate.
7. A PR with no runs returns `null` for `cost_usd` (not `0`).
8. `RunStats.cost_usd` is **nullish**, so traces persisted before the column
   existed still parse.
9. `PrMeta.cost_usd` is **nullish**, because the GitHub adapters also return
   `PrMeta` and know nothing about cost.

## Contracts touched

- Table `agent_runs` — column `cost_usd double precision`, index
  `agent_runs_pr_idx` on `pr_id` (migration `0010`).
- `RunSummary.cost_usd`, `RunStats.cost_usd` — `contracts/trace.ts`.
- `PrMeta.cost_usd` — `contracts/platform.ts`.
- Routes: `GET /repos/:id/pulls`, `GET /pulls/:id/runs`, `GET /runs/:id/trace`.

## Out of scope

`PrDetail` (`GET /pulls/:id`) does not compute the sum — cost is a list-only
field, exactly as `score` already is. Per-agent and per-workspace cost rollups
(`AgentStats.total_cost_usd` and friends) stay unserved. `eval_runs` / `ci_runs`
cost columns are untouched. No budgets, caps or alerts.

## Open questions

- A run cancelled or reaped at boot keeps `NULL` cost even though it burned
  tokens. Accepted for now: the tokens are not known at that point either.
- The backfill (`pnpm db:backfill`) re-prices old runs at *today's* prices, so a
  run whose true cost came from the provider is approximated.
