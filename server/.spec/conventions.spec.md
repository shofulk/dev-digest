# Conventions — `server`

## Goal

Scan a cloned repository for the house rules it **already follows**, propose each one with
the code that proves it, and let a maintainer triage the proposals and merge the accepted
set into a single `repo-conventions` skill — with the model doing nothing but proposing:
code picks what is read, and code verifies every citation before a row is written.

## Background

The design premise is one sentence: **a model is good at noticing a pattern and bad at
remembering where it saw it.** So the feature is three stages and only the middle one is a
model call.

```
configs + repo-intel            ONE cheap structured call          re-read the file
       │                                  │                                │
  ┌────▼─────┐  line-numbered  ┌──────────▼─────────┐  candidates  ┌───────▼───┐  pending rows
  │  SAMPLE  ├────listing─────►│      PROPOSE       ├─────────────►│  VERIFY   ├────────────►
  │  (code)  │                 │      (model)       │              │  (code)   │
  └──────────┘                 └────────────────────┘              └───────────┘
```

Already shipped and **not** part of this work:

- `conventions` table, extended with `category`, `rationale`, `evidence_line`, `status`,
  `created_at`, `conventions_repo_created_idx` and two CHECK constraints
  (`src/db/schema/knowledge.ts`); `ConventionRow` in `src/db/rows.ts`. Migrations `0013` +
  `0014` are generated **and** applied — no `db:generate`, no `db:migrate` in this task.
- Contracts `ConventionCategory`, `ConventionStatus`, `ConventionCandidate`,
  `ConventionExtractResult`, `ConventionSkillDraft` in
  `src/vendor/shared/contracts/knowledge.ts`, mirrored byte-identically into
  `client/src/vendor/shared/contracts/knowledge.ts`.
- `container.reposRepo` (a `RepoRepository` getter) in `src/platform/container.ts`.
- `resolveFeatureModel(container, workspaceId, 'conventions')` in
  `src/modules/_shared/feature-models.ts` (moved out of `modules/settings/`), fed by the
  `FEATURE_MODELS.conventions` entry in Settings.
- `repoIntel.getConventionSamples(repoId, n)` (`modules/repo-intel/service.ts:630`) — top-N
  ranked paths minus tests / configs / migrations.
- `POST /skills/extracted` (`modules/skills/routes.ts:110`, `service.ts:createExtracted`) —
  creates a skill with `source: 'extracted'`, `enabled: true`, `evidence_files` recorded.
  This feature **consumes** it; it is not rebuilt here.
- The additive single-link form of `POST /agents/:id/skills` (`{ skill_id, order? }`,
  `modules/agents/routes.ts:172`) — link one skill without touching the agent's other links.
- `RunBus` (`src/platform/sse.ts`) with a replay-first SSE stream, already served for runs at
  `GET /runs/:id/events` (`modules/reviews/routes.ts:49`).
- `MockLLMOptions.structuredBySchema` (`src/adapters/mocks.ts`), which already names this
  feature's schema — the hermetic test seam.

Missing: the whole `src/modules/conventions/` module and its registration.

## Acceptance criteria

### A. Sampling — stage 1, pure code

1. `CONFIG_SAMPLE_PATHS` (`constants.ts`) is read first, in a fixed order:
   `package.json`, `tsconfig.json`, `.eslintrc*` / `eslint.config.*`, `.prettierrc*`,
   `.editorconfig`, `biome.json`, `CONTRIBUTING.md`, `CLAUDE.md`, `AGENTS.md`. A path that
   does not exist is skipped silently — a missing `biome.json` is not an error.
2. The source sample is `repoIntel.getConventionSamples(repoId, 12)`, appended after the
   configs. The model is never asked which files to read, and never sees a file listing it
   could ask to expand.
3. Every file is read through `container.git.readFile(repoRef, path)` — the git adapter, and
   the clone path it owns. The module contains no `node:fs` import; that is what keeps the
   read inside the repo's checkout and inside the DI container.
4. Each file is truncated to `MAX_SAMPLE_LINES = 220` lines and `MAX_SAMPLE_CHARS = 12_000`
   chars, whichever hits first, and the concatenated sample to `MAX_TOTAL_CHARS = 90_000`
   chars. A file that would cross the total budget is dropped whole, never half-rendered.
5. Every sampled file is rendered with a **1-based line-number gutter** under a
   `--- <path> ---` header. The gutter is the entire reason a citation can be checked
   mechanically, so its absence is a bug, not a cosmetic issue.
6. A repo with nothing readable — not cloned, or every candidate path missing — fails with
   `422` and a message telling the user to clone and index the repo first, **before** any
   model call is made. No row is written and no cost is incurred.
7. Rendering, truncation and budgeting are pure functions in `helpers.ts` taking
   `{ path, content }[]` and returning a string — no `container`, no I/O, unit-testable
   without Docker or a clone.

### B. Proposal — stage 2, the only model call

8. Exactly **one** `llm.completeStructured` call per scan, with
   `schemaName: 'ConventionExtraction'` and `temperature: 0.1`, on the model returned by
   `resolveFeatureModel(container, workspaceId, 'conventions')`. Picking a cheap model is a
   user setting, not a constant in this module.
9. `prompt.ts` defines `ExtractionSchema` and the system prompt. The prompt states what
   counts as a house rule, names the anti-patterns to **not** return (universal advice,
   framework requirements, evidence that is a single trivial line), defines each of the
   eight `ConventionCategory` values, fixes the confidence bands, caps the answer at 12
   candidates, and says outright that an ungrounded candidate will be discarded.
10. **Schema field order is load-bearing and must not be "tidied".** `rule` and the evidence
    fields come first, then a self-reported `occurrences` count, and only then `category` and
    `confidence`. Field order is generation order: a model that commits to a label before it
    has written the rule collapses to one category and a flat confidence. Measured on a live
    scan of `angular-osf`: `category` first → 1 of 8 categories, 0.90 for all 12; `category`
    last → 5 of 8 categories, 0.50–0.95.
11. The scan never makes a second model call. Everything after this step is code.

### C. Verification — stage 3, the evidence gate, pure code

12. `verifyCandidate()` in `helpers.ts` resolves the cited path against the **sampled** set:
    exact match first, then a **unique** suffix match (`src/a/b.ts` matches `./src/a/b.ts`
    and `b.ts`). An ambiguous suffix — two sampled paths ending the same way — is **not**
    resolved and the candidate is dropped. Guessing would defeat the gate.
13. A snippet with fewer than `MIN_SNIPPET_CHARS = 8` non-whitespace characters is dropped.
    `}` identifies nothing.
14. The snippet's first meaningful line must really occur in the file, compared
    whitespace- and case-insensitively. No occurrence → dropped, counted in
    `dropped_ungrounded`. This is a code check, not a confidence penalty.
15. A **wrong line number is corrected, not fatal**: among the occurrences, the one nearest
    the claimed line wins and `evidence_line` is set to that 1-based line. Miscounting is a
    formatting slip; inventing code is not.
16. The persisted `evidence_snippet` is **re-sliced from the file** and dedented — never the
    text the model returned. The UI therefore cannot show a paraphrase as if it were code.
17. Survivors are sorted by `confidence` descending and deduped against each other **and**
    against every rule already stored for the repo with `status` `accepted` or `rejected`.
    The dropped count lands in `dropped_duplicate`.
18. `ConventionExtractResult` reports `proposed`, `dropped_ungrounded`, `dropped_duplicate`,
    `sampled_files`, `model` and `cost_usd`, so 3 kept out of 12 proposed reads as "the gate
    worked", not "the feature is broken".

### D. Persistence and triage

19. `repository.ts` touches the `conventions` table only, and every read and write is scoped
    by `workspaceId`. A row of another workspace is indistinguishable from a missing one:
    `404`, never `403`, never a partial leak.
20. `replacePending(workspaceId, repoId, rows)` deletes only rows whose `status` is
    `'pending'` for that repo, then inserts the new candidates as `pending` in one
    transaction. Rows that are `accepted` or `rejected` survive every re-scan, so a rule the
    user dismissed is never re-proposed.
21. `GET /repos/:id/conventions` returns that repo's candidates newest first (the
    `conventions_repo_created_idx` order) as `ConventionCandidate[]`, in all three statuses —
    filtering by status is the client's job.
22. `PATCH /conventions/:id` accepts `{ status?, rule?, rationale?, category? }` and returns
    the updated `ConventionCandidate`. It is both the accept/reject control and the inline
    editor. Evidence fields (`evidence_path`, `evidence_line`, `evidence_snippet`,
    `confidence`) are **not** patchable — they are the gate's output, not the user's opinion.
23. `DELETE /conventions/:id` removes one candidate and returns `204`. Deleting is not
    rejecting: a deleted rule can come back on the next scan, a rejected one cannot.

### E. The scan endpoint and its progress stream

24. `POST /repos/:id/conventions/scan` returns **`202`** with `{ scan_id }` immediately and
    runs the scan detached. A scan is a clone read plus a model call; holding an HTTP request
    open for it is how the feature times out behind a proxy.
25. `scan_id` is a synthetic id minted per scan (`conv_<uuid>`). It is **not** a row: no new
    table, no `agent_runs` row, no `JobRunner` enqueue.
26. `GET /conventions/scans/:id/events` is an SSE stream over the existing `RunBus`, keyed by
    that `scan_id`, replay-first exactly as `GET /runs/:id/events` is: a client that connects
    after the scan started still receives every event, and the stream ends on the terminal
    event.
27. The scan publishes, in order: `sampling` (with the file count), `proposing` (with the
    model id), `verifying`, and a terminal `done` carrying the full
    `ConventionExtractResult`, or `error` with a human-readable message. A failed scan writes
    no rows and leaves the existing candidates untouched.
28. Two concurrent scans of the same repo are two different `scan_id`s and two independent
    streams; neither can see the other's events.

### F. The skill draft

29. `POST /repos/:id/conventions/skill` returns a `ConventionSkillDraft` built from that
    repo's `accepted` candidates and **persists nothing**. Same preview-then-confirm flow as
    skill import: the user edits every field before the skill exists.
30. The draft is **one merged skill**, named `<repo-slug>-conventions`, whose body groups the
    accepted rules under a `## <Category>` heading per category, each rule rendered with its
    rationale and its verified `path:line` evidence snippet in a fenced block.
    `evidence_files` is the deduped set of cited paths; `convention_ids` is the set of rows
    the body came from, so the client can show what it is about to turn into a skill.
31. Assembly is a pure function in `helpers.ts` (`buildSkillDraft(repo, rows)`), unit-tested
    on fixture rows with no database.
32. A repo with **zero** accepted candidates returns `422` with a message saying to accept at
    least one rule first — not an empty skill.
33. The draft is persisted by the client posting it to the existing `POST /skills/extracted`.
    This module writes no row in `skills`, `skill_versions` or `agent_skills`.

### G. Module shape and layering

34. Layout — one self-contained Fastify plugin registered with one import and one entry in
    `modules/index.ts`:

    ```
    src/modules/conventions/
      constants.ts    CONFIG_SAMPLE_PATHS, sample/line/char caps, MIN_SNIPPET_CHARS, SAMPLE_N
      prompt.ts       ExtractionSchema ('ConventionExtraction') + the system prompt
      helpers.ts      PURE: gutter rendering, budgeting, verifyCandidate, dedupe, DTO, draft
      repository.ts   the `conventions` table only, workspace-scoped, replacePending
      service.ts      the three stages + the detached scan
      routes.ts       the six endpoints
    ```

35. `ConventionsService` resolves **every** dependency in its constructor — `git`,
    `repoIntel`, `reposRepo`, `bus`, its own repository. A method body containing
    `this.container.<x>` is the exact anti-pattern `onion-architecture` forbids. `private
    container` is kept **only** for `container.llm(provider)` and `resolveFeatureModel`,
    both of which are per-call by nature.
36. Every route carries a `response:` schema and one Zod contract drives **both** request
    validation and response serialization through `fastify-type-provider-zod`. No
    hand-written second response shape, anywhere.
37. Request bodies (`ScanBody`, `PatchConventionBody`, `SkillDraftBody`) live in the module.
    Response shapes come from `@devdigest/shared`.
38. `pnpm --dir server arch` stays at **0 errors / 17 warnings**. In particular, the module
    never imports another module's internals: it reaches `repo-intel` through the container,
    and it does not import `SkillsService`.

### H. Routes, summarised

```
GET    /repos/:id/conventions          → ConventionCandidate[]
POST   /repos/:id/conventions/scan     → 202 { scan_id }, detached
GET    /conventions/scans/:id/events   → SSE over RunBus (sampling/proposing/verifying/done)
POST   /repos/:id/conventions/skill    → ConventionSkillDraft (writes nothing)
PATCH  /conventions/:id                → ConventionCandidate (accept / reject / edit)
DELETE /conventions/:id                → 204
```

## Tests

Hermetic (no Docker, no network) — `test/conventions-helpers.test.ts`:

- gutter rendering is 1-based and the numbers match the sliced content;
- per-file and total budget cut-offs, including the drop-whole-file rule;
- every gate outcome: exact path, unique suffix, **ambiguous suffix → dropped**, short
  snippet → dropped, snippet absent → dropped, snippet present at a different line → line
  **corrected** and the snippet re-sliced from the file;
- dedupe against each other and against already-decided rows;
- `buildSkillDraft` grouping, `evidence_files` dedupe, and the empty-accepted case.

DB-backed — `test/conventions.it.test.ts` (testcontainers, `*.it.test.ts` only):

- a scan whose mocked `ConventionExtraction` reply contains one invented candidate stores the
  grounded ones and reports `dropped_ungrounded: 1`;
- a re-scan replaces only `pending` rows: an accepted and a rejected rule survive and the
  rejected one is not re-proposed;
- `PATCH` edit → `POST …/conventions/skill` → `POST /skills/extracted` produces a skill whose
  body contains the edited rule text;
- `422` on an unsampleable repo (before any model call) and on a draft with nothing accepted;
- cross-workspace reads, patches and deletes are `404`, proven with a second-workspace
  fixture.

`test/routes-smoke.test.ts` — the six routes are registered.

## Decisions

- **One merged `<repo>-conventions` skill, not one per category.** A reviewing agent gets one
  block of house rules; eight three-line skills would be eight rows to link, eight prompt
  headings and eight sets of stats for what is one document. The category grouping survives
  as headings inside the body, where it is useful and free.
- **`status` is a three-state enum, not a boolean.** A boolean cannot distinguish "rejected"
  from "not yet seen", so every re-scan would re-propose the rules the user has already
  dismissed, and the feature would get more annoying the more it was used. The three states
  are what make `replacePending` correct.
- **SSE over `RunBus` with a synthetic scan id, not `JobRunner`.** The `JobRunner` in
  `platform/jobs.ts` is constructed once with `timeoutMs: 120_000, retries: 2` and exposes no
  per-enqueue override. A scan of a large repo on a slow cheap model would be killed at 120 s
  and then retried twice — up to **3× the model spend** for a scan the user already sees
  failing. `RunBus` gives the progress stream with no new table and no new lifecycle.
- **`agent_runs` is deliberately not reused for a scan**, even though its columns are
  nullable enough to allow it. Those rows feed the PR cost rollups, the run history list and
  `/runs/:id/trace`; a convention scan is none of those things and would show up as a phantom
  review in all three.
- **`POST /skills/extracted` lives in the skills module, not here.** Calling `SkillsService`
  from `modules/conventions` violates `no-cross-module-internals`, and routing it through the
  container would create a `container ↔ skills/service` cycle. The client makes the second
  call; that is one extra request and zero architectural debt.
- **The evidence gate is code, never a second model.** A candidate whose snippet is not in
  the cited file is *dropped*, not marked low-confidence. A gate a model can talk its way
  past is not a gate.
- **The snippet shown is re-read from the file.** Trusting the model's own quote would let a
  plausible paraphrase render as if it were the repo's code — the exact failure the feature
  exists to prevent.
- **A wrong line is corrected; invented code is not.** The two failures are not the same kind
  of mistake and must not have the same consequence.
- **The scan counters are part of the contract**, not debug output. Without
  `dropped_ungrounded` a strict gate is indistinguishable from a broken feature.

## Out of scope

Everything below is quality roadmap, and the roadmap is deliberately about **feeding the gate
more real signal**, not loosening it:

- **Git history as evidence** — mining review comments and repeated fix-up commits (`git log
  -p` over high-churn files), and DevDigest's own `findings` table, for rules someone has
  already asked for twice.
- **Sampling by diversity rather than rank alone** — bucketing by directory and file kind
  (route / service / repository / component / test) and taking the top-N per bucket. Today's
  top-12 are the most central files and are often the same layer.
- **Including tests in the sample.** `getConventionSamples` filters them out — right for
  review context, wrong here, since testing conventions are among the most useful rules.
- **A two-step model dialogue** (`ConventionFileSelection` before `ConventionExtraction`),
  letting the model *rank* a code-built list of 100 paths without ever browsing.
- **Frequency as the confidence signal** — `ripgrep` the rule's shape across the repo via the
  existing `CodeIndex` adapter and show "42 occurrences" instead of a self-reported score.
  The single highest-leverage upgrade on this list.
- **Counter-example search** ("holds in 38 files, 3 break it") and **contradiction checks**
  against skills already in the Skills Lab.
- **Learning from rejections** — feeding dismissed rule texts into the next scan's prompt as
  labelled negatives.
- **Scheduled / on-merge scans** diffing against the previous scan, and **closing the loop
  through review outcomes** (a convention whose findings keep being dismissed is a bad rule).

Also out of scope: per-category skills, a scan history table, cost attribution per candidate,
and any write to `skills` / `agent_skills` from this module.

## Open questions

- `skills.evidence_files` is written by `POST /skills/extracted` but nothing reads it yet.
  It is the natural anchor for the frequency and counter-example work above; left populated
  and unread on purpose.
- The dedupe is textual (normalised rule string). Two phrasings of the same rule will both
  survive until the frequency signal lands. Accepted: a duplicate is one reject click, a
  false merge is a lost rule.
- `confidence` is the model's self-report and is displayed as such. It orders the list and
  nothing else — no threshold drops a candidate on confidence alone, because the gate is the
  only thing allowed to drop.
- A scan is not cancellable. The `scan_id` has no DELETE; closing the SSE stream stops the
  client watching, not the model call. Revisit if scans get slow enough to matter.
