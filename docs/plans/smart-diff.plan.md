# Development Plan: Smart Diff (reviewer-ordered Files changed tab)

**Spec:** none (criteria from request, L03 homework "Smart Diff"; S0 optionally writes the specs) · **Packages:** server, client, e2e · **Base:** `df00f96` (branch `L03-Subagents`; staged `A docs/skills/README.md` is unrelated) · **Revision:** 3

## Goal
On the PR page's "Files changed" tab, show PR files in role groups ordered core → tests → wiring → docs → boilerplate. The grouping comes from a new deterministic `GET /pulls/:id/smart-diff` route. Finding counters, per-file dots and inline Agent-runs-style finding cards come from live review data. A "Smart order | Original order" toggle switches back to the flat GitHub order.

## What already exists (verified at `df00f96`)

| Piece | State | Evidence |
|---|---|---|
| `SmartDiff` / `SmartDiffGroup` / `SmartDiffFile` / `ProposedSplit` Zod contracts | exist, **no producer, no route** | `server/src/vendor/shared/contracts/brief.ts:135-168` |
| `SmartDiffRole = z.enum(['core','wiring','boilerplate'])` | must gain `tests`, `docs` | `server/src/vendor/shared/contracts/brief.ts:136` |
| Client mirror of `brief.ts` | byte-identical today (`diff -q` clean) | `client/src/vendor/shared/contracts/brief.ts` |
| `SmartDiffResponse = SmartDiff` | declared, unused | `server/src/vendor/shared/contracts/review-api.ts:81-83` |
| `modules/index.ts` mentions "intent/smart-diff" | comment only; `intent` is registered, smart-diff is not | `server/src/modules/index.ts:23` |
| `container.reviewRepo` (`getPull` workspace-scoped, `getPrFiles`, `reviewsForPull`) | works | `server/src/platform/container.ts:109`, `server/src/modules/reviews/repository.ts:32-66` |
| `GET /pulls/:id` → `PrDetail.files[]` (`path, additions, deletions, patch?`), `additions`, `deletions`, `files_count` | works. It **rewrites `pr_files` (delete + insert, no transaction)** when a GitHub token is set | `server/src/modules/pulls/routes.ts:210-266`, `server/src/vendor/shared/contracts/platform.ts:165-219` |
| DiffViewer (`DiffViewer → FileCard → CodeLine`, `parsePatch`, `keysForLine`, `partitionThreads`, `OutdatedComments`, `AUTO_EXPAND_MAX_LINES = 200`) | works. **No tests.** `FileCard` is keyed by index | `client/src/components/diff-viewer/**` |
| `DiffTab` | renders `SectionLabel` "Files changed · N files" with literal copy ("Show/Hide comments", toast fallback) | `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx` |
| `FindingCard` (severity, title, rationale, suggestion, confidence, Accept/Dismiss via `onAction`) | works; used by `FindingsPanel` with `useFindingAction()` | `…/[number]/_components/FindingCard/FindingCard.tsx`, `…/FindingsPanel/FindingsPanel.tsx:30,74-84` |
| `usePrReviews(prId)` (`["reviews", prId]`), `useFindingAction()` (invalidates `["reviews", prId]`) | works | `client/src/lib/hooks/reviews.ts:52-58,139-161` |
| Reviews refetch after a run | **only** through `FindingsTab.onRunDone`, so it does not fire when `FindingsTab` is unmounted | `client/src/app/repos/[repoId]/pulls/[number]/page.tsx:163-168` |
| `SEV` tokens + `SeverityBadge` | work | `client/src/vendor/ui/primitives/tokens.ts:6`, `client/src/vendor/ui/primitives/Badge.tsx:52` |
| `prReview.json` → `smartDiff` (`coreLabel`, `wiringLabel`, `boilerplateLabel`, `largeTitle`, `largeBody`, `filesCount`, `findingLines`, `groupedByRole`) | exists; only `en` locale | `client/messages/en/prReview.json` |
| Seed PR #482: 4 files (`src/middleware/ratelimit.ts`, `src/api/public/webhooks.ts`, `src/config.ts`, `src/api/users.ts`), **no patches**, 2 findings (`src/config.ts:12` CRITICAL, `src/api/users.ts:45-52` WARNING) | works | `server/src/db/seed.ts:124-178` |
| Prior implementations on another lineage (reference only; not ancestors of HEAD, do not cherry-pick) | `ffe110c`, `3f2ed25`, `267807e` on `upstream/full-functionality` (`server/src/modules/reviews/smart-diff{,-constants}.ts`, `SmartDiffViewer`) | `git branch -a --contains ffe110c` → `remotes/upstream/full-functionality` only |

## Acceptance criteria
1. **AC1 — Role groups (P1 item 1).** In Smart order, the Files changed tab renders one group per non-empty role, in the order core → tests → wiring → docs → boilerplate. Each group header shows:
   - a collapse chevron;
   - a role colour square;
   - the role label and a short subtitle;
   - on the right, `● N` (N = number of **files** in the group with at least one open finding; shown only when N > 0) and `M files`.

   Within a group, files keep their `PrDetail.files` (GitHub) order.
2. **AC2 — Default collapse (P1 item 2).** `docs` and `boilerplate` groups start collapsed (their file cards are not rendered). `core`, `tests` and `wiring` start expanded. Clicking a group header toggles it.
3. **AC3 — Live finding indicators (P1 item 3).** Group counters and per-file dots are computed from `usePrReviews(prId)`. They appear or update without a page reload:
   - when a review run settles, whichever tab is open;
   - after Accept/Dismiss.

   A `FileCard` whose file has at least one open finding shows a dot indicator next to its path, beside the existing comment counter, with an accessible label from messages. "Open" means `dismissed_at == null` (D4).
4. **AC4 — Inline findings (P1 item 4).**
   - **Anchored findings.** In an expanded file, a finding whose `RIGHT:${start_line}` key matches a rendered line (`keysForLine`) is rendered directly under that line.
   - **Card.** The inline card is the existing `FindingCard`, expanded, with working Accept/Dismiss through `useFindingAction()`.
   - **Line marker.** The line gets a left bar in the severity colour (`SEV[sev].c`) and a `SeverityBadge` label. When several findings share the line, the most severe one sets the bar and label. No new colour palette is added.
   - **Unanchored findings.** A finding whose line is not in the patch (including `patch: null`) is rendered in a block at the top of the file body, titled with a count, in the same way as `OutdatedComments`.
5. **AC5 — Order toggle and header (P1 item 5).**
   - **Header.** The tab header reads "Reviewer-ordered diff" with the summary `<files_count> files · +<additions> −<deletions>`, taken from `PrDetail`.
   - **Toggle.** Next to it is a two-button segmented toggle, "Smart order | Original order", with Smart as the default. Original order renders the flat `PrDetail.files` list in GitHub order, with no group headers, and keeps the dots and inline findings.
   - **Loading and failure.** While the smart-diff query loads, the list shows a skeleton. If the query fails, the list shows an `ErrorState` with retry, and Original order stays usable.
6. **AC6 — Deterministic classifier.** `classifyFile(path)` is a pure function whose first matching rule wins, checked in this order:
   1. **boilerplate:** `*.lock`, `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `dist/**`, `build/**` (any depth), `**/__snapshots__/**`, `*.snap`, `*.generated.*`, `*.min.js`.
   2. **tests:** `**/*.test.ts(x)`, `**/*.it.test.ts`, `**/*.spec.ts`, `**/test/**`, `**/tests/**`, `**/__tests__/**`, `e2e/**`.
   3. **wiring:** basename `index.ts` / `index.js`, `*.config.*`, `tsconfig*.json`, `.eslintrc*`, `.env*`, `docker-compose*.yml|yaml`, `.github/**`, `.claude/**`.
   4. **docs:** `**/*.md`, `docs/**`, `README*`, `CHANGELOG*`, `LICENSE`.
   5. **core:** everything else.

   A table-driven test pins at least these cases:

   | Path | Role |
   |---|---|
   | `__tests__/__snapshots__/x.snap` | boilerplate |
   | `.claude/skills/security/SKILL.md` | wiring |
   | `e2e/README.md` | tests |
   | `package.json` | core |
   | `src/api/users.ts` | core |

   It also pins one positive case per rule (the full list is in T1).
7. **AC7 — Route.** `GET /pulls/:id/smart-diff`:
   - validates `params` with `IdParams` (a non-uuid id → 422);
   - is workspace-scoped (a PR in another workspace or a missing PR → 404 through `NotFoundError`);
   - makes no LLM, GitHub or git call;
   - returns `SmartDiffResponse`, serialized by its Zod schema.

   The response contains:
   - `groups` in AC1 order, with no empty groups;
   - per file, `finding_lines` = the sorted, de-duplicated union of `start_line..end_line` over all open findings of all reviews of the PR;
   - `pseudocode_summary: null`;
   - `split_suggestion` = `{ too_big: total_lines > SPLIT_THRESHOLD_LINES, total_lines, proposed_splits: [] }`.
8. **AC8 — Contract and mirror.** `SmartDiffRole` is `z.enum(['core','tests','wiring','docs','boilerplate'])` in `server/src/vendor/shared/contracts/brief.ts`, and `client/src/vendor/shared/contracts/brief.ts` is a byte-identical copy (`diff -q` clean).
9. **AC9 — Copy.** Every new user-facing string lives in messages. Strings rendered by the shared `client/src/components/diff-viewer/**` (role labels, subtitles, `M files`, counter + aria text, dot label, unanchored title) live under the viewer's own namespace `shell` → `diffViewer.*`, so `diff-viewer` never calls `useTranslations("prReview")`. Strings rendered by `DiffTab` (title, summary, toggle labels, load error) live under `smartDiff` in `client/messages/en/prReview.json`. The `DiffTab` header literals it replaces ("Files changed · … files", "Show comments", "Hide comments") also move to messages.

## Constraints
- **C1 — Architecture (server).** Per `onion-architecture`, *The rings, by real path* and *The DI container — resolve at construction*:
  - **New module.** `server/src/modules/smart-diff/` is a vertical slice.
    - `constants.ts` and `helpers.ts` are **ring 1 pure**. They import only `@devdigest/shared` and each other: no DB, no `db/rows.ts`, no container.
    - `service.ts` is **ring 1**. It declares a structural port `SmartDiffSource` (`getPull(ws, id)`, `getPrFiles(prId)`, `reviewsForPull(prId)`, typed with the minimal fields it reads). In its constructor it resolves `this.source = container.reviewRepo` and keeps no `container` field. It imports nothing from `modules/reviews/**` (rule `no-cross-module-internals`).
    - `routes.ts` is **ring 3**: `getContext` → one service call → DTO. It holds no business branching.
    - Each new file states its ring in its header comment.
  - **Errors.** Failures leave the service as `NotFoundError` (`platform/errors.ts`).
  - **Baseline.** `pnpm --dir server arch` stays at 0 errors / 17 warnings. Any raised count is a regression.
- **C2 — Architecture (client).** Per `frontend-ui-architecture`:
  - **Dependency direction.** `client/src/components/diff-viewer/` is app-wide and must **not** import the route-private `…/[number]/_components/FindingCard`. The inline card is injected through a render-prop API, `DiffFindingApi { findings: FindingRecord[]; renderFinding(f): ReactNode }`, built in `DiffTab`, the same seam as the existing `DiffCommentApi`. This follows *Colocation is the default* and keeps the dependency pointing from route to shared.
  - **Pure logic.** Grouping, finding indexing, partitioning and max-severity are plain functions in `diff-viewer/findings.ts` and `diff-viewer/helpers.ts`, not hooks (*Logic that needs React goes in a hook*).
  - **Data.** Data is read only through hooks in `client/src/lib/hooks/*`. The new `useSmartDiff` goes in `client/src/lib/hooks/smart-diff.ts`, following the precedent of `intent.ts`.
  - **Imports from `@devdigest/shared`.** They are `import type` only, and no runtime value comes from the barrel (see the C7 entry). The role order used by the client is the server response's order, and role colours and labels are a `Record<SmartDiffRole, …>` keyed by the type.
  - **Derived values.** Counters and dots are computed during render (`useMemo`), not stored in state.
  - **No new effects that set state.** The client lint baseline must not rise (TESTING.md: 0 errors / 13 warnings).
- **C3 — Contracts & data.**
  - Zod is edited only in `server/src/vendor/shared/contracts/brief.ts`, then copied whole-file to the client mirror. `SmartDiffResponse` (`review-api.ts`) is reused unchanged.
  - **No table, column or migration**: the route reads `pull_requests`, `pr_files`, `reviews`, `findings` through the existing `ReviewRepository` methods.
  - Tenancy is enforced by `getPull(workspaceId, prId)` **before** `reviewsForPull(prId)`, which is unscoped (see the C6 entry on `findings` tenancy).
- **C4 — Do not touch.**
  - `*/src/vendor/**`, except the S2 whole-file copy;
  - `server/src/db/migrations/**` and `server/src/db/schema/**` (no schema change);
  - `*/pnpm-lock.yaml` (no dependency is added);
  - `.claude/skills/**` and `server/.dependency-cruiser.cjs`;
  - every `CLAUDE.md`;
  - `server/src/db/seed.ts` (e2e flows assert on PR #482; this plan adds no seed data);
  - `client/src/vendor/ui/**` (the toggle is built from the existing `Button` with `active`; no new primitive).
- **C5 — Verification.** Every Verify cell names an existing command, or a test file created **in the same step**.
- **C6 — INSIGHTS (server).**
  - *2026-09-17 — `findings` has no `workspace_id`, so every aggregation over it must join `reviews`* → the service checks the PR against the workspace first (`getPull`) and only then reads `reviewsForPull(prId)`. T5 includes a cross-workspace 404.
  - *2026-09-20 — a "no DB" test that calls any route handler is DB-backed unless it injects `auth`* → the T4 smoke case only asserts the 422 from `IdParams` (the handler never runs). Every service test is hermetic with a fake `SmartDiffSource`, not through `buildApp`.
  - *2026-09-20 — `pnpm arch`: the baseline is 0 errors / 17 warnings* → S3–S5 each end on `arch` at 0 / 17. The structural `SmartDiffSource` port avoids the `no-cross-module-internals` warning a `import type { ReviewRepository }` would add.
  - Also binding: *2026-09-17 — a "missing" feature is often surgically removed* → the prior `ffe110c`/`267807e` classifier is reference-only. Its rule order (docs before tests, `package.json` → boilerplate) **differs** from this plan's rules, so do not copy it.
- **C7 — INSIGHTS (client).**
  - *2026-09-17 — importing a value from `@devdigest/shared` compiles and tests green, then `next dev` serves 500 on every route* → type-only imports. S13 loads `/repos/<id>/pulls/482?tab=diff` on a running stack.
  - *2026-09-20 — an `EventSource` hook that resets its state inside the effect trips `react-hooks/set-state-in-effect`* → `useSmartDiff` is plain TanStack Query. The page's run-settle invalidation (S11) calls `qc.invalidateQueries` only and never sets state in an effect.
  - *2026-09-17 — `ReviewRecord` and `RunSummary` are different objects* → finding data comes from `ReviewRecord.findings` (`usePrReviews`). No finding field is added to `PrFile` or to the smart-diff DTO beyond the contract's `finding_lines`.
- **C8 — INSIGHTS (root).** *2026-09-17 — findings by severity* (green `typecheck` + `test` does not prove the app boots → S13). *2026-09-16 — `EADDRINUSE` on :3001 right after Ctrl-C* (S13 stops every server it starts). `e2e/INSIGHTS.md` holds only its template.

## Decisions
- **D1 — Where the classifier lives: server only, ring 1 (`modules/smart-diff/helpers.ts` + `constants.ts`).**
  - **Why not `vendor/shared`.** `server/src/vendor/shared` holds Zod contracts and port interfaces, not behaviour. Putting logic there would ship it into every mirror.
  - **Why the client does not classify.** Original order needs no classifier (it is `PrDetail.files` as-is). Smart order consumes the route, which the homework requires. So there is one source of truth, tested once, hermetically.
  - **Cost.** One extra cheap DB-only request per tab open.
  - **Reference.** Prior art (`ffe110c`) put the classifier inside `modules/reviews/`. A separate `smart-diff` module keeps the reviews slice untouched, matching the AGENTS.md "self-contained `src/modules/<name>/`" rule.
- **D2 — Grouping from the route, finding overlay from live reviews.**
  - **Server.** The route owns **roles and order**.
  - **Client.** The client owns **finding indicators**, which it derives from `usePrReviews(prId)` using the same `allFindings` set as the page's severity counters (all reviews, `runs.flatMap(r => r.findings)`). Counters therefore follow the existing `["reviews", prId]` invalidations (run settled, `useFindingAction`) with no extra round-trip.
  - **`finding_lines`.** The route still fills `finding_lines` (the contract requires it), and `["smart-diff", prId]` is invalidated on run settle so the DTO does not go stale. The UI does not read it in P1.
- **D3 — Client file placement.**
  - `client/src/components/diff-viewer/FileGroup/` (create) holds the group header and collapse state.
  - `diff-viewer/findings.ts` (create) holds `DiffFindingApi`, `findingsForFile`, `isOpenFinding`, `partitionFindings(findings, renderedKeys)` → `{ matched: Map<key, FindingRecord[]>, unanchored }` keyed by `lineKey('RIGHT', f.start_line)`, and `maxSeverity`.
  - `diff-viewer/helpers.ts` (modify) holds `orderBySmartDiff(files, smartDiff)` → `{ role, files: PrFile[] }[]`. It keeps `PrDetail.files` order inside a group, and a PR file missing from the response goes to `core` (R1).
  - `diff-viewer/constants.ts` (modify) holds `ROLE_COLOR: Record<SmartDiffRole, string>` over **existing** tokens (`--accent`, `--ok`, `--info`, `--text-muted`, `--border-strong`) and `DEFAULT_COLLAPSED_ROLES = new Set(['docs','boilerplate'])`.
  - `diff-viewer/UnanchoredFindings/` (create) is the top-of-body block, patterned on `OutdatedComments`.
  - `FileCard` keys become `file.path`, not the index, so a file's open state survives regrouping and toggling.
- **D4 — "Has findings" means at least one finding with `dismissed_at == null`** (accepted ones still count). Dismissed findings are still rendered inline (`FindingCard` shows them muted) but do not light the dot or the counter. This makes Accept/Dismiss visibly live in the demo. Alternative: count every finding (Q1).
- **D5 — Toggle state is local `useState` in `DiffTab`, default `smart`**, not a URL param. The toggle is `Button` × 2 with `active` and `aria-pressed` inside a `role="group"` wrapper, labelled from messages.
- **D6 — Run-settle refresh independent of the active tab.** `page.tsx` watches `reviewRunning` (derived from the polled `usePrActiveRuns`). On a `true → false` transition it invalidates `["reviews", prId]`, `["pr-runs", prId]` and `["smart-diff", prId]`. It tracks the previous value with a ref in an effect that only calls `invalidateQueries`. `FindingsTab.onRunDone` also invalidates `["smart-diff", prId]`.
- **D7 — Pinned classifier decisions.**
  - `e2e/README.md` → **tests** (tests rule precedes docs; the file documents the test suite).
  - `package.json` → **core** (a dependency change is a behaviour change worth review; it is not in any rule list).
  - `.claude/**` → **wiring** (agent configuration, even when `.md`).
  - Every `index.ts` / `index.js` basename → wiring, since a barrel cannot be told from a path (R3).
  - `dist/` and `build/` match at any depth.
  - `docker-compose*.yml` also accepts `.yaml`.
  - `*.spec.md` → docs (only `*.spec.ts` is tests).
  - Matching is case-sensitive, on `/`-separated repo-relative paths.
- **D8 — Rule table and display order are two explicit constants.**
  - `ROLE_ORDER = ['core','tests','wiring','docs','boilerplate'] as const satisfies readonly SmartDiffRole[]` in `constants.ts` is the display order. Grouping never relies on `SmartDiffRole.options` order, so the enum in `vendor/shared` carries no layout meaning.
  - `ROLE_RULES` is declarative: an ordered `[SmartDiffRole, Matcher[]][]` built from small named matchers in `helpers.ts` (`name(...)`, `ext(...)`, `suffix(...)`, `prefix(...)`, `infix(...)`, `dir(...)` = any path segment, `root(...)` = first segment, and a minimal `glob` for `tsconfig*.json` / `docker-compose*.y{a,}ml`), so the table reads like the AC6 list. No glob dependency is added (C4).

## Steps
| ID | Package | Files (create / modify) | Change | Skills (routing bucket) | Covers | Verify |
|----|---------|-------------------------|--------|-------------------------|--------|--------|
| S0 | server, client | `server/.spec/smart-diff.spec.md`, `client/.spec/smart-diff.spec.md` (create) | Only if Q3 = yes: restate AC1–AC9 and D1–D7 as spec criteria, following `server/.spec/README.md` / `client/.spec/README.md` style | `doc-standards`, `file-conventions` (docs) | all | `rg -c 'AC[1-9]' server/.spec/smart-diff.spec.md client/.spec/smart-diff.spec.md` |
| S1 | server | `server/src/vendor/shared/contracts/brief.ts` (modify) | `SmartDiffRole` → `z.enum(['core','tests','wiring','docs','boilerplate'])`. Nothing else in the file changes (display order lives in `ROLE_ORDER`, D8) | `zod` (contracts), `typescript-expert` (types) | AC8 | `pnpm --dir server typecheck` |
| S2 | client | `client/src/vendor/shared/contracts/brief.ts` (modify: whole-file byte copy) | Mirror S1 verbatim | repo-hygiene | AC8 | `diff -q server/src/vendor/shared/contracts/brief.ts client/src/vendor/shared/contracts/brief.ts && pnpm --dir client typecheck` |
| S3 | server | `server/src/modules/smart-diff/constants.ts`, `server/src/modules/smart-diff/helpers.ts` (create); `server/test/smart-diff-helpers.test.ts` (create) | Ring 1 pure. `ROLE_ORDER` + declarative `ROLE_RULES` (D8, AC6/D7), `SPLIT_THRESHOLD_LINES = 400`. `classifyFile(path)`. `buildSmartDiff(files: {path,additions,deletions}[], findings: {file,startLine,endLine,dismissedAt}[]) → SmartDiff`: group in `ROLE_ORDER`, drop empty groups, keep input order inside a group, `finding_lines` over open findings, `pseudocode_summary: null`, `split_suggestion` per AC7. Tests T1 + T2 | `onion-architecture` (backend-arch), `zod` (contracts, for the `SmartDiff` shape), `typescript-expert` (types) | AC6, AC7 | `pnpm --dir server typecheck && pnpm --dir server exec vitest run test/smart-diff-helpers.test.ts && pnpm --dir server arch` (0 / 17) |
| S4 | server | `server/src/modules/smart-diff/service.ts` (create); `server/test/smart-diff-service.test.ts` (create) | `SmartDiffService(container)`: constructor resolves `this.source = container.reviewRepo` (typed as structural `SmartDiffSource`); `forPull(workspaceId, prId)` → `getPull` (else `NotFoundError('Pull request not found')`) → `getPrFiles` + `reviewsForPull` → `buildSmartDiff`. No `this.container.*`, no import from `modules/reviews/**` or `db/**`. Test T3 with a fake source object | `onion-architecture` (backend-arch) | AC7 | `pnpm --dir server typecheck && pnpm --dir server exec vitest run test/smart-diff-service.test.ts && pnpm --dir server arch` (0 / 17); `! rg -n "modules/reviews\|db/rows\|drizzle" server/src/modules/smart-diff` |
| S5 | server | `server/src/modules/smart-diff/routes.ts` (create); `server/src/modules/index.ts` (modify); `server/test/routes-smoke.test.ts` (modify) | `GET /pulls/:id/smart-diff` with `schema: { params: IdParams, response: { 200: SmartDiffResponse } }`; handler = `getContext` → `service.forPull` → return. The service is built once at plugin registration. Register `smartDiff` in `modules`, and update the header comment. T4 smoke case | `fastify-best-practices` (backend-http), `onion-architecture` (backend-arch), `security` (security: `routes.ts`) | AC7 | `pnpm --dir server typecheck && pnpm --dir server lint && pnpm --dir server arch && pnpm --dir server exec vitest run test/routes-smoke.test.ts` |
| S6 | server | `server/test/smart-diff.it.test.ts` (create); `server/test/contracts.test.ts` (modify) | T5 DB-backed route test over the seeded PR #482 (+ a second workspace); T6 contract case for the new roles | `onion-architecture` (mocks via `adapters/mocks.ts`), read `TESTING.md` | AC6, AC7, AC8 | `CI=1 pnpm --dir server exec vitest run test/smart-diff.it.test.ts test/contracts.test.ts` (needs Docker, R8) |
| S7 | client | `client/src/lib/hooks/smart-diff.ts` (create); `client/src/lib/hooks/index.ts` (modify) | `useSmartDiff(prId)` → `useQuery({ queryKey: ["smart-diff", prId], queryFn: () => api.get<SmartDiffResponse>(\`/pulls/${prId}/smart-diff\`), enabled: !!prId })`. Type-only import. No effect | `frontend-ui-architecture`, `react-best-practices`, `next-best-practices` (frontend) | AC1, AC5 | `pnpm --dir client typecheck && pnpm --dir client lint` (errors 0, warnings not above the baseline) |
| S8 | client | `client/messages/en/prReview.json` (modify) | Under `smartDiff`, add:<br>• `title` ("Reviewer-ordered diff")<br>• `summary` ("{files} files · +{additions} −{deletions}")<br>• `smartOrder`, `originalOrder`, `orderLabel`<br>• `testsLabel`, `docsLabel`<br>• `coreSubtitle`, `testsSubtitle`, `wiringSubtitle`, `docsSubtitle`, `boilerplateSubtitle`<br>• `filesWithFindings` ("● {count}"), `filesWithFindingsAria` ("{count} files with findings")<br>• `hasFindings`<br>• `unanchoredTitle` ("{count} finding(s) not on a shown line")<br>• `loadFailed`<br>• `showComments`, `hideComments`, `commentFailed`<br>Keep the existing keys | `frontend-ui-architecture` (frontend) | AC9 | `node -e "const m=require('./client/messages/en/prReview.json').smartDiff;for(const k of ['title','summary','smartOrder','originalOrder','testsLabel','docsLabel','coreSubtitle','testsSubtitle','wiringSubtitle','docsSubtitle','boilerplateSubtitle','filesWithFindings','hasFindings','unanchoredTitle','loadFailed'])if(!m[k])throw k"` (run from the repo root) |
| S9 | client | `client/src/components/diff-viewer/findings.ts` (create), `client/src/components/diff-viewer/helpers.ts`, `client/src/components/diff-viewer/constants.ts` (modify); `client/src/components/diff-viewer/findings.test.ts`, `client/src/components/diff-viewer/helpers.test.ts` (create) | D3 pure modules: `DiffFindingApi`, `findingsForFile`, `isOpenFinding`, `partitionFindings` (reuses `lineKey`/`keysForLine` from `comments.ts`), `maxSeverity`; `orderBySmartDiff`; `ROLE_COLOR`, `DEFAULT_COLLAPSED_ROLES`. Tests T7, T8 | `frontend-ui-architecture` (frontend), `react-testing-library` (frontend-tests), `typescript-expert` (types) | AC1, AC3, AC4 | `pnpm --dir client typecheck && pnpm --dir client exec vitest run src/components/diff-viewer` |
| S10 | client | `client/src/components/diff-viewer/FileGroup/{FileGroup.tsx,index.ts}` (create), `client/src/components/diff-viewer/UnanchoredFindings/{UnanchoredFindings.tsx,index.ts}` (create); `DiffViewer/DiffViewer.tsx`, `FileCard/FileCard.tsx`, `CodeLine/CodeLine.tsx`, `styles.ts`, `index.ts` (modify); `DiffViewer/DiffViewer.test.tsx` (create) | **DiffViewer.** New props `groups?: { role; files: PrFile[] }[] \| null` (Smart order when set, else flat) and `findings?: DiffFindingApi`.<br>**FileGroup.** Header per AC1 (chevron, `ROLE_COLOR` square, label + subtitle from `prReview.smartDiff`, `● N` only when N > 0 with `filesWithFindingsAria`, `filesCount`); collapse state is initialised from `DEFAULT_COLLAPSED_ROLES`.<br>**FileCard.** Dot beside the path (next to the comment counter) when the file has open findings; `partitionFindings` against the rendered keys; `UnanchoredFindings` at the top of the body; keyed by `file.path`.<br>**CodeLine.** Optional `lineFindings`: severity left bar (`SEV[maxSeverity].c`) + `SeverityBadge` + `findings.renderFinding(f)` for each finding under the line, after the comment threads.<br>**No import** from `src/app/**`. T9 | `frontend-ui-architecture`, `react-best-practices`, `vercel-react-best-practices` (frontend), `react-testing-library` (frontend-tests) | AC1–AC5 | `pnpm --dir client typecheck && pnpm --dir client lint && pnpm --dir client exec vitest run src/components/diff-viewer`; `! rg -n "from \"@/app\|_components" client/src/components/diff-viewer` |
| S11 | client | `…/[number]/_components/DiffTab/DiffTab.tsx` (modify), `…/[number]/_components/DiffTab/DiffTab.test.tsx` (create); `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`, `…/[number]/_components/FindingsTab/FindingsTab.tsx` (modify) | **DiffTab.** New props `additions`, `deletions`, `repoFullName`, `headSha`. It uses `useSmartDiff`, `usePrReviews`, `useFindingAction`. Header: `SectionLabel` with `title` + `summary`, and on the right the D5 toggle + the existing comments button (strings from S8). Builds `DiffFindingApi` whose `renderFinding` returns `<FindingCard f defaultExpanded pending onAction={(a) => action.mutate({ findingId: f.id, action: a, prId })} repoFullName headSha />`. Loading → `Skeleton`; error → `ErrorState` + retry (AC5).<br>**page.tsx.** Passes the new props and adds the D6 run-settle invalidation.<br>**FindingsTab.** `onRunDone` also invalidates `["smart-diff", prId]` (through the page callback). T10 | `frontend-ui-architecture`, `react-best-practices`, `next-best-practices` (frontend), `react-testing-library` (frontend-tests) | AC3, AC4, AC5, AC9 | `pnpm --dir client typecheck && pnpm --dir client lint && pnpm --dir client test` |
| S12 | e2e | `e2e/specs/09-smart-diff.flow.json` (create) | T11 flow on seeded PR #482 (R7 explains `09`) | read `e2e/AGENTS.md` + `TESTING.md` (e2e) | AC1, AC3, AC4, AC5 | `pnpm --dir e2e lint`; `pnpm --dir e2e test` against a freshly seeded running stack |
| S13 | server, client | none (runtime evidence) | Bring up the stack (`./scripts/dev.sh`, or compose + `db:migrate` + `db:seed` + both dev servers). Then check that `curl -s localhost:3001/pulls/<prId-of-482>/smart-diff` returns one `core` group with 4 files and `finding_lines` `[12]` for `src/config.ts`, and that `curl -s -o /dev/null -w '%{http_code}' 'localhost:3000/repos/<id>/pulls/482?tab=diff'` returns `200`. Record the output in the Implementation Report, then stop every server started and confirm `lsof -nP -iTCP:3001 -sTCP:LISTEN` is empty | read root `AGENTS.md` *Commands* + root INSIGHTS (C8) | AC5, AC7 | the two `curl` results above |
| S14 | server, client | `server/README.md` (modify: module map line `smart-diff /pulls/:id/smart-diff`, near line 73), `client/README.md` (modify: add `/pulls/:id/smart-diff` to the PR route's endpoint list) | Document the route and the D1/D2 split (roles from the server, findings from live reviews) | `doc-standards`, `file-conventions` (docs) | AC7 | `rg -n 'smart-diff' server/README.md client/README.md` |
| S15 | all touched | `server/INSIGHTS.md`, `client/INSIGHTS.md`, `e2e/INSIGHTS.md` (append only) | Run `engineering-insights`; append only substantial, non-obvious findings (for example, how the render-prop seam lets a shared component host a route-private card). Never edit an entry | `engineering-insights` | — | `git diff` shows only `+` lines in the `INSIGHTS.md` files |

## Test plan
| Test | Kind (unit / `*.it.test.ts` / client RTL / e2e flow) | Covers | File |
|------|------------------------------------------------------|--------|------|
| T1 classifier table. **Pinned by the request:** `__tests__/__snapshots__/x.snap`→boilerplate, `.claude/skills/security/SKILL.md`→wiring, `e2e/README.md`→tests, `package.json`→core, `src/api/users.ts`→core. **One case per rule:** `server/pnpm-lock.yaml`, `yarn.lock`, `client/dist/app.js`, `schema.generated.ts`, `vendor.min.js`→boilerplate; `FindingCard.test.tsx`, `reviews.it.test.ts`, `src/x.spec.ts`, `server/test/helpers/pg.ts`, `e2e/specs/05-pr-diff.flow.json`→tests; `server/src/modules/index.ts`, `vitest.config.ts`, `tsconfig.build.json`, `.eslintrc.json`, `.env.example`, `docker-compose.yml`, `.github/workflows/ci.yml`→wiring; `docs/plans/x.plan.md`, `server/INSIGHTS.md`, `README.md`, `CHANGELOG`, `LICENSE`, `server/.spec/intent-layer.spec.md`→docs; `src/config.ts`→core | unit (hermetic) | AC6 | `server/test/smart-diff-helpers.test.ts` (create, S3) |
| T2 `buildSmartDiff`: group order core→tests→wiring→docs→boilerplate, empty groups omitted, input order kept inside a group; `finding_lines` = sorted unique union of ranges, dismissed excluded, other files empty; `split_suggestion.total_lines` = Σ(add+del), `too_big` at threshold + 1, `proposed_splits: []`; `SmartDiff.parse(result)` succeeds | unit (hermetic) | AC6, AC7 | `server/test/smart-diff-helpers.test.ts` (create, S3) |
| T3 `SmartDiffService.forPull` with a fake `SmartDiffSource`: missing pull → `NotFoundError`, and `reviewsForPull` is **not** called; a happy path maps files + findings from all reviews | unit (hermetic) | AC7 | `server/test/smart-diff-service.test.ts` (create, S4) |
| T4 `GET /pulls/not-a-uuid/smart-diff` → 422 (the handler never runs, so no `auth` injection is needed; C6) | unit (no DB) | AC7 | `server/test/routes-smoke.test.ts` (modify, S5) |
| T5 seeded PR #482 → 200, one `core` group with 4 files in order, `src/config.ts` `finding_lines` `[12]`, `src/api/users.ts` `[45..52]`; after dismissing the config finding (`POST /findings/:id/dismiss`) its `finding_lines` is `[]`; a PR id from another workspace → 404 | `*.it.test.ts` | AC7 | `server/test/smart-diff.it.test.ts` (create, S6) |
| T6 `SmartDiffRole` parses `tests` and `docs`, rejects `misc` | unit | AC8 | `server/test/contracts.test.ts` (modify, S6) |
| T7 `partitionFindings`: a finding on `RIGHT:newNo` of an added or context line → matched; a line not in the patch, or an empty patch → unanchored; `isOpenFinding` excludes dismissed; `maxSeverity([SUGGESTION, CRITICAL]) === 'CRITICAL'` | unit (client) | AC3, AC4 | `client/src/components/diff-viewer/findings.test.ts` (create, S9) |
| T8 `orderBySmartDiff`: group order from the response, `PrDetail.files` order inside a group, an unknown path → core, empty groups dropped | unit (client) | AC1 | `client/src/components/diff-viewer/helpers.test.ts` (create, S9) |
| T9 DiffViewer (RTL, `NextIntlClientProvider` with `prReview` + `shell` messages): one flow asserting all of:<br>• groups render in order with labels and subtitles;<br>• `M files` on each group;<br>• `● N` only on groups with open-finding files;<br>• docs/boilerplate file paths are absent until their header is clicked;<br>• the flat list when `groups` is null;<br>• the dot label on a file with findings;<br>• the inline `renderFinding` output under the matching line with the severity label;<br>• an out-of-patch finding in the unanchored block | client RTL | AC1, AC2, AC3, AC4 | `client/src/components/diff-viewer/DiffViewer/DiffViewer.test.tsx` (create, S10) |
| T10 DiffTab (RTL, real `QueryClientProvider`, `fetch` mocked at the boundary for `/pulls/:id/smart-diff`, `/reviews`, `/comments`, `/findings/:id/accept`): one flow asserting all of:<br>• header summary "9 files · +247 −38";<br>• Smart order is pressed by default and groups are visible;<br>• clicking Accept on the inline card POSTs `/findings/<id>/accept`;<br>• switching to Original order shows the flat GitHub order with no group headers;<br>• smart-diff 500 → `loadFailed` + retry | client RTL | AC3, AC4, AC5, AC9 | `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.test.tsx` (create, S11) |
| T11 PR #482 → "Files changed" → wait for "Smart order", "Core", "4 files" → wait for "Hardcoded Stripe secret key in commit" (seed has no patch, so it is in the unanchored block of the auto-expanded `src/config.ts`) → click "Original order" → wait for `src/api/users.ts`. No Run review, no LLM | e2e flow | AC1, AC4, AC5 | `e2e/specs/09-smart-diff.flow.json` (create, S12) |

## Demo script (1–3 min video, P1)
1. **Setup.** Use a stack with a GitHub token and a real PR that touches core code, tests, a barrel or config, a `.md` file and `pnpm-lock.yaml`. Open `/repos/<id>/pulls/<n>`.
2. **Header.** Click **Files changed**. Point at "REVIEWER-ORDERED DIFF", "N files · +A −D", and the **Smart order** toggle, which is pressed.
3. **Groups.** Walk the groups in order Core → Tests → Wiring → Docs → Boilerplate, reading each colour square, label, subtitle and `M files`.
4. **Default collapse.** Docs and Boilerplate are collapsed. Expand Boilerplate to show that `pnpm-lock.yaml` landed there, then collapse it again.
5. **Run review.** Click **Run review** (the header dropdown moves to Agent runs), wait for the run to finish, and return to **Files changed**.
6. **Indicators.** Group headers now show `● N`, and affected files show a dot next to the path.
7. **Inline finding.** Expand a flagged core file. Under the flagged line, show the severity bar + label and the inline finding card: severity, title, rationale, suggestion, confidence.
8. **Actions.** Click **Accept** on one card (it is marked Accepted). Click **Dismiss** on another: it goes muted, and the file's dot and the group's `● N` update (D4).
9. **Original order.** Click **Original order**: a flat GitHub-order list with dots and inline findings still present. Switch back to **Smart order**.

## Review hand-off
- **Architecture review:**
  - `server/src/modules/smart-diff/{constants,helpers,service,routes}.ts` + `server/src/modules/index.ts` — a new vertical slice. Check ring headers, the structural `SmartDiffSource` port (no import from `modules/reviews/**`), that the constructor resolves its dependency with no `this.container.*`, that each handler is context → one call → DTO, and that `arch` stays at 0 / 17.
  - `server/src/vendor/shared/contracts/brief.ts` + its client mirror — enum extension and byte parity.
  - `client/src/components/diff-viewer/**` — the render-prop seam (`DiffFindingApi`), no import from `src/app/**`, pure `findings.ts`/`helpers.ts`, keys by path, no new state-setting effects.
  - `client/src/app/repos/[repoId]/pulls/[number]/{page.tsx,_components/DiffTab/**,_components/FindingsTab/FindingsTab.tsx}` + `client/src/lib/hooks/smart-diff.ts` — hook placement, D6 invalidation effect, type-only shared imports, no literal copy.
- **Security review:**
  - `server/src/modules/smart-diff/routes.ts` (security bucket: `modules/*/routes.ts`) — `IdParams` uuid validation, workspace scoping via `getPull` before the unscoped `reviewsForPull` (C3/C6), and no rate limit needed (DB-only, no LLM). The response exposes only paths, counts and line numbers already visible through `GET /pulls/:id` and `/reviews`.

## Risks / open questions
- **R1 `pr_files` rewrite race** (S4, S9, S11). `GET /pulls/:id` deletes and re-inserts `pr_files` without a transaction. `DiffTab` mounts only after `usePullDetail` resolves, so `/smart-diff` normally reads after the rewrite. If it ever reads a partial set, `orderBySmartDiff` puts any PR file missing from the response in `core`, so no file disappears.
- **R2 Duplicate findings across runs** (S10, S11). Each run is its own review, so re-running an agent can put two near-identical cards on one line. This matches the header severity counters (same `allFindings` set). De-duplication is out of scope.
- **R3 Path-only heuristics** (S3). Every `index.ts` is "wiring" even when it is an entry point. `build/` at any depth could catch a source folder named `build`. Findings on deleted lines (LEFT side) never anchor and go to the unanchored block. All three are accepted and pinned by T1/T7.
- **R4 Lint baseline** (S7, S10, S11). The D6 effect must only call `invalidateQueries`. Setting state in it would add a `react-hooks/set-state-in-effect` warning (C7).
- **R5 Large files** (S10). Files over `AUTO_EXPAND_MAX_LINES` stay collapsed. Their dot and the group counter still flag them; the inline card appears on expand.
- **R6 Literal copy in `DiffTab`** (S11). The header strings move to messages. The `notify.error` fallback also moves (`commentFailed`). Nothing else in `DiffTab` is refactored.
- **R7 e2e numbering** (S12). `08-` is claimed by the deferred intent-layer flow (`docs/plans/intent-layer.plan.md` T15), so this flow is `09-smart-diff.flow.json`. The run order is unaffected by the gap.
- **R8 Docker for T5** (S6). `*.it.test.ts` uses testcontainers. If Docker is unavailable, report it; do not mark S6 done on the unit lane alone.
- **Q1 — What lights the dot and `● N`:** (a) open findings only, `dismissed_at == null` (**recommended**, D4; Dismiss visibly clears the signal); (b) every finding, including dismissed.
- **Q2 — Toggle persistence:** (a) local state, default Smart (**recommended**, D5); (b) a `?order=` URL param, like `?severity=`.
- **Q3 — Write `server/.spec/smart-diff.spec.md` + `client/.spec/smart-diff.spec.md` first (S0), per root `AGENTS.md`:** (a) yes (**recommended**); (b) this plan is the spec.

Resolved (rev 2): Q1 (a), Q2 (a), Q3 (a) — the user accepted the recommended defaults and asked to start implementation.

## Out of scope
- **O1** — P2: the `pseudocode_summary` "What this does" chip (always `null` in P1).
- **O2** — P2: the `split_suggestion` banner and `proposed_splits` computation (`too_big`/`total_lines` are returned; the banner and splits are not). The existing `largeTitle`/`largeBody` keys stay unused.
- **O3** — P3: the file dot coloured by max severity (P1 uses one neutral accent dot).
- **O4** — P3: per-comment collapse ✕ on inline finding cards.
- **O5** — Findings whose `file` is not among the PR files (renames, stale paths). They remain visible in the Agent runs tab only.
- **O6** — LLM-assisted classification, persisting SmartDiff into `pr_brief`, and a per-repo classifier configuration.
- **O7** — Locales other than `en` (only `client/messages/en` exists).
- **O8** — Refactoring pre-existing `DiffViewer`/`DiffTab` code beyond what S10/S11 touch, and de-duplicating findings across runs.

## Fix round 1 (rev 3)
From the iteration-1 reviews (`.harness/retros/smart-diff.retro.md`). Same constraints C1–C8 apply.

| ID | Package | Files | Change | Covers | Verify |
|----|---------|-------|--------|--------|--------|
| F1 | client | `client/src/components/diff-viewer/helpers.ts`, `helpers.test.ts` | `orderBySmartDiff` keeps **`PrDetail.files` order inside each group** (sort each group's files by their index in the input `files`), roles still in the response's group order, missing → core. Rewrite T8 so one group holds two files whose response order differs from `PrDetail.files` order, and assert the `PrDetail.files` order wins | AC1, D3, T8 | `pnpm --dir client exec vitest run src/components/diff-viewer` |
| F2 | client | `client/messages/en/shell.json` (or wherever `diffViewer.*` lives), `client/messages/en/prReview.json`, `diff-viewer/{FileCard,FileGroup,UnanchoredFindings}/*.tsx`, `client/src/test/smoke.test.tsx`, affected tests | Move the viewer-rendered keys (AC9 rev 3) from `prReview.smartDiff` to `shell` → `diffViewer.*`; `diff-viewer` reads only its own namespace. Revert the `prReview` addition in `smoke.test.tsx` if it is no longer needed. Keep `DiffTab` strings in `prReview.smartDiff` | AC9, arch minor #1 | `! rg -n 'useTranslations\("prReview"\)' client/src/components/diff-viewer`; `pnpm --dir client test` |
| F3 | client | `DiffViewer/DiffViewer.test.tsx` | T9: fixture includes a wiring and a boilerplate file; assert the **rendered order** of group headers (core → tests → wiring → docs → boilerplate) via DOM order; expand Boilerplate by click; assert the file order inside a multi-file group | AC1, AC2, T9 | `pnpm --dir client exec vitest run src/components/diff-viewer` |
| F4 | client | `DiffTab/DiffTab.test.tsx` | T10: on smart-diff 500 click the retry control and assert a second `/smart-diff` request; in Original order assert the flat DOM order equals `PrDetail.files`, and that the dot and the inline finding are still rendered; after Dismiss (mocked `POST /findings/:id/dismiss` + refetched reviews with `dismissed_at`) the dot and `● N` disappear | AC3, AC5, D4, T10 | `pnpm --dir client exec vitest run "src/app/repos/[repoId]/pulls/[number]/_components/DiffTab"` |
| F5 | client | a test next to `page.tsx` (or an extracted, tested hook if the effect needs a seam) | D6: when active runs go from running → none, `["reviews", prId]`, `["pr-runs", prId]` and `["smart-diff", prId]` are invalidated, independent of the active tab. If extracting a hook (e.g. `useInvalidateOnRunSettle`) is the smallest testable seam, place it under `client/src/lib/hooks/` and keep it state-free | AC3, D6 | `pnpm --dir client test && pnpm --dir client lint` (0 errors, ≤ 13 warnings) |
| F6 | client | `client/INSIGHTS.md` (append only) | Only if a non-obvious finding emerges (e.g. why `pr_files` order is not guaranteed without `ORDER BY`, so the client re-imposes `PrDetail.files` order) | — | `git diff` shows only `+` lines |

Not in this round: AC3 dot placement (the mock places it right after the path), `ORDER BY` on `pr_files` reads (other modules; recorded, not changed), e2e run and S13 re-run (user runs them with the demo stack).

## Revisions
- rev 1 · 2026-09-26 · Initial plan from planner: S0–S15, AC1–AC9, T1–T11, D1–D7, R1–R8, Q1–Q3, O1–O8, demo script · L03 Smart Diff homework: role-grouped Files changed tab (core → tests → wiring → docs → boilerplate) from a new deterministic `GET /pulls/:id/smart-diff` route, with live finding counters, dots, inline FindingCards, and a Smart/Original order toggle
- rev 2 · 2026-09-26 · Added D8 (explicit `ROLE_ORDER`, declarative matcher table instead of raw `RegExp[]`); S1/S3 updated to match; Q1–Q3 resolved to their recommended options · server architecture discussion with the user
- rev 3 · 2026-09-26 · AC9 split between `shell.diffViewer.*` (shared viewer) and `prReview.smartDiff` (DiffTab); added Fix round 1 (F1–F6) · iteration-1 architecture review (1 minor) + plan verification (10 partial); user chose fix items 1–3

**Plan status:** Ready
