# Eval regression experiment — does the eval pipeline catch a prompt regression?

**Date:** 2026-10-12 · **Branch:** `l06-hw-eval-editor` (PR #14) · **Plan:** `docs/plans/eval-pipeline.plan.md` AC32 / T17 (manual), T49–T50

## Question

If an agent's system prompt is edited, does a suite run show a recall or precision shift that a
person can trace back to that edit?

## Setup

- **Stack.** API on `:3101` and web on `:3100`, against an isolated Postgres database `devdigest_l06`
  (`db:migrate` + `db:seed`), so shared dev data was not touched.
- **Agent.** The seeded **Security Reviewer**: `openrouter/deepseek/deepseek-v4-flash`, version 1 = the
  seeded prompt.
- **Cases.** Four hand-written eval cases, created through `POST /agents/:id/eval-cases` (the case
  editor shipped in this branch). Each case has one expectation, scored by code, not by a model:

| Case | Type | Expectation |
|---|---|---|
| `sqli-raw-email-lookup` | `must_find` | `server/src/modules/users/repository.ts:12-14` — user input interpolated into `sql.raw` |
| `hardcoded-admin-password` | `must_find` | `server/src/modules/admin/auth.ts:3-7` — hard-coded admin password compared in plain text |
| `benign-local-rename` | `must_not_flag` | `server/src/modules/reports/format.ts:21-22` — a local rename |
| `benign-log-message` | `must_not_flag` | `server/src/modules/sync/job.ts:41` — a log line |

- **Runs.** One suite run per agent version (`POST /agents/:id/eval-runs`). Versions were compared with
  `GET /eval-runs/compare`.

## Results

| Version | Prompt change | Recall | Precision | Cases passed | Cost | Run id |
|---|---|---|---|---|---|---|
| v1 | seeded prompt (baseline) | 1.0 | 1.0 | 4/4 | $0.00089 | `b2999286` |
| v2 | appended "report only performance problems; security is out of scope" | 1.0 | 1.0 | 4/4 | $0.00119 | `b45e6b18` |
| v3 | appended "report a finding for EVERY added or changed line; never return an empty list" | 1.0 | **0.6** | 3/4 | $0.00169 | `3b48ace4` |
| v4 | prompt **replaced** by a performance-only reviewer | **0.5** | 1.0 | 3/4 | $0.00066 | `349031dc` |

**v1 → v3 (precision).**
- Compare reports `delta.precision = −0.4` and one flip: `benign-local-rename` pass → fail.
- The agent flagged both renamed lines, and those findings landed inside the `must_not_flag` range.
- `benign-log-message` still passed. Its one new finding fell outside the protected line, so it did
  not match.
- The `prompt_diff` in the Compare response lists the added v3 lines.

**v1 → v4 (recall).**
- Compare reports `delta.recall = −0.5` and one flip: `hardcoded-admin-password` pass → fail.
- The performance-only prompt returned no finding for the hard-coded secret.
- It still flagged the raw-SQL lookup, so `sqli-raw-email-lookup` kept passing.

**v1 → v2 (no shift).**
- Every metric delta is 0 and there are no flips.
- The "security is out of scope" line, appended at the end of a long security-focused prompt, did not
  change what the model reported.
- So the eval also caught a prompt edit that **had no effect**, which is a result in its own right:
  without the suite, that edit would have looked like a working scope change.

## What this shows

- The suite separates the two failure modes. Over-flagging moves **precision** and fails a
  `must_not_flag` case (v3). Under-flagging moves **recall** and fails a `must_find` case (v4).
- In each regression, Compare names the case that flipped. It also shows the prompt diff that caused
  the flip.
- Scoring is code-only: line overlap against the frozen expectation, after the grounding gate. The
  numbers are therefore reproducible for a given model output.
- One run per version on four cases is a demonstration, not a statistical measure. LLM output varies
  between runs. A gating decision needs repeated runs and a larger set.

## Live checks done in the same session

| Check | Result |
|---|---|
| e2e flows on the live stack (`E2E_BASE_URL=http://localhost:3100 pnpm --dir e2e test`) | **11/11 passed**, including flow 11's new steps ("New eval case" → "Run case" → Cancel) — T49 |
| One-case run (`POST /eval-cases/:id/runs`) | `202`; the case list reported `running: true`, then `pass` and "got 1"; run history unchanged (4 runs); the one-case run id gives `404` on run detail (AC52–AC56) |
| Dry run (`POST /agents/:id/eval-cases/dry-run`) | `200`, `pass`, grounding kept 1 / dropped 0, $0.0003; case count unchanged (AC57–AC58) |
| Prompt restore | The baseline prompt was restored as version 5 (identical to version 1) |

**Not checked live:**
- The FindingCard → `EvalCaseModal` path. A fresh seed has no stored patch, so no draft exists.
- The keyboard and focus behaviour of the modal. The browser extension was not connected.

Both are covered by RTL tests (T44, T47) and remain on the T50 manual list.
