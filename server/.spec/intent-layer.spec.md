# Intent Layer — `server`

## Goal

Before any review, derive a structured, persisted, per-head-SHA intent for each PR
(summary, in-scope, out-of-scope, confidence, sources with missing-context flags) with one
cheap OpenRouter call that never sees diff bodies, then inject it into the reviewer prompt
and mechanically filter out-of-scope findings while always leaving one signal for a serious
one.

## Acceptance criteria

1. **AC1 — Separate cheap classifier call.** Deriving an intent makes exactly one structured
   LLM call (plus at most one schema-repair retry), separate from every review call. The
   provider/model for feature `review_intent` is resolved: workspace override, then the
   registry default, then `CHEAP_CHOICES`, filtered to providers `container.canUseLlm`
   reports usable. The call returns `{ summary, in_scope[], out_of_scope[], confidence }`,
   persisted as `Intent.intent` (= summary), `in_scope`, `out_of_scope`, `confidence`.
2. **AC2 — Inputs, no diff bodies.** Classifier inputs are the PR title/body, linked
   issue(s), fetched plan/spec docs, and the changed-file list with per-file `+a/-d` counts
   and hunk-header lines only (`@@ -a,b +c,d @@ <context>`). No diff body line (`+`/`-`/space
   prefix) ever appears in the classifier prompt.
3. **AC3 — Empty body → lower confidence.** An empty/whitespace/<30-char PR body still lets
   the classifier run from title + file names + hunk headers. If no other source was
   fetched either, the stored confidence is `low`.
4. **AC4 — Referenced sources are fetched.** GitHub closing-issue references (GraphQL +
   body regex), `#N` / `owner/repo#N` / issue URLs, `blob`/`raw.githubusercontent.com` URLs,
   and repo-relative doc paths (`*.spec.md`, `*.plan.md`, `docs/**/*.md`) are resolved and
   fetched through the GitHub adapter, recorded in `sources[]` with `status: "used"`.
5. **AC5 — Missing context is flagged, never invented.** An unfetchable referenced source
   stays in `sources[]` with `status: "missing"` or `"not_fetched"` and a `reason`.
   `missing_context` becomes `true`, confidence is capped at `medium`, and the classifier
   prompt lists missing sources by ref with an instruction not to infer their content.
6. **AC6 — SSRF-safe fetching.** No PR-supplied URL is ever requested directly. Only
   `github.com` / `raw.githubusercontent.com` (https, no userinfo, no port, same repo
   owner) are translated into `GitHubClient` calls; everything else is `not_fetched`. Caps:
   ≤ 8 fetched sources, ≤ 64 KiB raw per file (checked before decode), ≤ 8,000 chars per
   source in the prompt, 5 s per call, 15 s total source phase, no link-following in
   fetched docs.
7. **AC7 — Persistence and staleness.** One `pr_intent` row per PR stores `head_sha`,
   `model`, `derived_at`, `sources`. `GET /pulls/:id/intent` returns `stale: true` iff the
   stored `head_sha` differs from `pull_requests.head_sha`. `POST /pulls/:id/intent/derive`
   re-derives at the current head and replaces the row. `GET /pulls/:id` persists a changed
   `head_sha`.
8. **AC8 — Injection into review.** At review start the executor loads the intent once for
   all queued agents. Missing/stale → derive inline once. Derivation failure → every agent
   reviews without an intent block (never the stale one), logged in the Live Log. When
   available, the reviewer prompt carries a `## PR intent` block (`wrapUntrusted`) plus a
   trusted scope-tagging rule; `PromptAssembly.intent` is recorded in the run trace.
9. **AC9 — Out-of-scope filter.** Runs in `reviewer-core`, after `groundFindings` and before
   `scoreFromFindings`, only with an intent of confidence `medium`/`high`. `scope: "out"`
   findings are removed except exactly one *serious* one (`CRITICAL`, or `WARNING` +
   `category: "security"`), ranked by (severity, security-first, confidence, file,
   start_line); it keeps `scope: "out"`. Score is recomputed from the survivors of both
   gates. `RunStats.scope_filtered` records the filtered count.
10. **AC10 — Intent card.** The Overview tab renders an Intent card before Description:
    summary quote, IN SCOPE / OUT OF SCOPE columns, confidence chip, sources list with
    status/missing flags, stale badge, "Re-derive intent" action. No "Risk areas" section.
11. **AC11 — Model settings.** `review_intent` defaults to `openrouter` /
    `google/gemini-2.5-flash-lite` in both registries. Classifier calls send
    `require_parameters: true` to OpenRouter.
12. **AC12 — Observability without content.** Every derivation logs prompt section
    name/chars/token-estimate/truncated, chosen provider/model, total token estimate,
    actual `tokens_in`/`tokens_out`/`cost_usd`/`attempts`, duration, and the source list
    (kind, ref, status, reason, chars) — to pino, the run trace/Live Log, and
    `pr_intent.stats`. Never logs PR body, issue/doc/diff content, keys, or URL query
    strings.

## Contracts touched

`src/vendor/shared/contracts/brief.ts` (`IntentConfidence`, `IntentSourceKind`,
`IntentSourceStatus`, `IntentSource`), `contracts/review-api.ts` (`PrIntentRecord`,
`PrIntentResponse`), `contracts/findings.ts` (`Finding.scope`), `contracts/trace.ts`
(`PromptAssembly.intent`, `RunStats.scope_filtered`), `contracts/platform.ts`
(`review_intent` default), `adapters.ts` (`GitHubClient.getFileContent`,
`GitHubClient.listClosingIssueRefs`, `StructuredRequest.requireParameters`). Tables:
`pr_intent` (add `confidence`, `sources`, `head_sha`, `model`, `stats`, `derived_at`),
`findings` (add `scope`).

## Out of scope

"Risk areas" (`Risks`/`pr_brief`, unproduced). Jira/Linear/other tracker adapters — recorded
`not_fetched: no_adapter` only. A generic HTTP/web-fetch adapter; link-following inside
fetched docs. Background re-derivation on poll/webhook. Smart-diff, blast radius, PR brief
composition. Intent support in the CI agent-runner. Locales other than `en`. A per-agent/
workspace toggle to disable scope filtering. Recomputing the verdict after filtering.
Backfilling `scope` on existing findings.

## Open questions

None — resolved in the Development Plan (`docs/plans/intent-layer.plan.md`, rev 2), every
`Q1`–`Q8` at option (a).
