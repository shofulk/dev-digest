# Smart Diff — `server`

## Goal

Serve a deterministic, role-grouped view of a PR's changed files (core → tests → wiring →
docs → boilerplate) with per-file open-finding line numbers, from a new
`GET /pulls/:id/smart-diff` route that makes no LLM, GitHub or git call.

## Acceptance criteria

1. **AC6 — Deterministic classifier.** `classifyFile(path)` is a pure function whose first
   matching rule wins, checked in this order:
   1. **boilerplate:** `*.lock`, `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`,
      `dist/**`, `build/**` (any depth), `**/__snapshots__/**`, `*.snap`, `*.generated.*`,
      `*.min.js`.
   2. **tests:** `**/*.test.ts(x)`, `**/*.it.test.ts`, `**/*.spec.ts`, `**/test/**`,
      `**/tests/**`, `**/__tests__/**`, `e2e/**`.
   3. **wiring:** basename `index.ts` / `index.js`, `*.config.*`, `tsconfig*.json`,
      `.eslintrc*`, `.env*`, `docker-compose*.yml|yaml`, `.github/**`, `.claude/**`.
   4. **docs:** `**/*.md`, `docs/**`, `README*`, `CHANGELOG*`, `LICENSE`.
   5. **core:** everything else.

   Pinned decisions: `e2e/README.md` → tests (tests rule precedes docs); `package.json` →
   core; `.claude/**` → wiring (even `.md`); every `index.ts`/`index.js` basename → wiring;
   `dist/`/`build/` match at any depth; `docker-compose*.yml` also accepts `.yaml`;
   `*.spec.md` → docs (only `*.spec.ts` is tests). Matching is case-sensitive, on
   `/`-separated repo-relative paths. Display order is a separate constant, `ROLE_ORDER`,
   independent of the `SmartDiffRole` enum's declaration order.

2. **AC7 — Route.** `GET /pulls/:id/smart-diff`:
   - validates `params` with `IdParams` (a non-uuid id → 422 — the handler never runs);
   - is workspace-scoped: `getPull(workspaceId, prId)` runs before `reviewsForPull(prId)`
     (which is unscoped), and a PR in another workspace or a missing PR → 404 via
     `NotFoundError`;
   - makes no LLM, GitHub or git call, and reads only `pull_requests`, `pr_files`,
     `reviews`, `findings` through the existing `ReviewRepository`;
   - returns `SmartDiffResponse`, serialized by its Zod schema.

   The response contains:
   - `groups` in the AC6 role order, with no empty groups; within a group, files keep
     `PrDetail.files` (GitHub) order;
   - per file, `finding_lines` = the sorted, de-duplicated union of `start_line..end_line`
     over all **open** findings (`dismissed_at == null`) of all reviews of the PR;
   - `pseudocode_summary: null` on every file;
   - `split_suggestion = { too_big: total_lines > SPLIT_THRESHOLD_LINES, total_lines,
     proposed_splits: [] }`, where `total_lines = Σ(additions + deletions)` over all PR
     files and `SPLIT_THRESHOLD_LINES = 400`.

3. **AC8 — Contract.** `SmartDiffRole` is
   `z.enum(['core','tests','wiring','docs','boilerplate'])` in
   `server/src/vendor/shared/contracts/brief.ts`, mirrored byte-identically to the client.

## Contracts touched

`SmartDiffRole`, `SmartDiff`, `SmartDiffGroup`, `SmartDiffFile`, `ProposedSplit`
(`server/src/vendor/shared/contracts/brief.ts`); `SmartDiffResponse`
(`server/src/vendor/shared/contracts/review-api.ts`, reused unchanged). No table, column or
migration — the route reads existing tables only.

## Components touched

New module `server/src/modules/smart-diff/` (`constants.ts`, `helpers.ts`, `service.ts`,
`routes.ts`), registered in `modules/index.ts`. `constants.ts`/`helpers.ts` are ring-1 pure
(no DB, no container). `service.ts` declares a structural `SmartDiffSource` port and
resolves `container.reviewRepo` in its constructor. `routes.ts` is `getContext` → one
service call → DTO, ring 3.

## Out of scope

`pseudocode_summary` (always `null` in P1); `split_suggestion` UI banner and
`proposed_splits` computation (the flag/total are returned, the banner is not); LLM-assisted
classification; persisting `SmartDiff` into `pr_brief`; per-repo classifier configuration;
findings whose `file` is not among the PR's files (renames, stale paths — they stay visible
only in the reviews/runs surfaces).

## Open questions

None — resolved in `docs/plans/smart-diff.plan.md` (Q1–Q3, rev 2).
