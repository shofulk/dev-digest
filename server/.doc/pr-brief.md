# PR Brief

One grounded, single-model-call PR Brief per pull request — a summary, up to
6 risk areas and up to 5 review-focus items, each cited by file and (where it
survives grounding) line, generated as a background job with live SSE
progress and stored in `pr_brief` keyed by the head SHA it describes.

## Decision

Keep the model call strictly cheap and strictly bounded, and never trust it
for a file/line a reviewer could be sent to read:

- **The model never reads diff code.** `facts.ts` describes every changed
  file only by its path, additions/deletions and hunk *header* lines
  (`extractHunkHeaders`, the `_shared/intent/prompt.ts` precedent) plus PR
  totals — never a hunk body line (AC-2). The fact set otherwise reuses what
  the product already computed: the stored intent, the blast-radius summary,
  the PR title/description, the not-dismissed findings of the newest
  `review`-kind review per agent (title/severity/file/line only — never
  rationale or suggestion text, AC-9), and the project-context documents of
  every enabled agent and its enabled skills, read through
  `resolveProjectContext` from the repository's default-branch checkout
  (never the PR head, so a PR can't rewrite the rule it's reviewed against).
- **The budget is measured on the rendered prompt, not on raw facts.** A
  draft version of `fitToBudget` counted tokens on the raw fact fields; the
  actual prompt — system instructions, the injection guard, every
  `<untrusted source="…">` wrapper, headings — runs measurably larger than
  its content. `fitToBudget` now takes the real `renderBriefMessages` as a
  render callback and measures the candidate fact set after rendering, so
  `BRIEF_INPUT_TOKEN_BUDGET` (8,000 tokens, `server/src/modules/brief/constants.ts`)
  bounds what the model actually receives, not an estimate of it. Trimming
  drops whole items, in order: project-context documents from the end, then
  findings from the lowest severity up (`SEVERITY_DROP_ORDER: readonly
  Severity[] = ['SUGGESTION', 'WARNING', 'CRITICAL']`, `facts.ts:249` — the
  real `Severity` enum values, not the words "low"/"medium"/"high"), then
  changed files from the end of the list — each drop recorded as a `trimmed`
  missing input.
- **Grounding checks every reference before storage, and drops rather than
  rewrites.** A risk's file reference survives only if the file is a changed
  file (kept against its hunk ranges) or a blast-caller file that is not
  itself changed (kept against the caller lines of that file,
  `server/src/modules/brief/grounding.ts`) — a line range that doesn't
  overlap a real hunk or caller line is not corrected, it's dropped back to
  a bare path; a file that is neither is dropped entirely; a risk left with
  no reference after that is dropped outright. Blast-caller lines belong to
  the index's `indexed_sha`, not the PR head — grounding a changed file
  against hunks and a blast-only file against caller lines are two separate
  checks for exactly that reason (server `INSIGHTS.md`, 2026-09-28). A review
  focus item's file must be a changed file or it is dropped; a line outside
  every hunk range keeps the item but clears the line, since the file itself
  is still a legitimate place to start reading.
- **The job is detached, not `JobRunner`-managed, and never retried.** A paid
  model call going through `JobRunner`'s normal 2-retries-at-120s shape would
  silently double- or triple-bill one generation. Instead `BriefService`
  starts a plain `void runJob(...)` keyed by a `randomUUID()` on
  `container.runBus`, wraps the one `llm.completeStructured(...)` call in
  `withTimeout(…, 90_000)` with `maxRetries: 1` (a schema-repair reprompt,
  not a second paid attempt), and lets any failure — timeout, model error, or
  anything else — end the job `failed` with a fixed code/message (never raw
  error text) while leaving a previously stored brief untouched. `running`
  (one job per PR) and `jobs` (every job ever started, for late-subscriber
  replay and `assertJob`'s 404) live only in `BriefService`'s own memory —
  deliberately, A-4/EC-14 accepts that a server restart loses the running job
  and the stored brief stays exactly as it was.
- **The injection guard is local to this module, not shared with
  `reviewer-core`.** `reviewer-core`'s `INJECTION_GUARD` is module-private
  and review-specific text ("REPORT it as a finding"), and the spec's
  non-goals rule out touching `reviewer-core` for this feature. `prompt.ts`
  exports its own `BRIEF_INJECTION_GUARD` stating the same rule — untrusted
  content is data, never instructions, and claims that content is a demo/
  test/not-for-production never change what gets reported — following the
  intent classifier's own inline-guard precedent
  (`server/src/modules/_shared/intent/prompt.ts`). Every untrusted value (PR
  title/description, intent text and scope lists, finding titles/files,
  document text, file paths, hunk headers, blast symbol/caller names) is
  wrapped with `wrapUntrusted(sanitiseLabel(label), text)` before it enters
  the user message.

## Alternatives considered

- **Reuse `reviewer-core`'s `INJECTION_GUARD` directly.** Rejected: it isn't
  exported from the package's public surface and its wording assumes a
  review context. Duplicating one short constant was cheaper than exporting
  and generalising reviewer-core's guard for a single caller outside its
  non-goals.
- **Run the generation job through `JobRunner`.** Rejected: `JobRunner`'s
  retry policy exists for idempotent, cheap-to-retry work; retrying a paid
  structured LLM call on failure is exactly the double-billing risk NFR-5
  rules out. A detached `RunBus`-keyed task with no retry logic anywhere in
  its own code was simpler than adding a per-enqueue retry override to
  `JobRunner` for one caller.
- **Correct an ungrounded model reference instead of dropping it** (e.g.
  clamp an out-of-range line to the nearest hunk boundary). Rejected: a
  "corrected" reference is still the model's guess, and a reviewer who clicks
  it would be sent to code the model never actually grounded. Dropping the
  line (keeping the file) or dropping the whole reference is honest about
  what the model's claim was actually checked against.
- **Measure the token budget on raw fact fields.** Tried first, then
  replaced: the rendered prompt (system prompt, injection guard, untrusted
  wrappers, headings) runs measurably heavier than its content alone, so a
  raw-field estimate let the real prompt exceed the 8,000-token budget in
  practice. Measuring the actual rendered messages closed that gap at the
  cost of rendering the candidate fact set once per trim step.

## Generation sequence

```mermaid
sequenceDiagram
  participant C as client (BriefBanner, useBriefJob)
  participant R as routes.ts
  participant S as BriefService
  participant D as pr_brief / pull_requests
  participant M as model (risk_brief)
  C->>R: POST /pulls/:id/brief/generate
  R->>S: generate(workspaceId, prId, { force })
  S->>D: getPull, getPrFiles, getBrief (current)
  alt job already running for this PR
    S-->>R: started, existing job_id, reused=true
  else brief current and not forced
    S-->>R: current, stored brief
  else start a new job
    S->>S: running.set(prId, jobId); bus.publish('assembling')
    S-->>R: started, new job_id, reused=false
    R-->>C: 202 { job_id, reused }
    C->>R: GET /pulls/:id/brief/jobs/:jobId/events (SSE)
    S->>S: runJob: buildBriefFacts, fitToBudget
    S->>S: bus.publish('calling_model')
    S->>M: completeStructured(PrBriefDraft) — one call, maxRetries 1
    M-->>S: draft (summary, risks, review_focus)
    S->>S: bus.publish('grounding'); groundDraft against hunks/blast
    S->>S: bus.publish('saving')
    S->>D: saveBrief(grounded PrBrief)
    S->>C: bus.publish('done', brief) — stream closes
  end
```

Grounded in: `server/src/modules/brief/service.ts:79-121` (generate flowchart
order), `server/src/modules/brief/service.ts:142-304` (`runJob` phases, one
model call, save-only-after-grounding), `server/src/modules/brief/routes.ts:44-83`
(the three routes and the SSE handoff).
