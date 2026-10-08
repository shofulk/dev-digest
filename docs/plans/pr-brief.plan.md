# Development Plan: pr-brief

**Spec:** `specs/pr-brief.spec.md` · **Packages:** server, client, e2e · **Base:** edccd7c · **Revision:** 1 · **Execution mode:** multi-agent

## Goal
Generate one grounded, single-model-call PR Brief per pull request as a background job with SSE progress. Store it in `pr_brief` with its head SHA and spend, and show it on the Overview tab as a banner, Risk areas inside the Intent card, and a Review focus card whose items open the Files changed tab at the cited file and line.

## Acceptance criteria
1. **AC-1** — [server] WHEN a generation job builds the fact set, the server shall include the PR title and description, the stored intent, the blast-radius summary, the diff statistics, the review findings input and the resolved project-context documents, and shall make no model call while it builds it. *Verify: unit*
2. **AC-2** — [server] The fact set shall describe the diff only by changed file paths, per-file additions and deletions, hunk header lines and PR totals, and shall contain no line of a hunk body. *Verify: unit*
3. **AC-3** — [server] IF the PR has no stored intent, THEN the server shall build the brief without it, make no extra model call, and add `intent: missing` to the missing inputs. *Verify: unit*
4. **AC-4** — [server] IF the stored intent is stale, THEN the server shall put it in the fact set marked as stale, and add `intent: stale` to the missing inputs. *Verify: unit*
5. **AC-5** — [server] IF the blast-radius response is degraded, THEN the server shall put its summary in the fact set and add `blast: degraded` with the degraded reason to the missing inputs. *Verify: unit*
6. **AC-6** — [server] IF the PR description is empty, THEN the server shall add `description: missing` to the missing inputs. *Verify: unit*
7. **AC-7** — [server] IF the PR has no review findings input, THEN the server shall build the brief without findings and add `findings: missing` to the missing inputs. *Verify: unit*
8. **AC-8** — [server] IF the PR's `last_reviewed_sha` differs from its current `head_sha`, THEN the server shall still pass the review findings input marked as stale, tell the model that their lines may have moved, and add `findings: stale` to the missing inputs. *Verify: unit*
9. **AC-9** — [server] The server shall pass for each review finding only its title, severity, file and line range, and shall not pass its rationale or suggestion text. *Verify: unit*
10. **AC-10** — [server] WHEN the server resolves project-context documents for a brief, the server shall take the union of the documents attached to every enabled agent of the workspace and to their enabled skills, keep each path once, and read each one from the repository's default-branch checkout. *Verify: unit + it*
11. **AC-11** — [server] IF a project-context document is missing, too large, has an invalid path, or does not fit the brief's document budget, THEN the server shall skip it with the SPEC-01 reason (`missing`, `too_large`, `invalid_path`, `budget`) and list it in the missing inputs. *Verify: unit*
12. **AC-12** — [server] WHEN a generation job runs, the server shall send exactly one structured request to the model, and shall count a schema-repair attempt inside that request as an attempt of the same request. *Verify: unit*
13. **AC-13** — [server] The server shall choose the provider and model through the `risk_brief` feature model: the workspace override first, then the cheap fallbacks, and only a provider that is configured. *Verify: unit*
14. **AC-14** — [server] IF the fact set is larger than the input token budget, THEN the server shall drop whole items in this order until it fits: project-context documents from the end, then review findings from the lowest severity, then changed files from the end of the file list, and shall list each dropped part as trimmed in the missing inputs. *Verify: unit*
15. **AC-15** — [server] The server shall store at most 400 characters of summary, at most 6 risks and at most 5 review focus items, and shall cut longer model output to these limits. *Verify: unit*
16. **AC-16** — [server] The server shall store each risk with a `kind` from the closed list `auth_surface`, `dependency`, `performance`, `data_migration`, `api_contract`, `config_secrets`, `test_coverage`, `other`, a title, an explanation, a severity (`high`, `medium`, `low`) and at least one file reference. *Verify: unit*
17. **AC-17** — [server] IF the model returns a risk `kind` that is not in the closed list, THEN the server shall store the risk with `kind: other` and shall not drop it. *Verify: unit*
18. **AC-18** — [server] IF a risk file reference names a file that is neither a changed file nor a blast-caller file, THEN the server shall drop that reference. *Verify: unit*
19. **AC-19** — [server] IF a risk reference to a changed file has a line range that does not overlap any hunk range of that file, THEN the server shall keep the file and remove the line range. *Verify: unit*
20. **AC-20** — [server] IF a risk reference to a blast-caller file that is not a changed file has a line that is not the line of a blast caller in that file, THEN the server shall keep the file and remove the line. *Verify: unit*
21. **AC-21** — [server] IF a risk has no file reference left after grounding, THEN the server shall drop the risk. *Verify: unit*
22. **AC-22** — [server] IF a review focus item names a file that is not a changed file, THEN the server shall drop the item. *Verify: unit*
23. **AC-23** — [server] IF a review focus item has a line that is outside every hunk range of its file, THEN the server shall keep the item with its file and reason and remove the line. *Verify: unit*
24. **AC-24** — [server] The server shall ground the model output before it stores the brief, so that no reference that failed grounding is stored or returned. *Verify: unit + it*
25. **AC-25** — [server] WHEN a generation succeeds, the server shall store one brief per PR in `pr_brief` with the head SHA it describes, the provider and model, the generation time, and stats with tokens in, tokens out, cost in USD, attempts and duration. *Verify: it*
26. **AC-26** — [server] WHEN the client reads the brief of a PR, the server shall return the stored brief or `null`, the PR's current head SHA, an `outdated` flag, and the running generation job or `null`, and shall make no model call. *Verify: it*
27. **AC-27** — [server] IF a generation fails or its job is lost, THEN the server shall keep the previously stored brief unchanged and shall store no part of the failed result. *Verify: it*
28. **AC-28** — [server] IF a generate request comes without `force` and the stored brief is not outdated, THEN the server shall return the stored brief, start no job and make no model call. *Verify: it*
29. **AC-29** — [server] The server shall record the brief's spend only in the brief's stats, and shall not write an `agent_runs` row or change any PR cost total for it. *Verify: it*
30. **AC-30** — [server] WHEN the user asks to generate or regenerate a brief, the server shall answer at once with a job id and start the generation job in the background. *Verify: it*
31. **AC-31** — [server] IF a generation job is already running for the PR, THEN the server shall answer a new generate request with the id of the running job, and shall not start a second job. *Verify: it*
32. **AC-32** — [server] The generation job shall make at most one model request, shall not be retried by the job runner, and shall end as failed when that request fails. *Verify: unit*
33. **AC-33** — [server] WHILE a generation job runs, the server shall send one SSE event per phase (`assembling`, `calling_model`, `grounding`, `saving`), then one final `done` event with the brief or one final `failed` event with an error code and message, and then close the stream. *Verify: it*
34. **AC-34** — [server] IF a client subscribes to a job after it has sent events, THEN the server shall replay the earlier events first, and then send the live ones. *Verify: it*
35. **AC-35** — [client] WHEN the Overview tab opens and the brief read returns a running job, the client shall subscribe to that job's events and show its progress. *Verify: unit*
36. **AC-36** — [client] The Overview tab shall show, in this order, the PR Brief banner, a row with the Intent card and the Blast radius card side by side, the Review focus card, and the existing Description. *Verify: unit*
37. **AC-37** — [client] WHILE the PR has a latest review, the banner shall show its verdict, its findings count, its blockers count and its score in a score ring, with the existing verdict and score components. *Verify: unit*
38. **AC-38** — [client] IF the PR has no review, THEN the banner shall show no verdict and no score, and shall still show the brief part. *Verify: unit*
39. **AC-39** — [client] WHILE a brief exists, the banner shall show the brief summary under the verdict line, and a Regenerate action. *Verify: unit*
40. **AC-40** — [client] WHILE no brief exists and no job runs, the banner shall show the text "No brief yet" and a primary Generate action. *Verify: unit*
41. **AC-41** — [client] WHILE a brief exists, the banner shall show the brief's cost in USD, its tokens in and out, its model and its generation time, taken from the brief's stats. *Verify: unit*
42. **AC-42** — [client] IF the brief is outdated, THEN the banner shall show an "Outdated" badge and make Regenerate the primary action. *Verify: unit*
43. **AC-43** — [client] WHILE a generation job runs, the banner shall show the current phase, keep any stored brief visible, and disable Generate and Regenerate. *Verify: unit*
44. **AC-44** — [client] WHEN the user presses Generate or Regenerate, the client shall send the generate request (with `force` for Regenerate), subscribe to the job's events, and refresh the brief when the `done` event arrives. *Verify: unit*
45. **AC-45** — [client] WHILE the brief has missing inputs, the banner shall show the line "Generated without:" followed by each missing input with its reason. *Verify: unit*
46. **AC-46** — [client] The Intent card shall show a Risk areas section under its In scope / Out of scope part, and the section shall take its state only from the brief, not from the intent. *Verify: unit*
47. **AC-47** — [client] IF the intent is empty or its read failed, THEN the Intent card shall show its existing empty or error state and still show the Risk areas section below it. *Verify: unit*
48. **AC-48** — [client] WHILE the brief read is loading, the Risk areas section shall show a loading placeholder. *Verify: unit*
49. **AC-49** — [client] IF the brief read failed, THEN the Risk areas section shall show an error line with a retry action. *Verify: unit*
50. **AC-50** — [client] WHILE no brief exists, the Risk areas section shall show the hint "Generate the brief to see risk areas". *Verify: unit*
51. **AC-51** — [client] IF the brief is outdated, THEN the Risk areas section shall show the stored risks with an "Outdated" badge. *Verify: unit*
52. **AC-52** — [client] The Risk areas section shall show each risk with an icon for its `kind` in the colour of its severity (`high` = critical colour, `medium` = warning colour, `low` = suggestion colour), its title, and its file references as `path:start-end` or `path`. *Verify: unit + manual*
53. **AC-53** — [client] WHEN the user activates the expand control of a risk, the section shall toggle the risk's explanation between shown and hidden. *Verify: unit*
54. **AC-54** — [client] IF a brief has zero risks after grounding, THEN the Risk areas section shall show "No specific risks identified". *Verify: unit*
55. **AC-55** — [client] WHILE a brief exists, the Review focus card shall show its items as an ordered list with a count, each item as `path:line — reason` or `path — reason`. *Verify: unit*
56. **AC-56** — [client] WHILE no brief exists, the Review focus card shall show the hint "Generate the brief to see where to start reading". *Verify: unit*
57. **AC-57** — [client] WHEN the user activates a Review focus item or a risk file reference, the client shall set the URL to `?tab=diff&file=<path>`, plus `&line=<n>` when the item has a line. *Verify: unit + e2e*
58. **AC-58** — [client] WHEN the Files changed tab opens with a `file` parameter, the tab shall scroll the file card of that file into view and highlight the new-side line given by `line` when that line is shown in the diff. *Verify: unit + e2e*
59. **AC-59** — [client] IF the target file is in a collapsed group or its file card is collapsed, THEN the Files changed tab shall expand them before it scrolls. *Verify: unit*
60. **AC-60** — [client] IF the `line` is not shown in the diff of that file, THEN the Files changed tab shall scroll to the file card and highlight no line. *Verify: unit*
61. **AC-61** — [client] IF the `file` is not a file of the PR, THEN the Files changed tab shall show a notice that the file is no longer in this PR and stay at the top. *Verify: unit*
62. **AC-62** — [server] IF no model provider is configured, THEN the server shall answer the generate request with the error code `config_error` and a message that names the keys to set, and shall start no job. *Verify: it*
63. **AC-63** — [client] IF the generate request fails with `config_error`, THEN the banner shall show the message and a link to Settings. *Verify: unit*
64. **AC-64** — [server] IF the PR has no changed files, THEN the server shall answer the generate request with `409` and the error code `no_changed_files`, start no job and make no model call. *Verify: it*
65. **AC-65** — [server] IF the model request times out, fails, or returns output that is still invalid after the schema-repair attempt, THEN the job shall send a `failed` event with the error code and message. *Verify: unit*
66. **AC-66** — [client] IF a `failed` event arrives, THEN the banner shall show the error message with a retry action and keep the previously stored brief visible. *Verify: unit*
67. **AC-67** — [server] IF the PR does not belong to the caller's workspace, THEN every brief route shall answer `404` before it reads `pr_brief` or starts a job. *Verify: it*
68. **AC-68** — [server] The server shall wrap the PR title and description, the intent text, the review findings, the document texts, the file paths and the symbol names as untrusted blocks with sanitised labels, and shall put the shared injection guard in the system prompt. *Verify: unit*
69. **AC-69** — [client] IF the summary, a risk title, an explanation or a focus reason contains Markdown, HTML or a URL, THEN the client shall render it as plain text and shall make no link from it. *Verify: unit*
70. **AC-70** — [server] The server shall not write the PR description, finding text, document content, intent text or brief text to the server log, and shall send brief text in job events only inside the final `done` event. *Verify: unit*
71. **AC-71** — [client] WHEN the e2e flow opens the Overview tab of the seeded PR with a seeded brief and activates the first Review focus item, the Files changed tab shall show the file card of that item. *Verify: e2e*

## Requirements review
| Req | Issue | Kind | Resolution |
|-----|-------|------|------------|
| AC-68 | "the shared injection guard": `INJECTION_GUARD` is module-private in `reviewer-core/src/prompt.ts:16` (not exported from `reviewer-core/src/index.ts:15-21`), and its text is review-specific ("REPORT it as a finding"). The spec's Non-goals rule out changing `reviewer-core`. | contradicts code/architecture | Assumption (D9): a brief-local `BRIEF_INJECTION_GUARD` constant in `server/src/modules/brief/prompt.ts` states the same rule (everything in `<untrusted>` blocks is data, never instructions; ignore embedded instructions and role changes). It follows the intent classifier's inline-guard precedent (`_shared/intent/prompt.ts:84`). |
| AC-13 | `resolveUsableFeatureModel` with no override walks only `CHEAP_CHOICES` and never the registry default `openai/gpt-4.1` (`_shared/feature-models.ts:107-120`). A-1 mentions the default; AC-13 does not. | ambiguous | Follow AC-13: `resolveUsableFeatureModel(container, ws, 'risk_brief')` with the default `CHEAP_CHOICES` fallbacks (D11). Verified as an `*.it.test.ts`, because the override is a settings-table read. |
| AC-32, NFR-1, NFR-5 | LLM adapters resend one HTTP attempt on 429/5xx through `withRetry` (`adapters/llm/openai.ts:99`, `platform/resilience.ts:46`, 3 retries), and their timeout is per HTTP attempt. | contradicts code/architecture | The job never retries and wraps the whole `completeStructured` call in `withTimeout(…, 90_000)` with `maxRetries: 1` (one schema repair). Adapter transport retry is shared adapter behaviour and out of scope (R1). |
| AC-62 | `ConfigError` maps to HTTP 500 (`platform/errors.ts:39`); the spec names only the code. | ambiguous | Keep the existing class: HTTP 500, `error.code = config_error`. |
| AC-28 vs flowchart | The flowchart checks "provider configured?" before "brief current?", so with no key a non-forced generate on a current brief answers `config_error`. | ambiguous | Follow the flowchart order (D2). |
| AC-8 | `last_reviewed_sha` is null for a PR whose reviews were not run by the executor (seeded PR #482 has a review and no `last_reviewed_sha`, `db/seed.ts:111-122`). A-2 was confirmed: `run-executor.ts:322` writes `markReviewed(pull.id, pull.headSha)`. | missing case | Null `last_reviewed_sha` means findings are not stale (no evidence) (D6). |
| AC-14 | "list each dropped part as trimmed": granularity is not fixed. | ambiguous | One entry per dropped document (detail = path); one aggregated entry each for findings and files (detail = dropped count) (D6). |
| AC-15, AC-21 | Order of limits vs grounding is not fixed. | ambiguous | Ground first, then cut to 6 risks / 5 focus items / 400 chars, so dropped items never take a slot (D7). |
| AC-20 | A blast-only ref may carry a range `start-end`, not one line. | ambiguous | Keep the range iff at least one blast-caller line of that file lies inside it; else keep `path` only (D7). |
| AC-16 | "at least one file reference" is a grounding invariant (AC-21), not a contract rule; `server/test/contracts.test.ts:90-93` parses a `Risks` with `file_refs: []` and `kind: 'security'`. | contradicts code | `Risk.file_refs` stays `z.array(z.string())`; only `kind` becomes the closed enum. S1 changes that test's kind literal to `'auth_surface'`. |
| AC-61 | Notice copy is not fixed. | ambiguous | Key `prReview.smartDiff.focusFileMissing` (DiffTab already uses `prReview`; no new namespace there). |
| NFR-10 | "0 axe violations": no axe tooling in `client/package.json` or `e2e/package.json`. | not checkable | Manual acceptance (Execution → Manual acceptance). Keyboard use and the polite live region are asserted in T7–T9. |
| NFR-6 | p95 300 ms is measured on a testcontainers DB. | not checkable (flaky) | T5 makes 20 sequential reads and asserts p95 < 300 ms. If CI noise makes it flaky, it moves to manual acceptance via Update mode. |
| AC-52 | Colour is partly visual. | not checkable | Unit test asserts the severity colour token and the accessible label; the visual check is manual. |

## Recommendations
1. Reuse `resolveProjectContext` (`_shared/project-context/resolve.ts`) with a 3,000-token budget for AC-10/AC-11 instead of a new doc reader. It already applies the SPEC-01 skip reasons and the symlink-safe `ProjectDocsSource`. Low cost · applied as S6.
2. Reuse `extractHunkHeaders` (`_shared/intent/references.ts:228`) and `sanitiseLabel` (`_shared/intent/prompt.ts:291`), so the "no hunk body" guarantee and label sanitising have one implementation. Low cost · applied as S6/S7.
3. Clear `file`/`line` from the URL when the user switches tabs through the tab bar, so coming back to Files changed does not scroll again. Small UX change outside the ACs · not applied.
4. Later, lift a neutral server-wide untrusted-data guard into `modules/_shared/` and use it for both intent and brief (or export one from `reviewer-core` in its own change). Removes the AC-68 duplication · not applied (scope).
5. Spec Q-4 (link blast-only risk refs to GitHub at `indexed_sha`) would avoid the AC-61 notice for those refs. Spec-level change · not applied.

## Constraints
- **Path shorthand:** `<PR>` = `client/src/app/repos/[repoId]/pulls/[number]/_components`; `<OV>` = `<PR>/OverviewTab/_components`; `<BRIEF>` = `server/src/modules/brief`.
- **Architecture (server, `onion-architecture` "The rings, by real path" and "The DI container"):**
  - `<BRIEF>/routes.ts` is ring 3. It parses with the Zod contract, makes one service call and returns a DTO. It is the only brief file that may import `../blast/service.js` and `../repo-intel/constants.js` (EDGE exemption, `server/.dependency-cruiser.cjs:19`).
  - `<BRIEF>/deps.ts` is ring 3 composition wiring (precedent `_shared/intent/deps.ts`) and the only brief file that touches `Container`.
  - `<BRIEF>/repository.ts` is ring 2.
  - `service.ts`, `facts.ts`, `prompt.ts`, `grounding.ts` and `stream.ts` are ring 1. They may import only `@devdigest/shared`, `platform/errors.ts`, `platform/resilience.ts`, `@devdigest/reviewer-core` (`wrapUntrusted`), `_shared/intent/{prompt,references}.ts`, `_shared/project-context/resolve.ts` and `platform/sse.ts` types. They never import drizzle, `db/**`, fastify, the container or another module's service/repository. `BriefService` takes a `BriefServiceDeps` object in its constructor and keeps no container field.
  - Every new server file states its ring in a header comment.
  - `pnpm --dir server arch` must stay at 0 errors / 17 warnings.
- **Architecture (client, `frontend-ui-architecture` "colocation" and "logic placement"):**
  - New cards are colocated under `<OV>/<Name>/` (`<Name>.tsx`, `index.ts`, `styles.ts`, optional `helpers.ts`), following the `BlastRadiusCard` precedent.
  - Components read data only through `client/src/lib/hooks/brief.ts`.
  - Pure logic lives in `helpers.ts` / `client/src/components/diff-viewer/focus.ts` without a `use` prefix.
  - Every user-facing string comes from `client/messages/en/*.json`.
  - Imports from `@devdigest/shared` are type-only (or a direct `@devdigest/shared/contracts/<file>` value import).
  - `client/src/components/diff-viewer/**` is shared: add no new `useTranslations` namespace there, because `client/src/test/smoke.test.tsx:37` mounts `DiffViewer` with only `shell` messages.
  - Model text (summary, titles, explanations, reasons) is rendered as plain text nodes. Never use `Markdown`, never `dangerouslySetInnerHTML`, and never `MonoLink` (with `href` unset it renders a clickable `<button>`). File refs and focus items are `<button>`s that call `onOpenFile(path, line)` with grounded values only.
- **Contracts & data:**
  - Fill the existing `pr_brief` table; add no table.
  - Contracts are edited in `server/src/vendor/shared/contracts/{brief,review-api}.ts` and copied byte-identical to `client/src/vendor/shared/contracts/` (S1 only).
  - Routes: `GET /pulls/:id/brief`, `POST /pulls/:id/brief/generate` (rate limit 10/min, like intent derive), `GET /pulls/:id/brief/jobs/:jobId/events` (SSE, `rateLimit: false`).
  - `GET /pulls/:id/intent`, `/blast` and `/reviews` are unchanged.
- **Do not touch:**
  - `*/src/vendor/**`, except the S1 byte copies.
  - `server/src/db/migrations/**` by hand (S2 runs `pnpm --dir server db:generate` only; never `db:migrate`).
  - `reviewer-core/**`, `mcp-server/**`, `*/pnpm-lock.yaml`, `e2e/package-lock.json` (this plan adds no dependency).
  - `.claude/**`, every `CLAUDE.md`, `specs/**`, `*/.spec/**`.
  - Red test files written by L2/L3 (implementers never edit them).
  - `server/src/adapters/mocks.ts` is not changed by this plan. Tests bring their own LLM fakes. If a lane ever must touch it, `mocks.ts` may get no runtime third-party import (`reviewer-core` CI imports it).
- **Spec NFRs (binding):**
  - NFR-1: 1 model request per generation (schema repair included), 0 on page open or reload.
  - NFR-2: model input ≤ 8,000 tokens, counted with `container.tokenizer`.
  - NFR-3: summary ≤ 400 chars, ≤ 6 risks, ≤ 5 focus items.
  - NFR-4: documents ≤ 3,000 of the 8,000 tokens.
  - NFR-5: model timeout 90 s, 0 job retries.
  - NFR-6: `GET /pulls/:id/brief` p95 ≤ 300 ms.
  - NFR-7: first SSE event ≤ 1 s after the generate response.
  - NFR-8: 0 bytes of description, finding text, document content, intent text or brief text in the server log.
  - NFR-9: exactly 1 log line per finished job with PR id, job id, outcome, provider, model, tokens in/out, cost, attempts, duration_ms, risks/focus kept and dropped, missing-input names.
  - NFR-10: keyboard use, polite live region, severity label not colour alone, 0 axe A/AA violations.
  - NFR-11: 100% of new strings from `client/messages/en/*.json`.
- **INSIGHTS (server):** `### 2026-09-20 — a long job can stream progress with no \`jobs\` row and no table: \`RunBus\` is keyed by an arbitrary string and replays its buffer` — the brief job is a detached task keyed by `randomUUID()` on `container.runBus`, not `JobRunner` (120 s, 2 retries, no per-enqueue override) and not an `agent_runs` row (it feeds cost rollups, AC-29). `runBus.complete(jobId)` and removing the PR from the running map must both sit in a `finally`, or every SSE subscriber hangs.
- **INSIGHTS (server):** `### 2026-09-20 — picking an LLM provider "by whichever key is configured" makes the test suite spend real money` — choose the provider only through `resolveUsableFeatureModel` (which asks `container.canUseLlm`), never `secrets.get`. In tests, `overrides.llm` replaces every real provider, and `overrides.llm = {}` is the "no provider configured" case (AC-62).
- **INSIGHTS (server):** `### 2026-09-28 — a blast caller's \`file:line\` is correct and its GitHub link still opens unrelated code` — blast-caller lines belong to `indexed_sha`, not the PR head. AC-20 grounding checks a blast-only ref against the caller list of that file, never against hunk ranges. A file that is also a changed file is grounded by hunks (AC-19).
- **INSIGHTS (client):** `### 2026-09-20 — an \`EventSource\` hook that resets its state inside the effect trips \`react-hooks/set-state-in-effect\`; reset during render instead` — `useBriefJob` resets its state during render, keyed on the job id (the `useConventionScan` shape), derives `running`, and its effect cleanup never touches `ended`. The client lint warning baseline (13) must not rise.
- **INSIGHTS (client):** `### 2026-10-03 — gating a TanStack Query loading view on \`isLoading\` renders the "ready" view for a disabled query (\`repoId\` null/undefined)` — Risk areas, Review focus and the banner gate their loading state on `!prId || query.isPending`, never `isLoading` (AC-48). A test that hand-rolls query state must include `isPending`.
- **INSIGHTS (client):** `### 2026-09-17 — importing a *value* from \`@devdigest/shared\` compiles and tests green, then \`next dev\` serves 500 on every route` — client files import `@devdigest/shared` types only. If a runtime value (for example the `BriefPhase` enum) is needed, import it from `@devdigest/shared/contracts/brief` directly. Before calling a client lane done, load `/repos/<id>/pulls/482` once in the running app (manual acceptance).
- **INSIGHTS (e2e):** `### 2026-09-28 — \`wait --text "Blast radius"\` times out while the card is plainly on screen` — `SectionLabel` uppercases its text, so the flow waits on the rendered text (for example `REVIEW FOCUS`, `PR BRIEF`) or on a non-transformed string such as the seeded focus reason.
- **INSIGHTS (e2e):** `### 2026-10-03 — a flow that opens a run trace needs \`seed-project-context.ts\`, not just \`seed()\`` — the seeded brief is written by `seedBriefDemo`, called only from `seed.ts`'s CLI entrypoint (`pnpm db:seed`), not from `seed()`. The `*.it.test.ts` suite therefore starts with no brief, and the e2e stack (which runs the CLI) has one.
- **INSIGHTS (e2e):** `### 2026-10-03 - the hermetic stack isolated only the DB and ports, not the seed's files on disk` — `seedBriefDemo` writes only DB rows, never files, so `scripts/e2e.sh` needs no change. Keep it that way.
- **INSIGHTS (root):** `### 2026-09-28 — \`e2e/\` is npm-locked, not pnpm: \`pnpm --dir e2e install\` writes a stray \`e2e/pnpm-lock.yaml\`, and a live \`e2e\` run also needs the separate \`agent-browser\` binary` — never run `pnpm --dir e2e install`. Running the flow is manual acceptance on a stack with `agent-browser` installed.
- **INSIGHTS (root):** `### 2026-09-26 — this sandbox's \`server/.env\`/\`client/.env\` already override the default ports, so \`lsof -iTCP:3000\`/\`:3001\` being free proves nothing about whether the app stack is up` — manual acceptance reads `API_PORT`/`WEB_PORT` from the `.env` files and reuses a healthy running stack.
- **INSIGHTS (root):** `### 2026-09-26 — a plan's \`rg -F\` Verify for a verbatim phrase reported pass while the phrase was absent from the file` — every verbatim phrase a Verify greps stays on one source line, and each is checked with its own single-phrase `rg`.

## Decisions
- **D1 (spec Q-1, storage).**
  - `pr_brief.json` holds the grounded document `{ summary, risks, review_focus, missing_inputs }`.
  - New columns, all ADD-only: `head_sha text` (nullable), `model text` (nullable, stored as `<provider>/<model>`, the `pr_intent.model` precedent; the mapper splits at the first `/`, since provider ids never contain one), `generated_at timestamptz not null default now()`, `stats jsonb` (nullable).
  - Why: the table keeps one current brief per PR that is replaced whole on every generation. Only `head_sha` is compared (outdated) and only metadata is shown, so focus items and missing inputs need no columns. An ADD-only diff never triggers drizzle-kit's interactive rename prompt.
  - The repository validates a stored row with the `PrBrief` contract and treats a row that fails to parse as "no brief". Any future field in the stored document or stats must be `nullish()`.
- **D2 (spec Q-3, job).**
  - Detached task on `RunBus` with a `randomUUID()` job id (conventions precedent). `BriefService` (one instance per app, built at route registration) keeps `running: Map<prId, { jobId, phase }>` and `jobs: Map<jobId, prId>`. `jobs` is never pruned during the process, so late subscribers replay and an unknown job gets 404.
  - `generate()` order follows the spec flowchart: PR in workspace (else `NotFoundError`) → changed files (else `AppError('no_changed_files', …, 409)`) → `deps.resolveLlm` (throws `ConfigError`) → running job (return `{ kind: 'started', job_id, reused: true }`, even with `force`) → `!force && brief && brief.head_sha === pull.headSha` (return `{ kind: 'current', brief }`) → start.
  - The "running?" re-check and the `running.set` happen synchronously, with no `await` between them.
  - Starting a job publishes the `assembling` phase event before `generate()` returns (NFR-7), then runs `void runJob(...)`.
  - `runJob` makes one `llm.completeStructured({ schemaName: 'PrBriefDraft', maxRetries: 1, timeoutMs: 90_000, … })` wrapped in `withTimeout(…, 90_000)`. There is no retry anywhere in the job.
  - The brief is saved only after grounding succeeds (AC-27). `finally` deletes `running[prId]` and calls `bus.complete(jobId)`.
  - EC-14 (restart) needs nothing extra: the maps are in memory.
- **D3 (SSE wire format).**
  - Bus events: phase → `publish(jobId, 'info', <phase id>, { type: 'phase', phase })`; done → `publish(jobId, 'result', 'done', { type: 'done', brief })`; failed → `publish(jobId, 'error', <code>, { type: 'failed', code, message })`.
  - `msg` never carries brief, PR or document text (AC-70).
  - `<BRIEF>/stream.ts` `briefEventStream(bus, jobId)` maps `_shared/sse-stream.ts` `runEventStream` frames to `{ id: seq, event: data.type, data: JSON.stringify(data) }`, so the SSE `event:` names are `phase` / `done` / `failed` and the `data:` is a `BriefJobEvent`.
- **D4 (spec Q-2, Files changed focus).**
  - The target lives only in the URL (`file`, `line`). `DiffTab` resolves it with `resolveDiffFocus(files, file, line)` and passes `focus` to `DiffViewer`.
  - In Smart order, `DiffViewer` passes the focus key to the `FileGroup` that contains the path. In both orders it passes it to that path's `FileCard`.
  - `FileGroup`/`FileCard` force `open = true` with a render-time reset keyed on the focus key (`${path}:${line ?? ''}`). The user can still collapse afterwards, and a new target opens again.
  - The focused `FileCard` calls `rootRef.current?.scrollIntoView?.({ block: 'start' })` in an effect keyed on the focus key, and marks the matching new-side `CodeLine` row `aria-current="location"`.
  - Toggling Smart/Original remounts the cards, so they re-apply the focus. No state is kept outside the URL.
- **D5 (stale strings).** `client/messages/en/brief.json` is replaced whole by the keys in *Interfaces §UI-msg*. The old `block.*`, `noRisks`, `noHistory`, `overlap`, `unavailable*` and `why.*` keys are removed, because nothing in `client/src` reads the `brief` namespace at `edccd7c`.
- **D6 (missing inputs).** Entries are `{ input, state, detail }`:
  - intent: `intent/missing/null`, `intent/stale/null`.
  - description (null, or empty after trim): `description/missing/null`.
  - blast: `blast/degraded/<reason or null>`.
  - findings: `findings/missing/null` (no findings input); `findings/stale/null` (only when `last_reviewed_sha` is non-null and ≠ `head_sha`).
  - Skipped document: `document/skipped/"<reason>: <path>"`, reason ∈ `missing|too_large|invalid_path|budget`.
  - Trimmed (AC-14): `document/trimmed/<path>` per dropped document; `findings/trimmed/"<n>"` once; `files/trimmed/"<n>"` once.
  - Tests assert membership (`toContainEqual`), never order.
  - Findings input: the not-dismissed findings of the newest `kind: 'review'` review per `agent_id` (null grouped as one), sent as title, severity, file, startLine, endLine.
  - Documents: the union of every enabled agent's `context_docs` (agent order) plus every included skill's docs (`AgentSkillsPort.resolveAgentSkillSets`), fed to `resolveProjectContext` with `budgetTokens = 3000`, `config.projectContext.roots`/`maxDocBytes`, and `repos.clone_path` as the checkout.
- **D7 (grounding and limits).**
  - Hunk range: `@@ -a,b +c,d @@` → `c..c+d-1` (`d` omitted = 1; `d = 0` = no range). A null patch has no ranges.
  - Refs are parsed as `path`, `path:n` or `path:s-e` and stored as `path` or `path:s-e` (`path:n` → `path:n-n`).
  - Changed file: keep `path:s-e` iff it overlaps a hunk range, else `path`.
  - Blast-only file: keep `path:s-e` iff a caller line of that file lies in `s..e`, else `path`.
  - Any other file: drop the ref. A risk with no refs left is dropped. Duplicate refs are de-duplicated.
  - Unknown `kind` → `other`.
  - Focus items: file must be a changed file (else drop); a line outside every hunk becomes `null`.
  - Then cut: summary to 400 chars, risks to the first 6, focus items to the first 5.
- **D8 (job error codes).** Messages are fixed constants; raw error text is never sent or logged.
  - `model_timeout`: "The model did not answer within 90 seconds." (a `TimeoutError`).
  - `model_failed`: "The model request failed or returned invalid output." (anything thrown by the model call).
  - `brief_failed`: "The brief could not be generated." (anything else).
- **D9 (guard).** `BRIEF_INJECTION_GUARD` is exported from `<BRIEF>/prompt.ts` and appended to the system prompt. Every untrusted text (title, description, intent text and scope items, finding titles and files, document texts, file paths and hunk headers, blast symbol names and caller files) is passed through `wrapUntrusted(sanitiseLabel(label), text)`.
- **D10 (seed).**
  - `server/src/db/seed-brief.ts` exports `SEED_BRIEF_HEAD_SHA = 'a1b2c3d4e5f6'`, `SEED_BRIEF_DOC` and `seedBriefDemo(db)`. `seedBriefDemo` inserts the `pr_brief` row for acme/payments-api PR #482 with `onConflictDoNothing()`. It imports only `./schema.js`, `./client.js` types and `drizzle-orm` — never `@devdigest/reviewer-core` or `@devdigest/shared` (CI runs `db:seed` before installing reviewer-core deps).
  - `SEED_BRIEF_DOC.summary`: "Adds a token-bucket rate limiter in front of every public API route and a config change that a review already flagged for a committed secret."
  - Risks: `{ kind: 'config_secrets', severity: 'high', title: 'Secret key committed in config', explanation: 'src/config.ts carries a live Stripe key; it must move to the environment and be rotated.', file_refs: ['src/config.ts'] }` and `{ kind: 'performance', severity: 'medium', title: 'Limiter runs on every public request', explanation: 'Each public call now passes the token bucket, so its cost and failure mode matter for all routes.', file_refs: ['src/middleware/ratelimit.ts'] }`.
  - `review_focus`, in order: `{ file: 'src/middleware/ratelimit.ts', line: null, reason: 'Start here: the new token-bucket limiter that every public route now depends on' }`, `{ file: 'src/config.ts', line: null, reason: 'Check the new limits and the committed secret' }`, `{ file: 'src/api/public/webhooks.ts', line: null, reason: 'See how the limiter is wired into the webhook routes' }`.
  - `missing_inputs`: `[{ input: 'blast', state: 'degraded', detail: 'no_data' }]`.
  - Columns: `model 'openrouter/deepseek/deepseek-v4-flash'`, `stats { tokens_in: 8200, tokens_out: 1300, cost_usd: 0.014, attempts: 1, duration_ms: 4200 }`.
  - `seed.ts`'s CLI entrypoint calls it after `seedProjectContextDemo`.
- **D11 (model).** `deps.resolveLlm = async (ws) => { const choice = await resolveUsableFeatureModel(container, ws, 'risk_brief'); return { choice, llm: await container.llm(choice.provider) }; }` uses the default `CHEAP_CHOICES` fallbacks.
- **D12 (log).**
  - Each finished job writes exactly one line. Success: `log.info(fields, 'brief: job finished')`. Failure: `log.warn(fields, 'brief: job failed')`.
  - `fields = { prId, jobId, outcome, code?, provider, model, tokens_in, tokens_out, cost_usd, attempts, duration_ms, risks_kept, risks_dropped, focus_kept, focus_dropped, missing_inputs: string[] /* "input:state" */ }`.
  - No other log call carries text. `deps.readBlast` passes a no-op logger to `BlastService.forPull`, so blast adds no line.

## Interfaces (fixed by L1)
**§C — contracts (`server/src/vendor/shared/contracts/brief.ts`, mirrored):**
- `RiskKind = z.enum(['auth_surface','dependency','performance','data_migration','api_contract','config_secrets','test_coverage','other'])`.
- `Risk = { kind: RiskKind, title: string, explanation: string, severity: RiskSeverity, file_refs: string[] }`. `Risks` is kept.
- `ReviewFocusItem = { file: string, line: int nullable, reason: string }`.
- `MissingInputName = z.enum(['intent','blast','description','findings','document','files'])`.
- `MissingInputState = z.enum(['missing','stale','degraded','skipped','trimmed'])`.
- `MissingInput = { input: MissingInputName, state: MissingInputState, detail: string nullable }`.
- `BriefStats = { tokens_in: int, tokens_out: int, cost_usd: number nullable, attempts: int, duration_ms: int }`.
- `PrBrief = { pr_id, head_sha, summary, risks: Risk[], review_focus: ReviewFocusItem[], missing_inputs: MissingInput[], model: string, provider: string, generated_at: string, stats: BriefStats }`.
- `BriefPhase = z.enum(['assembling','calling_model','grounding','saving'])`.
- `BriefJobEvent = z.discriminatedUnion('type', [{ type: 'phase', phase: BriefPhase }, { type: 'done', brief: PrBrief }, { type: 'failed', code: string, message: string }])`.
- `Intent`, `BlastRadius`, `PrHistory`, `SmartDiff` and the intent/blast enums are unchanged.

**§C — contracts (`review-api.ts`, mirrored):**
- `PrBriefJob = { id: string, phase: BriefPhase }`.
- `PrBriefResponse = { brief: PrBrief nullable, current_head_sha: string, outdated: boolean, job: PrBriefJob nullable }`.
- `GenerateBriefBody = z.object({ force: z.boolean().optional() }).default({})`.
- `GenerateBriefAccepted = { job_id: string, reused: boolean }`.
- `GenerateBriefCurrent = { brief: PrBrief }`.
- `GenerateBriefResponse = z.union([GenerateBriefAccepted, GenerateBriefCurrent])`.

**§S — server (`<BRIEF>/`):**
- `constants.ts`: `BRIEF_INPUT_TOKEN_BUDGET = 8000`, `BRIEF_DOC_TOKEN_BUDGET = 3000`, `BRIEF_SUMMARY_MAX_CHARS = 400`, `BRIEF_MAX_RISKS = 6`, `BRIEF_MAX_FOCUS = 5`, `BRIEF_MODEL_TIMEOUT_MS = 90_000`, `BRIEF_MAX_SCHEMA_REPAIRS = 1`, `BRIEF_SCHEMA_NAME = 'PrBriefDraft'`, plus the D8 codes/messages.
- `prompt.ts`:
  - `PrBriefDraft = z.object({ summary: z.string(), risks: z.array(z.object({ kind: z.string(), title: z.string(), explanation: z.string(), severity: z.enum(['high','medium','low']), file_refs: z.array(z.string()) })), review_focus: z.array(z.object({ file: z.string(), line: z.number().int().nullable(), reason: z.string() })) })` — real in L1; this is the model contract.
  - `BRIEF_INJECTION_GUARD: string` — real in L1.
  - `renderBriefMessages(facts): ChatMessage[]` — the L1 skeleton throws.
- `service.ts`:
  - `BriefPull = { id, title, body: string|null, headSha, lastReviewedSha: string|null, clonePath: string|null }`.
  - `BriefPrFile = { path, additions, deletions, patch: string|null }`.
  - `BriefReview = { kind: 'summary'|'review', agentId: string|null, createdAt: Date, findings: { title, severity, file, startLine, endLine, rationale, suggestion: string|null, dismissedAt: Date|null }[] }`.
  - `BriefBus = { publish(id: string, kind: 'info'|'result'|'error', msg: string, data?: unknown): unknown; complete(id: string): void }` (a `RunBus` satisfies it).
  - `BriefLogger = { info(obj: Record<string, unknown>, msg: string): void; warn(...same); error(...same) }`.
  - `BriefServiceDeps = { getPull(ws, prId): Promise<BriefPull|undefined>; getPrFiles(prId): Promise<BriefPrFile[]>; getBrief(prId): Promise<PrBrief|null>; saveBrief(brief: PrBrief): Promise<void>; readIntent(ws, prId): Promise<PrIntentRecord|null>; readBlast(ws, prId): Promise<BlastRadius>; listReviews(prId): Promise<BriefReview[]>; listEnabledAgentDocs(ws): Promise<{ contextDocs: string[]; skills: { name: string; contextDocs: string[] }[] }[]>; projectDocs: ProjectDocsSource; docRoots: string[]; maxDocBytes: number; tokenizer: { count(text: string): number }; resolveLlm(ws): Promise<{ choice: FeatureModelChoice; llm: LLMProvider }>; bus: BriefBus; now?: () => Date }`.
  - `GenerateBriefResult = { kind: 'started'; job_id: string; reused: boolean }` or `{ kind: 'current'; brief: PrBrief }`.
  - `class BriefService { constructor(deps: BriefServiceDeps); read(ws, prId): Promise<PrBriefResponse>; generate(ws, prId, body: { force?: boolean }, log: BriefLogger): Promise<GenerateBriefResult>; assertJob(ws, prId, jobId): Promise<void> }`. In L1 every method throws `new AppError('not_implemented', 'Not implemented', 501)`.
  - Hermetic tests build `new BriefService(fakeDeps)` with `bus: new RunBus()` and await a job with `bus.onDone(jobId, cb)`; `bus.buffer(jobId)` gives the events.
- `routes.ts` (L1): the three routes registered with their Zod schemas (`IdParams`; events params `z.object({ id: uuid, jobId: uuid })`; POST response `{ 200: GenerateBriefCurrent, 202: GenerateBriefAccepted }`). Each handler calls `getContext` and then throws the 501 `AppError`. L5 wires them to the service.

**§UI — client:**
- `client/src/lib/hooks/brief.ts`:
  - `briefKeys.brief(prId) = ["pr-brief", prId]`.
  - `usePrBrief(prId)` = `useQuery<PrBriefResponse>` on GET `/pulls/${prId}/brief`, `enabled: !!prId`.
  - `useGenerateBrief(prId)` = `useMutation<GenerateBriefResponse, Error, { force?: boolean }>` on POST `/pulls/${prId}/brief/generate` with body `{ force }`. A `{ brief }` answer is written into the `pr-brief` cache.
  - `useBriefJob(prId, jobId): { phase: BriefPhase|null; done: boolean; failed: { code: string; message: string }|null; running: boolean }` opens an `EventSource` on `${API_BASE}/pulls/${prId}/brief/jobs/${jobId}/events`, listens to `phase`/`done`/`failed` and `onmessage`, and on `done` or `failed` calls `invalidateQueries({ queryKey: ["pr-brief", prId] })` and closes.
  - L1 skeleton: the query/mutation fns throw `Error('not implemented')`; `useBriefJob` returns `{ phase: null, done: false, failed: null, running: false }`.
- Components (L1 skeletons render `null` or ignore the new prop):
  - `<OV>/BriefBanner/index.ts` exports `BriefBanner({ prId }: { prId: string | null })`.
  - `<OV>/RiskAreas/index.ts` exports `RiskAreas({ prId, onOpenFile }: { prId: string | null; onOpenFile?: (path: string, line: number | null) => void })`.
  - `<OV>/ReviewFocusCard/index.ts` exports `ReviewFocusCard` with the same props.
  - `IntentCard` gains `riskAreas?: React.ReactNode`. `OverviewTab` gains `onOpenFile?: (path: string, line: number | null) => void`. `DiffTab` gains `focusFile?: string | null; focusLine?: string | null`. `DiffViewer` gains `focus?: { path: string; line: number | null } | null`.
  - `client/src/components/diff-viewer/focus.ts` exports `DiffFocus` (`{ kind: 'none' }`, `{ kind: 'missing'; path: string }` or `{ kind: 'target'; path: string; line: number | null }`) and `resolveDiffFocus(files: PrFile[], file?: string | null, line?: string | null): DiffFocus` (skeleton returns `{ kind: 'none' }`). Both are re-exported from `diff-viewer/index.ts`.
- DOM contract the red tests use:
  - Banner: one `role="status"` polite live region with the phase/done/failed text. Buttons named by `brief.banner.generate` / `brief.banner.regenerate` / `brief.banner.retry`. The primary action has `kind="primary"` (inline `background: var(--accent)`); both are `disabled` while a job runs or the mutation is pending. On `config_error`: the server message and `<a href="/settings/api-keys">` named `brief.banner.openSettings`. Verdict label from `prReview.verdict.<labelKey>` via `<PR>/VerdictBanner/constants.ts`. Score ring via `CircularScore`.
  - Risk areas: section with `aria-busy="true"` while loading. Severity icon `role="img"` with `aria-label` = `brief.risks.severity.<sev>`, coloured `SEV.CRITICAL/WARNING/SUGGESTION.c` for high/medium/low. Refs are `<button>`s with text `path:s-e` or `path`. Expand toggle `<button aria-expanded aria-label={brief.risks.toggle({title})}>`.
  - Review focus: `<ol>`; each `<li>` holds one `<button>` with text `path:line — reason` or `path — reason`.
  - Files changed: notice `role="status"` with `prReview.smartDiff.focusFileMissing`; highlighted row `aria-current="location"`.
- `client/messages/en/brief.json` keys (values as written):
  - `banner`: `title` "PR Brief", `noBrief` "No brief yet", `generate` "Generate", `regenerate` "Regenerate", `outdated` "Outdated", `generatedWithout` "Generated without:", `missingItem` "{input} ({state})", `missingItemDetail` "{input} ({state}: {detail})", `cost` "${cost}", `costUnknown` "cost n/a", `tokens` "{tokensIn} → {tokensOut} tokens", `meta` "{model} · {time}", `phase.{assembling,calling_model,grounding,saving}` "Assembling facts…" / "Calling the model…" / "Checking references…" / "Saving the brief…", `done` "Brief ready.", `failed` "Brief generation failed: {message}", `retry` "Retry", `openSettings` "Open Settings".
  - `input.{intent,blast,description,findings,document,files}`: "intent", "blast radius", "description", "review findings", "document", "changed files".
  - `state.{missing,stale,degraded,skipped,trimmed}`: same words.
  - `risks`: `title` "Risk areas", `outdated` "Outdated", `error` "Couldn't load risk areas.", `retry` "Retry", `empty` "Generate the brief to see risk areas", `none` "No specific risks identified", `toggle` "Details for {title}", `severity.{high,medium,low}` "High severity" / "Medium severity" / "Low severity", `kind.<each RiskKind>` (human label).
  - `focus`: `title` "Review focus", `count` "{count, plural, one {# item} other {# items}}", `empty` "Generate the brief to see where to start reading".
  - `prReview.json` gains `smartDiff.focusFileMissing` "This file is no longer in this PR."
- Formatting (pure, in `<OV>/BriefBanner/helpers.ts`): `formatTokens(n)` = `String(n)` below 1000, else one decimal plus `K` (8200 → `8.2K`); `formatCost(n)` = `n.toFixed(3)`; time = `new Date(generated_at).toLocaleString()`.

## Steps
| ID | Package | Files (create / modify) | Change | Skills (routing bucket) | Covers | Lane | Verify |
|----|---------|-------------------------|--------|-------------------------|--------|------|--------|
| S1 | server, client | `server/src/vendor/shared/contracts/brief.ts` (modify), `server/src/vendor/shared/contracts/review-api.ts` (modify), `client/src/vendor/shared/contracts/brief.ts` (modify, byte copy), `client/src/vendor/shared/contracts/review-api.ts` (modify, byte copy), `server/test/contracts.test.ts` (modify) | Implement *Interfaces §C* exactly. Replace the composed `PrBrief` (drop `intent`/`blast`/`history`). Constrain `Risk.kind` to `RiskKind`. Add the review-api response contracts. Copy both files byte-identical to the client mirror (the only vendor edit). In `contracts.test.ts`, change only the `Risks.parse` kind literal `'security'` → `'auth_surface'`. | `zod` (contracts), `typescript-expert` (types) | AC-16, AC-25, AC-26, AC-33 | L1 | `pnpm --dir server typecheck`; `rg -n "export const RiskKind" server/src/vendor/shared/contracts/brief.ts` (no match at edccd7c); `rg -n "export const PrBriefResponse" server/src/vendor/shared/contracts/review-api.ts` (no match at edccd7c); `rg -n "history: PrHistory" server/src/vendor/shared/contracts/brief.ts` → no match (removal; matches at edccd7c); `diff -q server/src/vendor/shared/contracts/brief.ts client/src/vendor/shared/contracts/brief.ts`; `diff -q server/src/vendor/shared/contracts/review-api.ts client/src/vendor/shared/contracts/review-api.ts`; `pnpm --dir server exec vitest run test/contracts.test.ts` |
| S2 | server | `server/src/db/schema/reviews.ts` (modify), `server/src/db/rows.ts` (modify), `server/src/db/migrations/` (generated by `pnpm --dir server db:generate`) | Add the D1 columns to `prBrief` (ADD only, no drop or rename, so no drizzle-kit prompt). Add `export type PrBriefRow = typeof t.prBrief.$inferSelect` to `rows.ts`. Run `db:generate` once; never hand-edit the SQL; never run `db:migrate` (the main session migrates the dev DB). | `drizzle-orm-patterns`, `postgresql-table-design` (backend-data), `onion-architecture` (backend-arch) | AC-25 | L1 | `pnpm --dir server typecheck`; `rg -n -F 'ALTER TABLE "pr_brief" ADD COLUMN "head_sha"' server/src/db/migrations` (no match at edccd7c); `rg -n "export type PrBriefRow" server/src/db/rows.ts` (no match at edccd7c); guard: `git diff --name-only edccd7c -- server/src/db/migrations` lists only `server/src/db/migrations/meta/_journal.json` |
| S3 | server | `<BRIEF>/constants.ts` (create), `<BRIEF>/prompt.ts` (create), `<BRIEF>/service.ts` (create), `<BRIEF>/routes.ts` (create), `server/src/modules/index.ts` (modify) | Interface skeleton per *Interfaces §S*: real constants, `PrBriefDraft` and `BRIEF_INJECTION_GUARD`; all `BriefService` types; methods and `renderBriefMessages` throw the 501 `AppError('not_implemented', …)`. The three routes are registered with schemas and their handlers throw 501 after `getContext`. Register `brief` in `modules/index.ts`. Ring header comment on every file. | `onion-architecture` (backend-arch), `fastify-best-practices` (backend-http), `security` (security), `zod` (contracts) | AC-26, AC-30, AC-33 | L1 | `pnpm --dir server typecheck`; `pnpm --dir server lint`; `pnpm --dir server arch` (0 errors, warnings ≤ 17); `rg -n "from './brief/routes.js'" server/src/modules/index.ts` (no match at edccd7c) |
| S4 | client | `client/src/lib/hooks/brief.ts` (create), `client/src/lib/hooks/index.ts` (modify), `client/messages/en/brief.json` (modify, replace whole), `client/messages/en/prReview.json` (modify, add one key) | Hook skeletons per *Interfaces §UI* (no behaviour). Barrel export `export * from "./brief"`. Replace `brief.json` with exactly the listed keys (D5). Add `smartDiff.focusFileMissing` to `prReview.json`. Keep each spec-fixed value on one line. | `frontend-ui-architecture`, `react-best-practices`, `next-best-practices`, `vercel-react-best-practices` (frontend) | AC-35, AC-44, AC-45 | L1 | `pnpm --dir client typecheck`; `rg -n -F '"No brief yet"' client/messages/en/brief.json`; `rg -n -F '"Generated without:"' client/messages/en/brief.json`; `rg -n -F '"Generate the brief to see risk areas"' client/messages/en/brief.json`; `rg -n -F '"No specific risks identified"' client/messages/en/brief.json`; `rg -n -F '"Generate the brief to see where to start reading"' client/messages/en/brief.json` (each: no match at edccd7c); `rg -n "git-why" client/messages/en/brief.json` → no match (removal; matches at edccd7c); `rg -n -F 'export * from "./brief"' client/src/lib/hooks/index.ts` |
| S5 | client | `<OV>/BriefBanner/{BriefBanner.tsx,index.ts}` (create), `<OV>/RiskAreas/{RiskAreas.tsx,index.ts}` (create), `<OV>/ReviewFocusCard/{ReviewFocusCard.tsx,index.ts}` (create), `<OV>/IntentCard/IntentCard.tsx` (modify), `<PR>/OverviewTab/OverviewTab.tsx` (modify), `<PR>/DiffTab/DiffTab.tsx` (modify), `client/src/components/diff-viewer/DiffViewer/DiffViewer.tsx` (modify), `client/src/components/diff-viewer/focus.ts` (create), `client/src/components/diff-viewer/index.ts` (modify) | Component skeletons and new optional props per *Interfaces §UI*. New components return `null`. New props are accepted but unused. `resolveDiffFocus` returns `{ kind: 'none' }`. Existing behaviour is unchanged, so existing tests stay green. | frontend skills (frontend) | AC-36, AC-46, AC-58 | L1 | `pnpm --dir client typecheck`; `pnpm --dir client lint` (warnings ≤ 13); `pnpm --dir client exec vitest run OverviewTab DiffTab DiffViewer smoke`; `rg -n "export function resolveDiffFocus" client/src/components/diff-viewer/focus.ts` |
| S6 | server | `<BRIEF>/facts.ts` (create), `server/test/brief-helpers.test.ts` (create, impl tests) | Pure ring-1 fact-set assembly: findings selection (D6), document union fed to `resolveProjectContext` (budget 3000), missing inputs (D6), diff facts from paths + additions/deletions + `extractHunkHeaders` + totals only (never a body line), stale markers, and `fitToBudget(facts, countTokens, 8000)` trimming documents from the end, then findings from the lowest severity (SUGGESTION, then WARNING, then CRITICAL), then files from the end, recording trimmed entries. | `onion-architecture` (backend-arch), `typescript-expert` (types) | AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-14 | L4 | `pnpm --dir server exec vitest run test/brief-helpers.test.ts`; `pnpm --dir server typecheck` |
| S7 | server | `<BRIEF>/prompt.ts` (modify) | Implement `renderBriefMessages`: the system prompt includes the task, the "findings may be stale, lines may have moved" note when stale, the output rules and `BRIEF_INJECTION_GUARD`. The user message carries every untrusted item through `wrapUntrusted(sanitiseLabel(label), text)` (D9). Finding rationale and suggestion are never rendered. | `onion-architecture` (backend-arch), `security` (by intent: prompt injection) | AC-2, AC-8, AC-9, AC-68 | L4 | `pnpm --dir server exec vitest run test/brief-helpers.test.ts`; `rg -n "BRIEF_INJECTION_GUARD" server/src/modules/brief/prompt.ts` |
| S8 | server | `<BRIEF>/grounding.ts` (create) | Pure grounding and limits per D7: hunk ranges, ref parsing, AC-18…AC-23 rules, `other` for unknown kinds, then the 400 / 6 / 5 cuts. Returns kept items and dropped counts for D12. | `onion-architecture` (backend-arch), `typescript-expert` (types) | AC-15, AC-16, AC-17, AC-18, AC-19, AC-20, AC-21, AC-22, AC-23, AC-24 | L4 | `pnpm --dir server exec vitest run test/brief-helpers.test.ts`; `pnpm --dir server typecheck` |
| S9 | server | `<BRIEF>/service.ts` (modify), `<BRIEF>/stream.ts` (create) | Full `BriefService` per D2/D3/D8/D12: `read` (PR check first, then brief, outdated, running job), `generate` (flowchart order, sync dedupe, `assembling` before return), `runJob` (facts → one `completeStructured` in `withTimeout` → grounding → save → `done`; catch → `failed`; `finally` completes the bus), `assertJob` (404 unless the job belongs to this PR in this workspace), and the single log line. `stream.ts`: `briefEventStream` per D3. Never write an `agent_runs` row; never read `this.container`. | `onion-architecture` (backend-arch), `security` (security) | AC-1, AC-12, AC-24, AC-26, AC-27, AC-28, AC-30, AC-31, AC-32, AC-33, AC-34, AC-62, AC-64, AC-65, AC-67, AC-70 | L5 | `pnpm --dir server exec vitest run test/brief-facts.test.ts test/brief-model.test.ts test/brief-grounding.test.ts test/brief-untrusted.test.ts`; `rg -n "this\.container" server/src/modules/brief` → no match; `rg -n "agentRuns" server/src/modules/brief` → no match |
| S10 | server | `<BRIEF>/repository.ts` (create), `<BRIEF>/deps.ts` (create), `<BRIEF>/routes.ts` (modify) | Repository (ring 2): workspace-scoped pull + `repos.clone_path`, `pr_files`, `getBrief` (row → validated `PrBrief`, D1 split of `model`), `upsertBrief`. `deps.ts` builds `BriefServiceDeps` from the container: `reviewRepo.reviewsForPull`, `agentsRepo.listEnabled` + `agentSkills.resolveAgentSkillSets`, `intentDeriverFor(container).read`, `projectDocs`, `tokenizer`, `config.projectContext`, D11 `resolveLlm`, `runBus`, `readBlast` injected by routes. Routes build `BlastService` (no-op logger, D12) and one `BriefService` at registration. Handlers: GET returns `service.read`; POST maps `started` → 202 `{ job_id, reused }` and `current` → 200 `{ brief }`; events calls `assertJob` then `reply.sse(briefEventStream(container.runBus, jobId))`. | `onion-architecture` (backend-arch), `fastify-best-practices` (backend-http), `drizzle-orm-patterns`, `postgresql-table-design` (backend-data), `security` (security) | AC-10, AC-13, AC-25, AC-26, AC-29, AC-30, AC-33, AC-34, AC-62, AC-64, AC-67 | L5 | `pnpm --dir server exec vitest run test/brief.it.test.ts` (Docker); `pnpm --dir server arch` (0 errors, warnings ≤ 17); `pnpm --dir server exec vitest run test/routes-smoke.test.ts`; `pnpm --dir server lint` |
| S11 | server | `server/src/db/seed-brief.ts` (create), `server/src/db/seed.ts` (modify), `server/test/seed-brief.test.ts` (create, impl test) | D10 seed: the literal document and `seedBriefDemo` (onConflictDoNothing, DB only, no `@devdigest/reviewer-core` / `@devdigest/shared` import), called from the CLI entrypoint after `seedProjectContextDemo`, not from `seed()`. The hermetic test parses `SEED_BRIEF_DOC` with the contract and checks every focus/ref file is one of the four seeded `pr_files` paths. | `drizzle-orm-patterns` (backend-data), `onion-architecture` (backend-arch) | AC-71 | L5 | `pnpm --dir server exec vitest run test/seed-brief.test.ts`; `rg -n "reviewer-core" server/src/db/seed-brief.ts` → no match; `rg -n "seedBriefDemo" server/src/db/seed.ts` (no match at edccd7c) |
| S12 | server | `server/INSIGHTS.md` (modify, append only) | Session protocol: append through `engineering-insights`, only substantial findings from L4/L5. | `engineering-insights` | — | L5 | guard only: `git diff --numstat edccd7c -- server/INSIGHTS.md` shows 0 deletions |
| S13 | client | `client/src/lib/hooks/brief.ts` (modify) | Real hooks per *Interfaces §UI*. `useBriefJob` uses render-time reset keyed on the job id, a derived `running`, named-event + `onmessage` listeners deduped by `seq`, and invalidates `["pr-brief", prId]` on done/failed/error. The cleanup does not touch `ended`. | frontend skills (frontend) | AC-35, AC-44 | L6 | `pnpm --dir client exec vitest run lib/hooks/brief`; `pnpm --dir client lint` (warnings ≤ 13) |
| S14 | client | `<OV>/BriefBanner/{BriefBanner.tsx,helpers.ts,styles.ts}` (modify/create) | Banner per AC-37…AC-45, AC-63, AC-66 and the DOM contract. Latest review = newest `kind: 'review'` by `created_at` from `usePrReviews`; blockers = CRITICAL and not dismissed. The job id is the mutation's `job_id`, else `brief.job.id`. Plain-text summary. Polite live region. | frontend skills (frontend) | AC-35, AC-37, AC-38, AC-39, AC-40, AC-41, AC-42, AC-43, AC-44, AC-45, AC-63, AC-66, AC-69 | L6 | `pnpm --dir client exec vitest run BriefBanner` |
| S15 | client | `<OV>/RiskAreas/{RiskAreas.tsx,styles.ts}` (modify/create), `<OV>/IntentCard/IntentCard.tsx` (modify) | Risk areas from `usePrBrief` only (loading via `isPending`, error + retry, empty hint, none, outdated badge, kind icon in severity colour with label, refs as buttons → `onOpenFile`, expand toggle). `IntentCard` renders `riskAreas` under In/Out of scope in the data state and below the loading/error/empty state. | frontend skills (frontend) | AC-46, AC-47, AC-48, AC-49, AC-50, AC-51, AC-52, AC-53, AC-54, AC-57, AC-69 | L6 | `pnpm --dir client exec vitest run RiskAreas OverviewTab.brief` |
| S16 | client | `<OV>/ReviewFocusCard/{ReviewFocusCard.tsx,styles.ts}` (modify/create) | `SectionLabel` title, count, `<ol>` of buttons (`path:line — reason` / `path — reason`), empty hint, `onOpenFile(file, line)`. | frontend skills (frontend) | AC-55, AC-56, AC-57, AC-69 | L6 | `pnpm --dir client exec vitest run ReviewFocusCard` |
| S17 | client | `<PR>/OverviewTab/{OverviewTab.tsx,styles.ts}` (modify), `client/src/app/repos/[repoId]/pulls/[number]/page.tsx` (modify) | `OverviewTab` order: `BriefBanner`, row (`IntentCard` with `riskAreas={<RiskAreas … />}`, `BlastRadiusCard` with unchanged props), `ReviewFocusCard`, Description. `page.tsx` passes `onOpenFile={(path, line) => setParams({ tab: "diff", file: path, line: line == null ? null : String(line) })}` and `focusFile={search.get("file")}` / `focusLine={search.get("line")}` to `DiffTab`. | frontend skills (frontend) | AC-36, AC-57 | L6 | `pnpm --dir client exec vitest run OverviewTab`; `pnpm --dir client typecheck` |
| S18 | client | `client/src/components/diff-viewer/focus.ts` (modify), `client/src/components/diff-viewer/focus.test.ts` (create, impl test) | `resolveDiffFocus`: no file → `none`; a file not among `files` → `missing`; else `target` whose `line` is kept only when it parses as an int and `parsePatch(file.patch)` has an add/ctx line with that `newNo`. | frontend skills (frontend) | AC-58, AC-60, AC-61 | L7 | `pnpm --dir client exec vitest run diff-viewer/focus` |
| S19 | client | `client/src/components/diff-viewer/{DiffViewer/DiffViewer.tsx,FileGroup/FileGroup.tsx,FileCard/FileCard.tsx,CodeLine/CodeLine.tsx}` (modify) | D4: focus key to the containing `FileGroup` (Smart order) and the target `FileCard` (both orders); render-time forced open; scroll effect; `aria-current="location"` on the matching new-side row. No new `useTranslations` namespace. | frontend skills (frontend) | AC-58, AC-59, AC-60 | L7 | `pnpm --dir client exec vitest run DiffTab.focus DiffViewer smoke` |
| S20 | client | `<PR>/DiffTab/DiffTab.tsx` (modify) | Resolve the focus from the props. `missing` → `role="status"` notice with `prReview.smartDiff.focusFileMissing` above the list, nothing focused, no scroll. `target` → pass to `DiffViewer`. | frontend skills (frontend) | AC-58, AC-61 | L7 | `pnpm --dir client exec vitest run DiffTab`; `pnpm --dir client typecheck`; `pnpm --dir client lint` |
| S21 | client | `client/INSIGHTS.md` (modify, append only) | Session protocol: append through `engineering-insights`, only substantial findings from L6/L7. | `engineering-insights` | — | L7 | guard only: `git diff --numstat edccd7c -- client/INSIGHTS.md` shows 0 deletions |

## Execution
| Lane | Agent | Steps | Depends on | Parallel with |
|------|-------|-------|------------|---------------|
| L1 | implementer (interface: contracts, schema, server + client skeletons) | S1–S5 | — | — |
| L2 | test-writer (red, server) | T1–T5 | L1 | L3 |
| L3 | test-writer (red, client) | T6–T11 | L1 | L2 |
| L4 | implementer (server pure helpers) | S6–S8 | L2 | L6, L7 |
| L5 | implementer (server service, wiring, seed) | S9–S12 | L4 | L6, L7 |
| L6 | implementer (client Overview: hooks, banner, risk areas, focus card, page wiring) | S13–S17 | L3 | L4, L5 |
| L7 | implementer (client Files changed focus) | S18–S21 | L6 | L4, L5 |
| L8 | test-writer (after: e2e flow) | T15 | L5, L7 | — |

- File sets: L2 writes only `server/test/brief*.ts` and L3 only client test files. L4/L5 touch only `server/**`; L6/L7 only `client/**`. Within each package the lanes are sequential.
- L7 waits for L6 so that exactly one client lane, the last one, owns the append-only `client/INSIGHTS.md` step (S21). L5 owns `server/INSIGHTS.md` (S12). No lane writes `e2e/INSIGHTS.md`; L8 reports e2e findings under *insights proposed*.
- Every AC has a `red` row except AC-71, which is an e2e flow and therefore `after` by rule. Its seed is covered by impl test T13.
- L4 turns no red test green on its own: T1–T4 drive `BriefService` and go green in L5. L4 is verified by its own impl test T12.
- Every implementer lane ends with `.claude/scripts/checks.sh run pr-brief --quick <pkgs>`.
- **Manual acceptance (main session, after L8, before reviewers):**
  - Run `pnpm --dir server db:migrate` on the dev DB, then `pnpm --dir server db:seed`.
  - Load `/repos/<id>/pulls/482` on the real `WEB_PORT`; the page loads with no 500 (barrel value-import check).
  - Run the e2e flow `12-pr-brief` (needs `agent-browser`).
  - AC-52: check severity colours by eye.
  - NFR-10: run axe in the browser on the Overview tab (0 A/AA violations); use Generate, Regenerate, risk expand and a focus item with the keyboard only.
  - NFR-6: spot-check `GET /pulls/:id/brief` latency.

## Test plan
| Test | Kind (unit / `*.it.test.ts` / client RTL / e2e flow) | Phase (red / impl / after) | Covers | Lane | File |
|------|------------------------------------------------------|----------------------------|--------|------|------|
| T1 | unit (hermetic; `BriefService` + fake `BriefServiceDeps`, `new RunBus()`, `MockLLMProvider` / `MockProjectDocsSource`) | red | AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-14, NFR-2, NFR-4 | L2 | `server/test/brief-facts.test.ts` |
| T2 | unit (hermetic; fake LLM returning `attempts: 2`, throwing, throwing `TimeoutError`, over-long output) | red | AC-12, AC-15, AC-16, AC-17, AC-32, AC-65, NFR-3, NFR-5 | L2 | `server/test/brief-model.test.ts` |
| T3 | unit (hermetic; drafts citing unknown, changed, blast-only and out-of-hunk refs; null patch) | red | AC-18, AC-19, AC-20, AC-21, AC-22, AC-23, AC-24 | L2 | `server/test/brief-grounding.test.ts` |
| T4 | unit (hermetic; hostile title/body/doc/finding/path; capturing logger counts lines and greps for content; bus events before `done` carry no brief text) | red | AC-68, AC-70, NFR-8, NFR-9 | L2 | `server/test/brief-untrusted.test.ts` |
| T5 | `*.it.test.ts` via `app.inject()` (testcontainers, `seed()`, `overrides.llm` with a `PrBriefDraft` fixture; `overrides.llm = {}` for AC-62; a feature_models settings row for AC-13; a second workspace for AC-67; temp checkout + agent `context_docs` for AC-10; assert `res.json().error.code`, never top-level `message`) | red | AC-10, AC-13, AC-24, AC-25, AC-26, AC-27, AC-28, AC-29, AC-30, AC-31, AC-33, AC-34, AC-62, AC-64, AC-67, NFR-1, NFR-6, NFR-7 | L2 | `server/test/brief.it.test.ts` |
| T6 | client hook (renderHook + QueryClient, stubbed `fetch`, fake global `EventSource`) | red | AC-35, AC-44 | L3 | `client/src/lib/hooks/brief.test.ts` |
| T7 | client RTL (`NextIntlClientProvider` with `brief` + `prReview` messages imported from JSON, stubbed `fetch`, fake `EventSource`) | red | AC-37, AC-38, AC-39, AC-40, AC-41, AC-42, AC-43, AC-44, AC-45, AC-63, AC-66, AC-69, NFR-10, NFR-11 | L3 | `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/BriefBanner/BriefBanner.test.tsx` |
| T8 | client RTL | red | AC-46, AC-48, AC-49, AC-50, AC-51, AC-52, AC-53, AC-54, AC-57, AC-69, NFR-10 | L3 | `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/RiskAreas/RiskAreas.test.tsx` |
| T9 | client RTL | red | AC-55, AC-56, AC-57, AC-69, NFR-10 | L3 | `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/ReviewFocusCard/ReviewFocusCard.test.tsx` |
| T10 | client RTL (`OverviewTab` with the new children mocked by module path for order; real `IntentCard` with intent read 404/null and a `riskAreas` marker) | red | AC-36, AC-47 | L3 | `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.brief.test.tsx` |
| T11 | client RTL (`DiffTab` with `focusFile`/`focusLine`; smart-diff fixture with the target in a `docs` group and a >200-line file; `Element.prototype.scrollIntoView` stubbed) | red | AC-58, AC-59, AC-60, AC-61 | L3 | `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.focus.test.tsx` |
| T12 | unit (internals of `facts.ts`, `prompt.ts`, `grounding.ts`) | impl | AC-2, AC-14, AC-19, AC-20 | L4 | `server/test/brief-helpers.test.ts` |
| T13 | unit (seed literal parses against `PrBrief`; files are seeded `pr_files` paths) | impl | AC-71 | L5 | `server/test/seed-brief.test.ts` |
| T14 | unit (`resolveDiffFocus`) | impl | AC-58, AC-60, AC-61 | L7 | `client/src/components/diff-viewer/focus.test.ts` |
| T15 | e2e flow: open `/`, wait `/pulls`, click "Add rate limiting to public API endpoints", wait `/pulls/482`, `networkidle`, wait `REVIEW FOCUS`, click text "Start here: the new token-bucket limiter that every public route now depends on", wait `--url tab=diff`, wait `--url file=src`, wait `--text src/middleware/ratelimit.ts` | after | AC-57, AC-58, AC-71 | L8 | `e2e/specs/12-pr-brief.flow.json` |

## Review hand-off
- **Architecture review:**
  - `server/src/modules/brief/*`: ring placement of `service.ts` with structural deps vs. `deps.ts` / `routes.ts` wiring; `routes.ts` importing `../blast/service.js` under the EDGE exemption; no `this.container`; `arch` warning count.
  - `server/src/db/schema/reviews.ts` and the generated migration (ADD-only).
  - `server/src/vendor/shared/contracts/{brief,review-api}.ts` and mirror parity.
  - Client colocation under `<OV>/`; new props on shared `client/src/components/diff-viewer/*` (no new namespace); hooks-only data access; render-time reset in `useBriefJob`.
- **Security review:**
  - `server/src/modules/brief/routes.ts` (workspace 404 before any read or job; rate limit; SSE job ownership).
  - `server/src/modules/brief/prompt.ts` (untrusted wrapping, sanitised labels, the local guard — AC-68 deviation from "shared").
  - `server/src/modules/brief/deps.ts` (checkout document reads only through `ProjectDocsSource` from `repos.clone_path`, default branch).
  - `server/src/modules/brief/service.ts` (log content, event content, fixed error messages).
  - Client plain-text rendering in `<OV>/{BriefBanner,RiskAreas,ReviewFocusCard}` and URL `file`/`line` handling in `DiffTab` / `focus.ts`.
  - No permission-boundary hook is touched, so there are no blocked rows.

## Risks / open questions
- R1: LLM adapters resend on 429/5xx inside one `completeStructured` (`withRetry`). The job never retries, but a transport-level resend can still bill twice. This is shared adapter behaviour (S9 bounds the total at 90 s).
- R2: `specs/pr-brief.spec.md` is untracked at `edccd7c`. Commit it before L2 so the red lanes and plan-verifier read the same file.
- R3: the job state is in memory (A-4). A restart loses the running job, the old brief stays (EC-14), and `RunBus` buffers are never freed (existing behaviour, small).
- R4: NFR-6's p95 check in T5 may be noisy on CI runners. If it flakes, move it to manual acceptance via Update mode.
- R5: the local dev DB needs `db:migrate` by the main session before manual acceptance. Implementers are blocked from migrating.
- R6: `seed()`-based integration tests have no brief by design (D10). A test that needs one inserts it.

## Out of scope
- Spec Q-4 (GitHub links for blast-only refs) and Q-5 (per-review head SHA for findings staleness).
- `reviewer-core`, `mcp-server`, a PR-list brief badge, brief history, editing or dismissing risks, other locales.
- README / `.doc` updates (doc-writer after the reviewers).
- Clearing `file`/`line` on tab switch (Recommendation 3); persisted job state; a shared server injection guard (Recommendation 4).

## Revisions
- rev 1 · 2026-10-04 · Initial plan from implementation-planner: S1–S21, T1–T15, L1–L8 covering AC-1–AC-71 · PR Brief (SPEC-02) for server + client with an e2e flow, multi-agent; decides spec Q-1 (json + metadata columns), Q-2 (URL-driven focus), Q-3 (detached RunBus job), stale brief.json strings removed


**Plan status:** Ready
