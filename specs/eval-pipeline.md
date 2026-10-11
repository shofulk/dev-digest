# Eval Pipeline — `server` + `client`

## Goal

Give every reviewer agent a regression harness built from its own triaged findings: one click
turns an accepted or dismissed finding into a frozen eval case, one route runs the agent over
all of its cases, and code — never a model — scores the run as recall, precision and
citation accuracy, so two runs of different agent versions can be compared side by side.

## Background

- L01–L05 left a dataset behind: every finding in `findings` carries `accepted_at` or
  `dismissed_at` (mutually exclusive, set by `POST /findings/:id/accept|dismiss`). Those
  decisions *are* the test set — no invented scenarios.
- The tables already exist (`server/src/db/schema/eval.ts`) and are filled, not changed:
  `eval_cases` (one frozen case) and `eval_runs` (**one row per case per run**, FK `case_id`).
  There is no run-group column, no `created_at`, no source-finding column — see **D1**, **D2**.
- Contracts already exist in `server/src/vendor/shared/contracts/{knowledge,eval-ci}.ts`
  (`EvalCase`, `EvalCaseInput`, `EvalRun`, `EvalRunRecord`, `EvalDashboard`, …). This feature
  adds to them; it does not rename or remove an existing field.
- An agent's system prompt is versioned: any config change bumps `agents.version` and snapshots
  `agent_versions.config_json` (`server/src/modules/agents/repository.ts`). A run records the
  version it ran, so "old prompt vs new prompt" is a lookup, not a copy.
- The grounding gate (`reviewer-core/src/grounding.ts` `groundFindings`) keeps a finding only when
  its file is in the diff and its line range intersects a hunk. `reviewPullRequest` returns the
  kept findings and `dropped[]`, so the pre-gate count is available in memory and nowhere else.
- No eval module exists on the server; no eval UI exists in the client. `client/messages/en/eval.json`
  and the `editor.tabs.evals` / `nav.eval` keys are drafted and unused.

## Acceptance criteria

### A. Case from a finding — one click

1. `POST /findings/:id/eval-case` (no body) creates an agent-owned case from a triaged finding.
   The owner is `reviews.agent_id` of the finding's review; the workspace check goes through the
   review (findings carry no `workspace_id`).
2. Expectation type comes from the decision: `accepted_at` set → `must_find`; `dismissed_at`
   set → `must_not_flag`. A finding with neither is refused `422 finding_not_triaged`; a finding
   whose review has no `agent_id` is refused `422 finding_has_no_agent`.
3. The case is **frozen** at creation — it never points back at live PR data:
   - `input_diff` = that one file's `pr_files.patch`, wrapped in a `diff --git a/p b/p` /
     `--- a/p` / `+++ b/p` header so `parseUnifiedDiff` reads it. No patch stored →
     `422 no_diff_available`; over `MAX_FROZEN_DIFF_BYTES` (200 KB) → `422 frozen_diff_too_large`.
   - `input_files` = `[finding.file]`.
   - `input_meta` = `{ source_finding_id, source_review_id, pr_number, pr_title, pr_body, created_at }`.
   - `expected_output` = one `EvalExpectation`:
     `{ type, file, start_line, end_line, severity, category, title }`, copied from the finding.
   - `name` = slug of the finding title plus `file:start_line`; `notes` = the finding rationale.
4. The expectation must be groundable in its own frozen diff — the same rule as the gate (file
   present, line range intersects a hunk). Otherwise `422 expectation_not_grounded`: a case the
   agent could never satisfy is not stored.
5. Idempotent: a second click on the same finding returns the existing case with `200`
   (first time `201`). Lookup is by `input_meta->>'source_finding_id'` + owner.
6. Re-triaging a finding after its case exists does not mutate the case. Deleting the case and
   clicking again is the way to flip its type.

### B. Case list

7. `GET /agents/:id/eval-cases` → `EvalCaseView[]`: the case, its parsed expectation, and its
   latest result (`pass` / `fail` / `errored` / `never_run`) from the newest completed run.
8. `DELETE /eval-cases/:id` → `204`; its `eval_runs` rows cascade. Workspace-scoped; another
   workspace's case is `404`.

### C. Running the suite — fixed inputs

9. `POST /agents/:id/eval-runs` (no body) starts one suite run over **all** of the agent's cases
   and answers `202 { run_id, cases_total }`. Rate-limited (5/min). No cases → `422 no_cases`;
   the agent's provider has no usable key (checked via `container.canUseLlm`) →
   `422 provider_not_configured`; a run already in flight for this agent → `409 run_in_flight`.
10. A suite run is identified by a minted `run_id` (uuid). On start, one `eval_runs` row per case
    is inserted with `pass = null` and `actual_output = { run_id, agent_id, agent_version,
    status: 'pending', … }` (**D1**). Each row is updated as its case finishes; the run is
    `running` while any row is `pending`, otherwise `completed`.
11. Every case executes with the same fixed inputs, regardless of when it runs:
    `reviewPullRequest({ systemPrompt, model, strategy, skills, diff: parseUnifiedDiff(input_diff),
    prDescription: input_meta.pr_body, task })` using the agent's **current** config and enabled
    skills. Never passed: repo map, callers, intent, memory, specs, session id. The only thing
    that differs between two runs on the same case set is the agent (prompt, model, skills).
12. Cases run sequentially in the background (fire-and-forget from the route). A case that throws
    is stored as `status: 'errored'` with the reason and does not stop the run.
13. An eval run writes **nothing** to `agent_runs`, `reviews`, `findings` or `run_traces`
    (those feed PR cost rollups and run history). Its findings live only in `actual_output`.
14. A row still `pending` 15 minutes after its run started is reconciled to `errored`
    (`reason: 'timeout'`) on the next read, so a server restart cannot leave a run `running`
    forever.

### D. Scoring — code only, no model

15. Scoring lives in `server/src/modules/eval/scoring.ts`, a pure module: no I/O, no container,
    no LLM import. A test asserts the scoring path makes zero provider calls.
16. **Match:** a finding matches an expectation when `finding.file === expectation.file`
    (exact string) **and** the line ranges intersect (`fLo <= eHi && eLo <= fHi`, each range
    ordered min/max first). Only findings that survived the grounding gate are scored.
17. **Per case:** `must_find` passes when ≥1 finding matches; `must_not_flag` passes when 0
    findings match.
18. **Per run**, over completed (non-errored) cases only:
    - `recall` = passed `must_find` cases ÷ all `must_find` cases (`null` if none).
    - `precision` = TP ÷ (TP + FP), where TP = findings matching a `must_find` expectation and
      FP = findings matching a `must_not_flag` expectation; findings that match neither are
      unlabelled and excluded (`null` if TP + FP = 0). See **D3**.
    - `citation_accuracy` = Σ kept ÷ Σ (kept + dropped) across cases, from the gate's own counts
      (`null` if the agent produced no findings at all).
    - `traces_passed` / `traces_total`, `cases_errored`, `duration_ms` (sum), `cost_usd`
      (sum; `null` if any case's cost is `null`).
19. Per-case rows also carry their own `pass`, `recall`, `precision`, `citation_accuracy`,
    `duration_ms`, `cost_usd` columns so a single row is readable without its siblings.

### E. History and comparison

20. `GET /agents/:id/eval-runs` → `EvalSuiteRun[]` newest first: `run_id`, `status`,
    `agent_version`, `started_at`, `finished_at`, the run metrics of **D**, case count.
21. `GET /eval-runs/:runId` → `EvalSuiteRun` plus `per_case[]` (case name, expectation, pass,
    status, findings with a `matched` flag, kept/dropped counts). It serves per-case detail; the
    client polls `GET /agents/:id/eval-runs` (AC20) while a run is `running`.
22. `GET /eval-runs/compare?a=<runId>&b=<runId>` → `EvalCompare`: both runs' summaries, metric
    deltas (`b − a`, `null` when either side is `null`), per-case flips (pass→fail, fail→pass)
    over the cases both runs share, cases only in one run, and a line diff of the two
    versions' `system_prompt` read from `agent_versions`. Runs of different agents →
    `422 invalid_compare`; `a === b` → `422`.
23. `GET /eval/dashboard` → per agent with ≥1 case: name, model, cases total, latest completed
    run's metrics and its `agent_version`, last 10 runs' recall/precision for sparklines; plus
    the 20 most recent suite runs across all agents.

### F. Client

24. **FindingCard** gets a third action, "Turn into eval case" (flask icon), beside Accept and
    Dismiss. It is enabled only when the finding is accepted or dismissed (tooltip otherwise)
    and labels which type it will create (`must_find` / `must_not_flag`). The card stays
    presentational — the parent owns the mutation, as it does for accept/dismiss. Success
    shows "Eval case created" or "Already in the eval set".
25. **AgentEditor → Evals tab** (`?tab=evals`), top to bottom: an "Eval metrics" label row with a
    "View full dashboard →" link to `/eval`; four tiles always visible (RECALL, PRECISION,
    CITATION ACCURACY as whole percents, TRACES PASSED as `passed/total`) showing "—" with no
    delta before the first completed run, and afterwards the latest completed run with a signed
    point delta vs the previous one (`▲ 4pt` green, `▼ 2pt` red); an "Eval cases" header with a
    "n / total passing" badge (shown only after a case has run) and a "Run all evals" button that
    disables and shows progress (`n / total`) while a run is in flight; the cases as bordered
    cards — status icon (pass, fail, errored, never run), the case name, an "expected ≥1 finding,
    got N" / "expected 0 findings, got N" line (N = findings matching the expectation in the
    newest completed run; "never run" / "errored" otherwise), a single-line ellipsis-truncated
    `file:line` (full path in the title), a "SEVERITY · category" chip, the type chip and delete;
    no horizontal scroll. Below, a run-history table (time, version, recall, precision, citation,
    passed/total, cost) where selecting exactly two rows enables **Compare**.
26. **Compare modal**: the four metric tiles as `old → new` with signed deltas (green up, red
    down), the system-prompt diff (added/removed lines), and the list of cases that flipped.
27. **Eval Dashboard** page at `/eval`, linked from the sidebar's SKILLS LAB section ("Eval
    Dashboard", gauge icon): one row per agent (latest recall/precision/citation, version,
    passed/total, a recall sparkline) linking to `/agents/:id?tab=evals`, and a recent-runs
    table across all agents.
28. All copy in `messages/en/eval.json` (and the `prReview` namespace for the card button);
    data only through `src/lib/hooks/eval.ts`; types imported from the contract file, not the
    barrel (client INSIGHTS 2026-09-17).

### G. Module shape and layering

29. `server/src/modules/eval/` is a self-contained Fastify plugin registered in
    `modules/index.ts`: `routes.ts`, `service.ts`, `repository.ts`, `executor.ts`,
    `scoring.ts`, `frozen-input.ts`, `constants.ts`. `scoring.ts` and `frozen-input.ts` are
    ring-1 pure. The LLM provider is resolved from the container; no SDK import in the module.
    `pnpm --dir server arch` reports no new violation.
30. New contracts are added to `server/src/vendor/shared/contracts/eval-ci.ts` (and the eval
    section of `knowledge.ts` if needed) and mirrored byte-for-byte into
    `client/src/vendor/shared/contracts/`.

### H. Routes, summarised

| Method | Path | Body | Answer |
|---|---|---|---|
| POST | `/findings/:id/eval-case` | — | `201` / `200` `EvalCase` |
| GET | `/agents/:id/eval-cases` | — | `EvalCaseView[]` |
| DELETE | `/eval-cases/:id` | — | `204` |
| POST | `/agents/:id/eval-runs` | — | `202 { run_id, cases_total }` |
| GET | `/agents/:id/eval-runs` | — | `EvalSuiteRun[]` |
| GET | `/eval-runs/:runId` | — | `EvalSuiteRunDetail` |
| GET | `/eval-runs/compare?a&b` | — | `EvalCompare` |
| GET | `/eval/dashboard` | — | `EvalDashboardOverview` |
| POST | `/eval/runs/all` | `{ confirm: true }` | `202 EvalRunAllResult` (AC33) |
| POST | `/agents/:id/versions/:version/restore` | — | `Agent` (AC36) |

### I. Amendment 1 — design alignment (2026-10-11, D10)

31. **Case name is the bare slug** of the finding title, without ` · file:line`; the case card
    shows the path on its own line. Cases created before this change keep their stored name.
32. **Eval Dashboard `/eval`** follows the mockup: title, subtitle and a primary **Run all
    agents** button; an "Agents" section with one card per agent that has ≥ 1 case — agent icon,
    name, model chip, `Last run v<N> · <date> · <passed>/<total> pass` (or "never run"), a recall
    sparkline (≥ 2 points), large coloured RECALL / PREC / CITE values and a chevron; the whole
    card links to `/eval/agents/:id`. Below, "Recent eval runs · all agents": agent, time (mono),
    version (accent), recall / precision / citation each as a coloured bar plus percent,
    passed/total.
33. **Run all agents**: `POST /eval/runs/all` (body `{ confirm: true }`, rate-limited) starts one
    suite run per agent with ≥ 1 case through the same start path as AC9 and answers
    `EvalRunAllResult { started: [{ agent_id, agent_name, run_id | null, refused_reason | null }] }`.
    An agent with a run in flight or no usable provider is refused individually; the call never
    fails as a whole for one agent. The client confirms first, stating agents × cases = model calls.
34. **Agent eval page `/eval/agents/:id`** (crumbs Skills Lab › Eval Dashboard › agent): "← All
    agents"; title with model chip; subtitle `Regression harness · <runs> runs on the <cases>-case
    set`; an agent picker that switches the route and a **Run eval** button (same action as the
    Evals tab); a **callout** when the newest completed run moved a metric against the previous
    one (e.g. "Precision dipped 2pt on v7"), computed in code from those two runs; three metric
    cards (recall, precision, citation) with value, signed delta and sparkline; a **Metric trend**
    line chart of the three metrics over completed runs; a **Recent runs** table — checkbox, ran
    at, version, recall / precision / citation bars, pass, cost — where exactly two selected runs
    enable **Compare**. Data comes from the existing `GET /agents/:id/eval-runs` and
    `GET /agents/:id/eval-cases`; no new read route.
35. **Compare modal** follows the mockup: title `Compare runs · v<a> → v<b>`, subtitle "Old prompt
    vs new"; tiles RECALL, PRECISION, CITATION and **COST**, each `old → new` with a signed delta (for COST the tone is inverted: an increase is red, a decrease green — user ruling 2026-10-11);
    "System prompt diff" with a `v<a> (old)` / `v<b> (new)` legend and the full prompt with
    added / removed lines highlighted; the flipped-cases list stays below; footer **Close** and
    **Promote v<b>**, hidden when v<b> is already the agent's current version or its prompt is
    unavailable.
36. **Promote**: `POST /agents/:id/versions/:version/restore` restores that version's config as a
    **new** agent version (the `POST /skills/:id/versions/:version/restore` semantics) and returns
    the updated agent; unknown version or another workspace's agent → 404.

## Tests

`pnpm --dir server verify:l06` runs exactly the files below and is the homework gate.

Hermetic (no Docker, no network):

- `src/modules/eval/scoring.test.ts` — `matches` (same file + overlap; other file; no overlap;
  one-line touch at either edge; reversed range); `scoreCase` both types pass/fail; `scoreRun`
  recall, precision with TP/FP, unlabelled findings excluded, citation from kept/dropped,
  errored cases excluded, `null` cases, cost `null` propagation.
- `src/modules/eval/frozen-input.test.ts` — frozen diff round-trips through `parseUnifiedDiff`;
  expectation grounded / outside every hunk / wrong file / empty patch; size cap.
- `src/modules/eval/executor.test.ts` — with `MockLLMProvider`: only grounded findings come
  back with kept/dropped counts; the assembled prompt contains the frozen PR body and no repo
  map, callers, intent or memory; two executions of one case produce a byte-identical prompt.
- `test/eval-contract-parity.test.ts` — server and client copies of the eval contracts are
  identical.
- `test/contracts.test.ts` — the new contracts parse fixture data.

DB-backed (`test/eval.it.test.ts`, testcontainers):

- case from an accepted finding → `must_find`; from a dismissed one → `must_not_flag`; open
  finding → `422`; second click → `200` same id; foreign workspace → `404`.
- run with a mock provider: `202`, poll to `completed`, metrics stored per row; second start
  while running → `409`; no rows written to `agent_runs` / `findings`.
- compare: two runs on two agent versions return deltas and a non-empty prompt diff.
- dashboard lists the agent with its latest run; delete case cascades its run rows.

Client (Vitest + RTL): FindingCard button enabled/disabled per triage state and type label;
EvalsTab compare button enables only with exactly two runs selected; CompareModal renders
signed deltas.

## Decisions

- **D1 — run grouping lives in `actual_output`, not in a new column.** `eval_runs` is one row per
  case and AGENTS.md forbids schema changes for course tables. Each row's `actual_output` holds
  `{ run_id, agent_id, agent_version, status, error?, findings[], grounding_kept,
  grounding_dropped }`; suite views group by `actual_output->>'run_id'`. Accepted cost: grouping
  queries read jsonb and are not indexed — fine at tens of cases.
- **D2 — finding provenance lives in `input_meta`.** No `source_finding_id` column exists, so
  idempotency (AC-5) is an application-level lookup, not a unique index.
- **D3 — precision is TP / (TP + FP), not `1 − FP/total`.** With `1 − FP/total`, a deliberately
  noisy prompt that adds many unlabelled findings *raises* precision (bigger denominator), which
  would hide exactly the regression the sensitivity test is meant to show. Counting only
  labelled findings keeps the metric monotone in the right direction; dismissed cases are the
  only source of FP, as the assignment requires.
- **D4 — the prompt is not copied into each run.** `agent_version` is stored; the prompt text for
  a compare is read from `agent_versions.config_json.system_prompt`. A version is immutable once
  written, so this is as reproducible as a copy.
- **D5 — polling, not SSE.** A suite is a handful of sequential cases; `GET /eval-runs/:runId` every
  2 s while `running` is enough and avoids `RunBus` lifetime traps.
- **D6 — sidebar entry edits `client/src/vendor/ui/nav.ts` directly.** `vendor/ui` has no source
  package in this repo to mirror from (unlike `vendor/shared`), so this is the one sanctioned
  vendor edit; it is called out in the PR.
- **D7 — single-file frozen diff.** A case freezes only the finding's own file patch. Cheaper and
  deterministic; the trade-off is that a finding needing cross-file context may be harder to
  reproduce — such a case will show as a stable `fail`, which is still a valid regression signal.

- **D8 — the dataset is triaged live, not seeded.** On 2026-10-11 the local DB held 19 findings
  and **none** triaged. The 12 findings of **Test Quality Reviewer** (PRs #6 and #8) all have a
  stored `pr_files.patch`, so ≥ 8 cases come from triaging those in the UI — a mix of accept
  and dismiss, so both `must_find` and `must_not_flag` are exercised. No seed file invents cases.
- **D9 — the experiment.** Agent: Test Quality Reviewer, three suite runs on the same case set:
  **v1** current prompt (baseline); **v2** a deliberate prompt edit (expected: recall moves);
  **v3** the sensitivity break — append *"Flag every changed line that could possibly be
  improved, including style and naming."* — expected to put findings on dismissed lines and
  drop precision. Compare v1↔v2 and v1↔v3 in the Compare modal; the v1↔v2 screenshot and the
  screencast are the homework deliverables.
- **D10 — design alignment pulls four items into scope (Amendment 1).** After comparing the build
  with the mockups the user moved the dashboard redesign, the per-agent eval page, "Run all
  agents" and "Promote" into scope. The agent page reuses the existing read routes; only "Run
  all" and "Promote" add server routes. Promote follows the skills restore semantics (a new
  version, never a rewrite of history), so earlier eval runs keep pointing at the version they ran.

## Out of scope

- Skill-owned cases and with/without-skill ablation (`owner_kind = 'skill'` stays unused).
- Hand-written cases / a case editor ("New eval case" modal), editing a case, running one case.
- The agent page's date-range filter ("30 days") — every run is shown.
- An LLM judge of any kind; CI export of evals.
- Running the suite on a different model than the agent's own.

## Open questions

None open. Wide-range findings (e.g. `pr-gate.sh:1-222`) are kept as-is: they are what the
agent actually said and what was triaged, even though they match easily.
