# Development Plan: export-to-ci-mvp

**Spec:** `specs/export-to-ci-mvp.spec.md` · **Packages:** ci (new), server, client, repo-wide harness (`.claude/hooks`, `.claude/scripts`, root docs, `.github/workflows`) · **Base:** 1991295 · **Revision:** 2 · **Execution mode:** multi-agent

## Goal
Export one agent from the studio into a workspace repository's GitHub Actions, as a bundle of manifest, skills, memory, a one-file runner from the new `ci/` package, and a shared workflow. Delivery is a `devdigest/ci` pull request or a zip. Finished CI results are pulled back on demand into `agent_runs` (`source='ci'`, `pr_id` NULL) plus `ci_runs`, and shown on the agent's CI tab and a simple CI Runs page. This uses the fewest files and ports that satisfy the 48 ACs.

## Acceptance criteria
1. **AC-1** — [server] WHEN the client asks for an export preview for an agent and a workspace repository, the server shall return exactly the bundle files, with the runner as its size only. *Verify: it*
2. **AC-2** — [server] The manifest shall contain the agent id, name, agent version, provider, model, system prompt, strategy, the ordered active skill slugs, `post_as` and `ci_fail_on`, and it shall pass the `AgentManifest` contract. *Verify: unit*
3. **AC-3** — [server] The memory file shall hold one JSON line with only `kind` and `content` for each `memory` row of the workspace with `scope` `repo` and the chosen repository, and it shall be empty when there is no such row. *Verify: it*
4. **AC-4** — [server] The workflow shall run on `pull_request` with the chosen trigger types, written in the order opened, synchronize, reopened. *Verify: unit*
5. **AC-5** — [server] The workflow shall declare only `contents: read` and `pull-requests: write`, one concurrency group per pull request with `cancel-in-progress: true` and `timeout-minutes: 15`, run `node .devdigest/runner/index.js` on Node 22 with `OPENROUTER_API_KEY` from repository secrets and `GITHUB_TOKEN` from Actions, upload `devdigest-result.json` as artifact `devdigest-result` also when the review step fails, and hold `uses: devdigest/review-action@v1` only in a comment. *Verify: unit*
6. **AC-6** — [server] IF the pull request comes from a fork, THEN the workflow shall skip the review job. *Verify: unit*
7. **AC-7** — [server] WHEN the client sends an export with action `open_pr`, the server shall commit every bundle file to branch `devdigest/ci` of the target repository, and shall never write to the default branch. *Verify: it*
8. **AC-8** — [server] IF an open pull request from `devdigest/ci` already exists, THEN the server shall add a new commit to that branch and return that pull request's URL without opening a second one. *Verify: it*
9. **AC-9** — [server] IF no open pull request from `devdigest/ci` exists, THEN the server shall point `devdigest/ci` at the current head of the default branch before it commits, and open a pull request titled "Add DevDigest CI review" whose body lists every committed path and the secret `OPENROUTER_API_KEY` to add. *Verify: it*
10. **AC-10** — [server] WHEN the export request carries edited workflow text, the server shall commit that text in place of the generated workflow. *Verify: it*
11. **AC-11** — [server] IF the workflow text of the export is not valid YAML, THEN the server shall answer `422` `invalid_workflow` with the line number, and write nothing to GitHub or the database. *Verify: it*
12. **AC-12** — [server] WHEN an export succeeds, the server shall create the installation for the agent and the repository with status `pr_open` (action `open_pr`) or `manual` (action `files`), keep the status of an existing `active` installation, and store the agent version, triggers, `post_as` and pull request URL. *Verify: it*
13. **AC-13** — [server] IF no GitHub token is configured, or GitHub refuses or fails a write, THEN the export shall answer `409` `github_not_configured`, `github_permission` (for `403` or `404`, with the needed permissions: classic token `repo` and `workflow`; fine-grained Contents, Pull requests and Workflows write, and Actions read) or `502` `github_error`, and leave the installation unchanged. *Verify: it*
14. **AC-14** — [server] WHEN the client asks for an agent's CI data, the server shall return each installation with repository, status, installed agent version and pull request URL, and the agent's last 20 CI runs newest first. *Verify: it*
15. **AC-15** — [server] WHEN the client lists CI runs, the server shall return the latest 100 CI runs of the workspace newest first, each with repository, pull request number and URL, agent name, verdict, findings count, cost, duration, GitHub run URL and run time. *Verify: it*
16. **AC-16** — [server] WHEN a refresh runs, the server shall, for each workspace repository with an installation, list the completed runs of `.github/workflows/devdigest-review.yml` from the last 30 days, at most 100. *Verify: it*
17. **AC-17** — [server] IF a run's head repository differs from the installation repository, or a CI run with the same GitHub run id and agent is already stored, THEN the server shall skip it. *Verify: it*
18. **AC-18** — [server] IF a run's `devdigest-result` artifact is missing, larger than 1 MB, or fails the `CiResultArtifact` contract, THEN the server shall skip that run, write nothing for it, and count it as skipped. *Verify: it*
19. **AC-19** — [server] WHEN a valid artifact holds a result for an agent installed on that repository in the workspace, the server shall write one `agent_runs` row (`source` `ci`, `pr_id` NULL, agent, provider, model, status, duration, cost, findings count, blockers) and one linked `ci_runs` row (installation, pull request number, GitHub run URL, run time, verdict, GitHub run id), and drop every result for any other agent. *Verify: it*
20. **AC-20** — [server] WHEN the server stores a CI run for an installation, it shall set that installation's status to `active`. *Verify: it*
21. **AC-21** — [server] IF GitHub fails while the server lists runs for one repository, THEN the refresh shall write nothing for that repository, return `degraded` with the reason, and continue with the other repositories. *Verify: it*
22. **AC-22** — [server] The server shall keep every CI `agent_runs` row out of `GET /pulls/:id/runs` and out of the pull request list's cost. *Verify: it*
23. **AC-23** — [server] The server shall clamp artifact values before it stores them: counts to 0–10,000, cost to 0–100 USD, duration to 0–86,400,000 ms, text to 500 characters. *Verify: unit*
24. **AC-24** — [server] The refresh response shall carry the counts of stored and skipped runs and the list of degraded repositories with reasons. *Verify: it*
25. **AC-25** — [server] WHEN the workflow starts the runner for a pull request, the CI runner shall review the pull request diff once for every manifest under `.devdigest/agents/`. *Verify: unit*
26. **AC-26** — [server] The CI runner shall call the model only through OpenRouter with `OPENROUTER_API_KEY`, mapping provider `openai` to `openai/<model>`, `anthropic` to `anthropic/<model>`, and `openrouter` unchanged. *Verify: unit*
27. **AC-27** — [server] The CI runner shall keep only findings that pass the `reviewer-core` grounding gate, and count blockers from them with the agent's `ci_fail_on`. *Verify: unit*
28. **AC-28** — [server] The CI runner shall post one item per agent, titled with the agent name, by that agent's `post_as`: a GitHub review that requests changes when the agent has blockers and comments otherwise (`github_review`), a pull request comment (`pr_comment`), or nothing (`none`). *Verify: unit*
29. **AC-29** — [server] The CI runner shall exit with a non-zero code when at least one agent has blockers. *Verify: unit*
30. **AC-30** — [server] IF a manifest fails the `AgentManifest` contract, the diff fetch or the model call fails, or `OPENROUTER_API_KEY` is empty, THEN the CI runner shall record verdict `failed` with an error code for that agent, continue with the other agents, and exit with a non-zero code. *Verify: unit*
31. **AC-31** — [server] The CI runner shall write `devdigest-result.json` with the result version, pull request number, head SHA and one result per manifest: agent id, agent version, verdict, findings count per severity, blockers, cost, duration, model and error code. *Verify: unit*
32. **AC-32** — [client] The agent editor shall show a CI tab after Context, opened with `?tab=ci`, with the heading "CI deployment", the badge "Active in N repos" (N = `active` installations, hidden at 0), the buttons "Update CI config" and "Add to CI", one row per installation and a dashed "Add repository" row. *Verify: unit + manual*
33. **AC-33** — [client] The CI tab shall show in each installation row the repository, the chip "GitHub Actions", the installed agent version as `v<number>`, and the latest CI run verdict with relative time, or "PR open" with a link, or "Manual install". *Verify: unit*
34. **AC-34** — [client] WHEN the user clicks "Update CI config", the client shall open the wizard with the repository select limited to repositories where the agent has an installation. *Verify: unit*
35. **AC-35** — [client] The CI tab shall show the "Fail CI on" control (never, critical, warning, any) that saves `ci_fail_on` through `PUT /agents/:id`, and the Config tab shall no longer show the "CI gate" control. *Verify: unit*
36. **AC-36** — [client] The CI tab shall show the agent's last 20 CI runs and an "All runs" link to `/ci-runs`. *Verify: unit*
37. **AC-37** — [client] IF the CI data request fails, THEN the CI tab shall show the error text and a Retry button. *Verify: unit*
38. **AC-38** — [client] WHEN the user clicks "Add to CI" or "Add repository", the client shall open the "Export to CI" wizard at step Target of Target, Preview, Configure, Install, with only the GitHub Actions card (selected) and a repository select of workspace repositories, preselected with the active repository. *Verify: unit*
39. **AC-39** — [client] The Preview step shall list the bundle files and show the text of the selected file, with only the workflow editable and the runner shown by its size. *Verify: unit*
40. **AC-40** — [client] The Configure step shall preselect the triggers opened and synchronize, leave reopened optional, disable Continue while no trigger is selected, offer "Post results as" (GitHub review preselected, PR comment, None (exit code only)), and show the static hint that `OPENROUTER_API_KEY` must be added to the repository's Actions secrets and `GITHUB_TOKEN` is provided by Actions. *Verify: unit*
41. **AC-41** — [client] WHEN the user changes the triggers after editing the workflow, the wizard shall replace only the `types:` list under `pull_request` in the edited text and keep every other edit. *Verify: unit*
42. **AC-42** — [client] WHEN the user clicks Install with "Open a PR with these files" (preselected), the wizard shall send the export with action `open_pr` and, on success, show the pull request link and reload the CI tab. *Verify: unit*
43. **AC-43** — [client] WHEN the user clicks Install with "Copy files as a zip", the client shall download `devdigest-ci-<owner>-<name>.zip` with every bundle file at its path, including workflow edits, and send the export with action `files`. *Verify: unit*
44. **AC-44** — [client] IF the export fails, THEN the wizard shall stay on Install, show the server's error text (for `invalid_workflow` with the line, for `github_permission` with the permission list), and keep every choice and edit. *Verify: unit*
45. **AC-45** — [client] WHEN the CI tab or the `/ci-runs` page opens, or the user clicks Refresh on `/ci-runs`, the client shall request a refresh and then reload the shown data. *Verify: unit*
46. **AC-46** — [client] The sidebar shall show "CI Runs" in the GLOBAL group, linking to `/ci-runs`. *Verify: unit*
47. **AC-47** — [client] The `/ci-runs` page shall show a table with repository, pull request (a link to GitHub), agent, verdict, findings, cost, duration and a "View job" link, and the text "No CI runs yet" when the list is empty. *Verify: unit*
48. **AC-48** — [client] IF a refresh result is degraded, THEN the CI tab and the `/ci-runs` page shall show a notice with the reason and keep showing the stored data. *Verify: unit*

## Recommendations
1. The spec gives no HTTP status for `github_permission` (AC-13). The plan uses `403` (D6). — Reason: the other errors carry one · cost: none · not applied to the spec (the client shows the server's message, so nothing depends on it)
2. The spec does not say what preview/export do when `ci/dist/index.js` was never built. The plan reuses the existing `ConfigError` (`500 config_error`) with the message "CI runner not built: run pnpm --dir ci build" instead of a new error code (D1). — Reason: no new contract value · cost: none · not applied (a dedicated `503` could come in a later version)
3. Reuse `server/src/adapters/git/diff-parser.ts` in the runner through a relative import instead of a second copy. — Reason: one parser keeps grounding line numbers identical, with no extra file and no parity test · cost: a cross-package source import, flagged to architecture review · applied as S14 (D9); accepted after review round 1, reason documented in `ci/AGENTS.md` (S29) *(rev 2)*
4. `.claude/scripts/checks.sh` should run `pnpm --dir ci test`. — Reason: otherwise the main session's checks only typecheck/lint `ci` · cost: one case label · applied as S2
5. Add a `ci/**` bucket (`typescript-expert`, `zod`, `security`) to `.claude/skills/pr-self-review/routing.md`. — Reason: `/pr-self-review` otherwise judges `ci/**` only through the `types` bucket · cost: one row · not applied (plans never edit `.claude/skills/**`)
6. Re-sync the drifted mirror `client/src/vendor/shared/contracts/productionize.ts`. — Reason: same class of drift as eval-ci · cost: one byte copy · not applied (outside this feature)
7. Record the loopback-only rule for preview and export (D12) as a security NFR in the next spec revision. — Reason: it is a user decision from review round 1 that hardens the spec's own "runs on `localhost`" premise and changes no AC, so it is planned as a security constraint · cost: one NFR line · **needs a spec change (spec-creator)** for the record; the plan applies it as S25 *(rev 2)*
8. `client/src/lib/relative-time.ts` duplicates `relativeTime` from `client/src/app/repos/[repoId]/pulls/helpers.ts`. Point the PR list at the shared module when the PR feed is next touched for its own reasons. — Reason: one helper, two copies · cost: one import change in `repos/**` · not applied (the PR feed is out of scope here) *(rev 2)*

## Constraints
- **Path shorthand:**
  - `<CI>` = `server/src/modules/ci`
  - `<AE>` = `client/src/app/agents/[id]/_components/AgentEditor`
  - `<WZ>` = `<AE>/_components/CiTab/ExportWizard`
- **Architecture (server, `onion-architecture`):**
  - The `<CI>` module has five files:
    - `routes.ts` (ring 3: parse, one service call, DTO)
    - `deps.ts` (ring 3: the only file that sees `Container`; precedent `server/src/modules/brief/deps.ts`)
    - `repository.ts` (ring 2: Drizzle, and the `agent_runs` + `ci_runs` transaction)
    - `service.ts` (ring 1: `CiService` with preview, export, agent CI data, runs, refresh)
    - `helpers.ts` (ring 1, pure: manifest, workflow, memory, PR body, `validateWorkflowYaml`, `clampAgentResult`, constants)
  - Ring-1 files import only `@devdigest/shared` types, `platform/errors.ts` and the pure `yaml` library (`helpers.ts`).
  - `CiService` takes a deps object in its constructor and never reaches through `this.container`. GitHub is a captured resolver `github: () => container.github()`.
  - `routes.ts` never imports `repository.ts` (`routes-dont-touch-persistence`).
  - Every new server file states its ring in a header comment.
  - `pnpm --dir server arch` stays at 0 errors / 17 warnings.
  - `octokit` and `fflate` (artifact unzip) live only in `server/src/adapters/github/octokit.ts`.
  - `node:fs` (runner file) lives only in the new adapter `server/src/adapters/ci-runner/index.ts`.
  - Accepted after review round 1: the HTTP status of `github_permission`/`github_error` is chosen in `service.ts` through `AppError` (sibling pattern) *(rev 2)*.
  - The loopback check (D12) is HTTP knowledge, so it lives in `routes.ts` (ring 3) and nowhere below *(rev 2)*.
- **Architecture (ci):**
  - `ci/` is a standalone package that imports `@devdigest/shared` and `@devdigest/reviewer-core` through path aliases. It uses reviewer-core's public surface only (`reviewPullRequest`, `toReviewPayload`, `countBlockers`, `OpenRouterProvider`) and does not change reviewer-core.
  - It has two source files. `ci/src/index.ts` is the only one that touches `process`, `node:fs` or `fetch`. `ci/src/run.ts` holds all logic with injected deps.
  - Accepted after review round 1: `ci/src/run.ts` imports `server/src/adapters/git/diff-parser.ts` by relative path (Recommendation 3). The reason is written in `ci/AGENTS.md` *(rev 2)*.
- **Architecture (client, `frontend-ui-architecture`):**
  - Components read data only through `client/src/lib/hooks/ci.ts`.
  - Query keys come only from `ciKeys`, never as literal arrays *(rev 2)*.
  - Pure wizard logic sits in `<WZ>/helpers.ts`, with no `use` prefix.
  - The run table is shared by the CI tab and `/ci-runs`, so it lives once at `client/src/components/ci/CiRunsTable.tsx`.
  - Every new user-facing string comes from `client/messages/en/*.json` (NFR-7), aria labels included *(rev 2)*. Server error messages are shown as data (AC-44).
  - ~~Runtime contract values are imported from `@devdigest/shared/contracts/eval-ci`, never from the barrel.~~ *(dropped rev 2: webpack cannot resolve the `.js`-suffixed sibling imports inside `eval-ci.ts`)*
  - The client imports contract **types only** from `@devdigest/shared`. Runtime option lists are local constants typed `as const satisfies readonly CiTrigger[]` / `readonly CiPostAs[]` / `readonly CiFailOn[]` (`<WZ>/constants.ts`, `<AE>/_components/CiTab/constants.ts`), so a contract change still fails `typecheck` *(rev 2)*.
  - `client/src/app/repos/**` (PR feed) is untouched. Shared helpers it owns are copied, not moved (D10) *(rev 2)*.
  - Accepted after review round 1: the `client/src/vendor/ui/nav.ts` GLOBAL/CI Runs entry is the deliberate exception (client INSIGHTS 2026-10-03) *(rev 2)*.
- **Contracts & data:**
  - Fill `ci_installations` and `ci_runs`, and add no table.
  - The schema changes only in `server/src/db/schema/ci.ts`, followed by `pnpm --dir server db:generate`. The change only ADDs columns, so drizzle-kit asks no rename prompt.
  - Contracts are edited in `server/src/vendor/shared/{contracts/eval-ci.ts,adapters.ts}` and copied byte-identical to `client/src/vendor/shared/` in the same step.
  - New routes:
    - `GET /agents/:id/ci`
    - `POST /agents/:id/ci/preview`
    - `POST /agents/:id/export-ci`
    - `POST /ci/refresh`
    - `GET /ci/runs`
  - `PUT /agents/:id` is unchanged.
- **Security (rev 2):**
  - `POST /agents/:id/ci/preview` and `POST /agents/:id/export-ci` answer only loopback callers (D12). The edited workflow stays.
  - The other new routes are unchanged.
  - Accepted after review round 1: a same-repository PR author can change the workflow and use its secrets (spec A-7).
- **Do not touch:**
  - `server/src/modules/pulls/**`, `server/src/modules/reviews/**`, `client/src/app/repos/**` (multi-run service and PR feed; AC-22 is a test only).
  - `reviewer-core/**`, `mcp-server/**`, `e2e/**`, `scripts/dev.sh`, `scripts/e2e.sh`.
  - `*/src/vendor/**`, except the byte copies in S5/S8 and the `nav.ts` exception in S20.
  - Migrations by hand, and lockfiles by hand: they change only through `pnpm --dir <pkg> add|install` in S3/S9/S22.
  - `.claude/skills/**`, `.claude/agents/**`, every existing `CLAUDE.md`, `specs/**`, `*/.spec/**`.
  - `server/src/adapters/mocks.ts` gets no runtime third-party import.
- **NFRs (binding):**
  - NFR-1: 30 days, at most 100 runs per repository, artifacts of at most 1,048,576 bytes.
  - NFR-2: `ci/dist/index.js` is at most 5,242,880 bytes and needs no install (manual).
  - NFR-3: `timeout-minutes: 15`. The runner stops a model call at 120 s and records `failed`.
  - NFR-4: 0 model calls in preview, export and refresh.
  - NFR-5: 0 tokens or keys in logs, responses, the artifact or the DB.
  - NFR-6: every new route answers 404 outside the workspace.
  - NFR-7: every new string comes from messages.
- **Planner questions:**
  - Q-1 → D1: build step, not committed.
  - Q-2 → D2: the zip is built in the client.
  - Q-3 → D3: columns and unique key.
  - Q-4 → D4: unzip with `fflate` in the adapter.
- **Test conventions:**
  - Each lane writes its acceptance tests **first**, inside the step that implements them.
  - ~~Every `it()` title starts with the AC/NFR id it proves.~~ *(dropped rev 2: behaviour fixed by a plan Decision has no AC id)*
  - Every `it()` title starts with the AC/NFR id it proves. A test of behaviour no AC covers starts with the plan Decision id (`D1:`, `D9:`, `D12:`). The existing `D1: a missing runner file …` stays, justified by D1 and Recommendation 2 *(rev 2)*.
  - Server error assertions read `res.json().error.code` and `res.json().error.details`.
  - Server tests always inject `secrets: new MockSecretsProvider(…)`, `github: new MockGitHubClient(…)` where GitHub is used, and `runnerBundle: new MockRunnerBundleSource(…)`.
  - Client tests use `fireEvent`.
- **INSIGHTS (server):**
  - `### 2026-09-20 — a long job can stream progress with no \`jobs\` row and no table: \`RunBus\` is keyed by an arbitrary string and replays its buffer`. It warns that `agent_runs` feeds the PR cost rollup, the run history and `/runs/:id/trace`. CI rows must always have `pr_id` NULL and no `run_traces` row. AC-22 is proved by T7 against `GET /pulls/:id/runs` and the PR-list `cost_usd`, never assumed.
  - `### 2026-10-04 — \`server/src/adapters/mocks.ts\` and \`db:seed\` both broke a CI job that installs fewer deps than \`server/\`'s own`. S8's `MockGitHubClient` additions and `MockRunnerBundleSource` use only type-only and relative imports. `fflate` stays in `octokit.ts`.
  - `### 2026-09-20 — picking an LLM provider "by whichever key is configured" makes the test suite spend real money`. `dotenv` puts the developer's real `GITHUB_TOKEN` into `process.env` and `LocalSecretsProvider` falls back to it, so every CI test injects `MockSecretsProvider`. The "no token" case (AC-13) uses `MockSecretsProvider({})` with no github override.
- **INSIGHTS (client):**
  - `### 2026-10-03 — a nav entry added straight to \`vendor/ui/nav.ts\` is a deliberate exception, not drift to clean up`. S20 adds only the GLOBAL group with CI Runs to `nav.ts` and nothing else in `vendor/ui`.
  - `### 2026-09-17 — importing a *value* from \`@devdigest/shared\` compiles and tests green, then \`next dev\` serves 500 on every route`. The client imports contract types only and keeps runtime lists as `satisfies`-typed local constants (rev 2 Constraint). Before reporting the client lane done, load `/agents/<id>?tab=ci` and `/ci-runs` once in dev *(rev 2)*.
  - `### 2026-10-04 — \`@testing-library/user-event\` is not installed; component tests use \`fireEvent\``. All client tests use `fireEvent` and add no package for testing.
- **INSIGHTS (root — harness and the new `ci` package, which has no entries yet):**
  - `### 2026-09-27 — \`scope-guard.sh\`'s bash-checks profile does not know \`mcp-server/\`, so its \`pnpm --dir mcp-server …\` verify commands are manual acceptance, not guarded`. S1 adds `ci` to the checks profile, so reviewers can run `pnpm --dir ci typecheck|lint|test`.
  - `### 2026-09-25 — four review rounds of a permission hook came back \`Clean\` / \`0 not met\` while every round had a real bypass`. Widening `ALLOWED_DIRS`/`TESTS_ALLOW` is a permission-boundary change. Each allowed row gets a matched blocked row through the full JSON dispatch (T2, T18), and the hook goes to security review *(rev 2)*.
  - `### 2026-10-03 — spec-lint rejects an \`[e2e]\` criterion in \`specs/\` as untagged and not EARS`. S2 widens the tag regex to `[a-z0-9-]` and adds `ci`. `node .claude/hooks/spec-lint.mjs check specs/export-to-ci-mvp.spec.md` must still pass.
  - Also binding: `### 2026-09-20 — \`pnpm add\` dies with ERR_PNPM_UNEXPECTED_STORE: the PATH pnpm is older than the one that built \`node_modules\``. This worktree has no `node_modules`, so the first step per package installs with the pnpm version recorded in `.modules.yaml` (reviewer-core: `npm ci`).

## Decisions
- **D1 (Q-1) Runner source: built, not committed.**
  - `ci/build.mjs` (esbuild) writes exactly one file, `ci/dist/index.js`: ESM, `platform: node`, `target: node22`, a `createRequire` banner, no splitting. It fails above 5,242,880 bytes or when `dist/` holds any other file. `ci/dist/` is gitignored.
  - Third-party packages (`zod`, `openai`, `yaml`) resolve only from `ci/node_modules`, through tsconfig `paths`, a vitest `alias` and an esbuild resolve plugin.
  - The server reads the file on each preview and export through the port `RunnerBundleSource`. Its real adapter, `FsRunnerBundleSource`, is constructed in `container.ts` with the path `fileURLToPath(new URL('../../../ci/dist/index.js', import.meta.url))`. There is no config variable.
  - Missing file → `ConfigError` (500 `config_error`) whose message says to run `pnpm --dir ci build` (Recommendation 2). The build is documented in `ci/README.md` and `server/README.md`; `scripts/*` stay unchanged (spec Non-goal).
- **D2 (Q-2) Zip: built in the client.**
  - Preview returns the runner as `{ contents: null, size_bytes }`.
  - The `action: files` export returns every file with its full `contents`, including the runner and the edited workflow.
  - The client zips that response with `fflate.zipSync` and downloads it.
  - The `open_pr` response also returns the runner as `contents: null`.
- **D3 (Q-3) Columns.** Every new column is an ADD, and both tables are empty.
  - `ci_installations`:
    - `status` text, enum `pr_open|manual|active`, NOT NULL, default `'manual'`
    - `installed_agent_version` integer, NOT NULL, default 1
    - `pr_url` text, NULL
    - `triggers` jsonb `string[]`, NOT NULL, default `'["opened","synchronize"]'`
    - `post_as` text, enum `github_review|pr_comment|none`, NOT NULL, default `'github_review'`
    - unique index `ci_installations_agent_repo_uq (agent_id, repo)`
  - `ci_runs`:
    - `agent_run_id` uuid, NOT NULL, references `agent_runs.id` ON DELETE CASCADE (the link column)
    - `github_run_id` bigint (`mode: 'number'`), NOT NULL
    - `verdict` text, enum `blocked|passed|no_findings|failed`, NOT NULL
    - unique index `ci_runs_github_run_installation_uq (github_run_id, ci_installation_id)`
  - That unique key equals "GitHub run id + agent": an installation is one agent in one repository, and a run id belongs to one repository.
  - The legacy `ci_runs.status/source/findings_count/cost_usd` columns stay and are written NULL. `agent_runs` holds those values.
  - Row types `CiInstallationRow` and `CiRunRow` go in `server/src/db/rows.ts`.
- **D4 (Q-4) Artifact.** `downloadRunArtifact(repo, runId, { name, entry, maxBytes })` in `octokit.ts`:
  - It lists the run's artifacts and picks the one named `devdigest-result`. None, or one marked `expired` → `missing`. `size_in_bytes > maxBytes` → `too_large`.
  - Otherwise it downloads the zip. Byte length `> maxBytes` → `too_large`.
  - It unzips with `fflate.unzipSync(bytes, { filter: f => f.name === entry && f.originalSize <= maxBytes })`. No matching entry → `invalid`. Else → `{ status: 'ok', text }`.
  - The pure part is exported as `readResultFromZip(bytes, entry, maxBytes)` for T4. `maxBytes` = 1,048,576.
- **D5 Bundle.**
  - Paths:
    - `.devdigest/agents/<slug(name)>-<agent id first 8>.yaml`
    - `.devdigest/skills/<slug(name)>-<skill id first 8>.md`, one per active skill, in link order (`container.agentSkills.resolveAgentSkillSet`)
    - `.devdigest/memory.jsonl`: one `{"kind","content"}` line per memory row, or `""` when none
    - `.devdigest/runner/index.js`
    - `.github/workflows/devdigest-review.yml`
  - `slug`: lowercase, every non-`[a-z0-9]` run → `-`, max 40 characters, empty → `agent`/`skill`.
  - Files are returned in this order: manifest, skills, memory, runner, workflow. Only the workflow is `editable`.
  - Manifest keys, in order: `agent_id`, `name`, `version`, `provider`, `model`, `strategy`, `post_as`, `ci_fail_on`, `skills`, `system_prompt`. The manifest's `skills` entries are the exact file stems (`<slug(name)>-<skill id first 8>`) *(rev 2)*.
  - Workflow contents:
    - `name: DevDigest review`.
    - `on.pull_request.types`: a flow sequence in canonical order.
    - `permissions`: `contents: read`, `pull-requests: write`.
    - `concurrency`: `group: devdigest-review-${{ github.event.pull_request.number }}`, `cancel-in-progress: true`.
    - Job `review`:
      - `if: github.event.pull_request.head.repo.full_name == github.repository`
      - `runs-on: ubuntu-latest`, `timeout-minutes: 15`
      - Steps:
        1. `actions/checkout@v4`.
        2. `actions/setup-node@v4` with `node-version: 22`.
        3. The comment line `# Future placeholder (not published yet): uses: devdigest/review-action@v1`.
        4. Step `DevDigest review`: `run: node .devdigest/runner/index.js`, env `OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}`, `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`, `PR_NUMBER: ${{ github.event.pull_request.number }}`, `HEAD_SHA: ${{ github.event.pull_request.head.sha }}`.
        5. Upload step: `if: always()`, `actions/upload-artifact@v4`, `name: devdigest-result`, `path: devdigest-result.json`, `if-no-files-found: ignore`.
  - PR body: every committed path, then "Add the repository secret `OPENROUTER_API_KEY`".
- **D6 Export.**
  - Checks run in this order, before any write:
    1. Agent in the workspace, else 404.
    2. `repo` is a workspace repo (`container.reposRepo.findByFullName`), else 404.
    3. If `workflow` is sent, `validateWorkflowYaml`, else 422 `invalid_workflow` with `details.line`.
    4. The runner file can be read (D1).
  - YAML validation uses `parseDocument(text)`, and the line is `errors[0].linePos[0].line`.
  - `files`: upsert the installation, then return.
  - `open_pr`:
    1. `github()` throws `ConfigError` → 409 `github_not_configured`.
    2. `findOpenPr('devdigest/ci')`. If none, `resetBranch(repo, 'devdigest/ci', default_branch)`.
    3. `commitFiles({ branch: 'devdigest/ci', base: default_branch, files })`.
    4. If there was no open PR, `openPullRequest({ title: 'Add DevDigest CI review', … })`.
    5. Upsert the installation.
  - GitHub errors:
    - The adapter maps 403/404 from `findOpenPr`, `resetBranch`, `commitFiles` and `openPullRequest` to `GitHubAccessError`, a new class in `platform/errors.ts`.
    - The service rethrows it as `AppError('github_permission', <message naming the six permissions>, 403, { permissions: [...] })`.
    - Any other GitHub throw → `AppError('github_error', <GitHub message>, 502)`.
    - The installation is untouched on every error.
  - Upsert on `(agent_id, repo)`:
    - New row: `pr_open` (`open_pr`) or `manual` (`files`).
    - Existing row: the status becomes the new one unless it is `active`, which is kept.
    - Always written: `installed_agent_version = agent.version`, triggers, `post_as`, and `pr_url` (`open_pr` only).
  - Disabled agents export normally.
- **D7 Refresh** (`CiService.refresh(workspaceId)`, no throttle).
  - It groups the workspace's installations whose repo is still a workspace repo, by repo.
  - If `github()` throws, every repo goes into `degraded` with `reason: 'github_not_configured'`.
  - For each repo, `listWorkflowRuns(repo, 'devdigest-review.yml', { createdSince: now − 30 d, perPage: 100 })` returns completed runs. If it throws, the refresh writes nothing for that repo, adds `{ repo, reason: 'github_error' }` to `degraded`, and goes on to the next repo.
  - For each run:
    - Head repo ≠ repo → skip, not counted.
    - Every installation of the repo already has a `ci_runs` row for this run id → skip, not counted, no download.
    - `downloadRunArtifact` not `ok`, or `JSON.parse`/`CiResultArtifact.safeParse` fails → `skipped++`.
    - For each result:
      - No installation of this repo matches `agent_id` → drop.
      - Otherwise `clampAgentResult`, then `repository.writeCiRun` writes `agent_runs` and `ci_runs` in one transaction (unique conflict = skip). Then the installation is set `active` and `stored++`.
  - The `agent_runs` row gets:
    - `workspace_id`, `agent_id`, `pr_id` NULL, `source 'ci'`, `provider 'openrouter'`
    - `model`, `status` (`'failed'` when the verdict is `failed`, else `'done'`), `error = error_code`
    - `duration_ms`, `cost_usd`, `findings_count`, `blockers`, `ran_at = run.createdAt`
  - The `ci_runs` row gets:
    - `ci_installation_id`, `agent_run_id`, `github_run_id`, `verdict`, `ran_at`
    - `pr_number`: from the run, else from the artifact
    - `github_url = run.htmlUrl`, but only if it starts with `https://github.com/`, else NULL
  - Clamp limits: every count to 0–10,000 (floored), cost to 0–100, duration to 0–86,400,000, every text field to 500 characters.
  - Response: `{ stored, skipped, degraded }`.
- **D8 Lists.**
  - `GET /agents/:id/ci`: the agent's installations, each with `last_run` (verdict and `ran_at` of its newest `ci_runs` row), plus the agent's last 20 runs.
  - `GET /ci/runs`: the latest 100 runs of the workspace.
  - Both lists join `ci_runs` ⋈ `agent_runs` (filtered by `workspace_id`) ⋈ `ci_installations` ⋈ left join `agents`, ordered by `ran_at desc, id desc`.
  - `pr_url = https://github.com/<repo>/pull/<n>`.
- **D9 Runner (`ci/src/run.ts`).**
  1. Fetch the PR (title, body, head SHA) and the diff once (`Accept: application/vnd.github.v3.diff`). The diff is parsed with `parseUnifiedDiff` imported by relative path from `server/src/adapters/git/diff-parser.ts` (Recommendation 3). If the fetch fails, every agent gets `failed` / `diff_fetch_failed`.
  2. Read manifests from `.devdigest/agents/*.yaml` in sorted order and parse each with `yaml` + `AgentManifest`. A failure gives `failed` / `invalid_manifest`, with `agent_id` taken from the manifest if readable, else from the file name.
  3. An empty key gives every agent `failed` / `missing_api_key`.
  4. Per agent, `reviewPullRequest` gets:
     - `model`: `toOpenRouterModel`, i.e. `openai/…`, `anthropic/…`, or unchanged.
     - an injected `OpenRouterProvider`
     - ~~`skills`: the bodies of the agent's skill files, in manifest order~~ *(dropped rev 2: the prefix fallback `<entry>-*.md` is removed)*
     - `skills`: in manifest order, the body of `.devdigest/skills/<entry>.md` for each manifest entry — exact stem only, no prefix match; a missing file is skipped *(rev 2)*
     - `memory`: `"<kind>: <content>"` per valid `memory.jsonl` line
     - `prDescription`: PR title + body (untrusted)
     - `task`: `Review pull request #<n>`
  5. The review races a 120 s timer: timeout gives `failed` / `model_timeout`, a throw gives `failed` / `model_error`.
  6. Findings come from `outcome.review.findings` (already grounded). Blockers are `countBlockers(findings, ci_fail_on)`. The verdict is `blocked` if blockers > 0, else `passed` if findings > 0, else `no_findings`.
  7. Posting (skipped for `failed`):
     - `github_review`: `toReviewPayload(review, { title: name, failOn, diff })`, with the event forced to `REQUEST_CHANGES` when blockers > 0, else `COMMENT` (never `APPROVE`).
     - `pr_comment`: one issue comment starting with the agent name and listing every finding.
     - `none`: nothing.
     - A failed post is logged and changes neither the verdict nor the exit code.
  8. ~~Exit code: 1 if any result is `blocked` or `failed`, else 0.~~ *(dropped rev 2: no manifests must fail closed)*
  8a. Exit code: 1 if any result is `blocked` or `failed`, **or if no manifest exists**; else 0. With no manifests the runner logs `no manifests under .devdigest/agents` and writes `results: []` *(rev 2)*.
  9. `devdigest-result.json` is always written: `{ version: CI_RESULT_VERSION, pr_number, head_sha, results }`.
  10. ~~Every log line passes a redactor that masks the `OPENROUTER_API_KEY` and `GITHUB_TOKEN` values.~~ *(dropped rev 2: the entry's top-level catch printed unredacted)*
  10a. Every log line passes a redactor that masks the `OPENROUTER_API_KEY` and `GITHUB_TOKEN` values. `run.ts` exports it as `makeRedactor(secrets: (string | undefined)[])`, and `ci/src/index.ts` uses it in its top-level `catch` too *(rev 2)*.
- **D10 Client.**
  - Hooks:
    - `useCiRefresh(invalidate: QueryKey[])` POSTs `/ci/refresh` on mount, then invalidates the given keys. It returns `{ refresh, result }`, and the reload happens even if the refresh fails.
    - ~~Callers: the CI tab passes `['ci','agent',id]`; `/ci-runs` passes `['ci','runs']` and wires `refresh` to its Refresh button.~~ *(dropped rev 2: literal keys)*
    - Callers: the CI tab passes `[ciKeys.agent(id)]`; `/ci-runs` passes `[ciKeys.runs]` and wires `refresh` to its Refresh button *(rev 2)*.
  - Wizard (`ExportWizard`):
    - It owns all state: step, mode (`add` | `update`), repo, triggers, `post_as`, install option, edited workflow (`string | null`), selected file. Back keeps the state; closing discards it.
    - Repository select: workspace repos (`useRepos`), preselected with `useActiveRepo().repoId`.
    - In `update` mode the select lists only installed repos, preselecting the active repo when it is installed, else the first. "Update CI config" is disabled when there is no installation.
    - The preview query key is `(repo_id, triggers, post_as)`.
    - When the triggers change and the workflow was edited, `replaceTriggerTypes(edited, triggers)` runs (`yaml` `parseDocument` + `setIn(['on','pull_request','types'])`). If the text does not parse, it is left unchanged and the server reports the line.
    - The export sends `workflow` only when it was edited.
    - On error, `InstallStep` shows `error.message`, plus `details.line` or the `details.permissions` list.
  - The CI tab's relative time comes from a small copy in `client/src/lib/relative-time.ts`. `client/src/app/repos/**` is not edited (Recommendation 8) *(rev 2)*.
- **D11 Messages** (`client/messages/en/ci.json`, all written in S19). Texts fixed by the spec are copied verbatim, one per line:
  - `ciTab.heading` becomes "CI deployment".
  - New in `ciTab`: `activeIn`, `updateConfig`, `addToCi`, `addRepository`, `ghaChip`, `prOpen`, `manualInstall`, `failOnLabel`, `allRuns`, `retry`, `degraded`.
  - New in `exportWizard`: `secretsHint`, `installZip`, `prOpened`, `close`, `triggers.{opened,synchronize,reopened}`.
  - New in `runs`: `table.{repository,agent,verdict,duration,viewJob}`, `verdict.{blocked,passed,no_findings,failed}`.
  - In `client/messages/en/settings.json`, `integrations.ciNote` becomes "Export an agent to CI from its CI tab; its results appear under CI Runs."
  - Rev 2 changes *(rev 2)*:
    - add `exportWizard.workflowLabel` ("Workflow") for the workflow textarea's `aria-label`
    - remove the unused keys `exportWizard.noInstalledRepo` and `ciTab.loadError`
- **D12 Loopback-only preview and export** *(rev 2)*.
  - `<CI>/routes.ts` adds one `onRequest` hook to the two routes `POST /agents/:id/ci/preview` and `POST /agents/:id/export-ci`, through a local pure predicate `isLoopback(ip)`.
  - Accepted: `127.0.0.0/8`, `::1`, and `::ffff:127.x.x.x`.
  - Any other `req.ip` throws `AppError('loopback_only', 'Export to CI is allowed only from this machine (localhost).', 403)`. The app's error handler sends the standard envelope.
  - Fastify runs without `trustProxy`, so `req.ip` is the socket address and `X-Forwarded-For` is ignored.
  - The other three routes are unchanged.
  - The wizard shows the server text like any other error (AC-44), so no client change is needed.

## Interfaces (fixed by L1/L2)
- **Contracts** (`server/src/vendor/shared/contracts/eval-ci.ts`, mirrored byte-identical, written in S5):
  - Enums:
    - `CiTrigger = z.enum(['opened','synchronize','reopened'])`
    - `CiPostAs = z.enum(['github_review','pr_comment','none'])`
    - `CiVerdict = z.enum(['blocked','passed','no_findings','failed'])`
    - `CiInstallationStatus = z.enum(['pr_open','manual','active'])`
    - `CI_RESULT_VERSION = 1`
  - `AgentManifest` adds `agent_id: z.string().min(1)`, `version: z.number().int().positive()` and `post_as: CiPostAs.default('github_review')`.
  - `CiFile = { path, contents: string | null, editable: boolean, size_bytes: int }`
  - `CiPreviewInput = { repo_id: uuid, triggers: z.array(CiTrigger).min(1), post_as: CiPostAs }`
  - `CiPreview = { files: CiFile[] }`
  - `CiExportInput = { repo: string.min(1), target: z.enum(['gha']).default('gha'), action: z.enum(['open_pr','files']).default('open_pr'), post_as: CiPostAs.default('github_review'), triggers: z.array(CiTrigger).min(1).default(['opened','synchronize']), workflow: z.string().max(65536).nullish() }`. `base` is removed.
  - `CiInstallation = { id, agent_id, repo, target_type: CiTarget, installed_at, status, installed_agent_version: int, pr_url: string | null, triggers: CiTrigger[], post_as: CiPostAs, last_run: { verdict: CiVerdict, ran_at } | null }`
  - `CiExport` keeps its shape.
  - `CiAgentCi = { installations: CiInstallation[], runs: CiRun[] }`
  - `CiRun = { id, repo, pr_number: int | null, pr_url: string | null, agent_id, agent_name, verdict: CiVerdict, findings_count: int, cost_usd: number | null, duration_ms: int | null, github_url: string | null, ran_at }`
  - `CiRunsList = { items: CiRun[] }`
  - `CiRefreshResult = { stored: int, skipped: int, degraded: { repo: string, reason: string }[] }`
  - `CiAgentResult = { agent_id, agent_version: int, verdict: CiVerdict, critical, warning, suggestion, findings_count, blockers: int, cost_usd: number | null, duration_ms: int | null, model: string | null, error_code: string | null }`
  - `CiResultArtifact = { version: int, pr_number: int, head_sha: string, results: CiAgentResult[] }`
  - `CiRunStatus` is removed (no users).
- **Ports** (`server/src/vendor/shared/adapters.ts`, mirrored, S8). `GitHubClient` adds three methods:
  - `resetBranch(repo, branch, toBranch): Promise<{ sha }>`
  - `listWorkflowRuns(repo, workflowFile, { createdSince, perPage }): Promise<WorkflowRunMeta[]>`, where `WorkflowRunMeta = { id: number; htmlUrl: string; headRepoFullName: string | null; prNumber: number | null; createdAt: string }`. Completed runs only.
  - `downloadRunArtifact(repo, runId, { name, entry, maxBytes }): Promise<{ status: 'ok'; text: string } | { status: 'missing' | 'too_large' | 'invalid' }>`

  New port: `RunnerBundleSource { read(): Promise<{ contents: string; sizeBytes: number } | null> }`.
- **Mocks** (S8):
  - `MockGitHubOptions` adds:
    - `openPr?: { url } | null`
    - `workflowRuns?: Record<'owner/name', WorkflowRunMeta[] | 'error'>`
    - `artifacts?: Record<number, ArtifactRead>`
    - `failOn?: Partial<Record<'findOpenPr' | 'resetBranch' | 'commitFiles' | 'openPullRequest', 'permission' | 'error'>>`
  - Recorders: `committed` (now with `repo`), `resets`, `openedPrs`, `listRunsCalls`, `artifactCalls`.
  - New `MockRunnerBundleSource(contents | null)`.
  - `ContainerOverrides.runnerBundle?`, plus a `container.runnerBundle` getter.
- **Service** (`<CI>/service.ts`): `class CiService { constructor(deps: CiServiceDeps); agentCi(ws, agentId); preview(ws, agentId, input); exportCi(ws, agentId, input); listRuns(ws); refresh(ws) }`. `CiServiceDeps` is declared in `service.ts` and built by `deps.ts`. Every route answers 404 for an agent outside the workspace.
- **Routes** *(rev 2)*: preview and export answer `403 loopback_only` for a non-loopback `req.ip` (D12).
- **Runner:**
  - `ci/src/run.ts` exports `runCi(deps: RunnerDeps): Promise<{ exitCode: 0 | 1; artifact: CiResultArtifact }>` and `toOpenRouterModel(provider, model)`.
  - `run.ts` also exports `makeRedactor(secrets): (text: string) => string` *(rev 2)*.
  - `RunnerDeps = { env: { OPENROUTER_API_KEY?, GITHUB_TOKEN?, PR_NUMBER?, HEAD_SHA? }; devdigestDir; resultPath; fs: { listDir(p): string[]; readText(p): string | null; writeText(p, t): void }; github: { getPullRequest(n); getDiff(n); postReview(n, payload); postComment(n, body) }; llmFor(key): LLMProvider; log(line): void; now(): number; modelTimeoutMs?: number }`
- **Client:**
  - `client/src/lib/hooks/ci.ts`: `ciKeys` (`agent(id)`, `runs`), `useCiAgent(id)`, `useCiPreview(id, input | null)`, `useExportCi(id)` (whose `onSuccess` invalidates `ciKeys.agent(id)` and `ciKeys.runs`), `useCiRuns()`, `useCiRefresh(invalidate)` *(rev 2)*.
  - `<WZ>/helpers.ts`: `replaceTriggerTypes(text, triggers)`, `zipFileName(repoFullName)` (returns `devdigest-ci-<owner>-<name>.zip`), `buildZip(files: CiFile[]): Uint8Array`.
  - `client/src/lib/relative-time.ts`: `relativeTime(iso)`, a copy of the PR list's helper *(rev 2)*.

## Steps
| ID | Package | Files (create / modify) | Change | Skills (routing bucket) | Covers | Lane | Verify |
|----|---------|-------------------------|--------|-------------------------|--------|------|--------|
| S1 | repo-wide | `.claude/hooks/scope-guard.sh` (modify) | Add `ci` in two places only. `ALLOWED_DIRS` becomes `["server", "client", "reviewer-core", "e2e", "ci"]`, and its block message names `ci`. `TESTS_ALLOW` gains `"ci/**/*.test.ts"` and `"ci/test/**",`, and the `testsPolicy` message names `ci`. Add `ci` and `ci/test` to the self-test fixture `mkdir`. Add the rows T1 and T2, each name starting with `CI-PKG`. Put no `'` inside any `node -e '…'` block. | repo-hygiene; security lens | — | L1 | `.claude/hooks/scope-guard.sh self-test` exits 0 with every `CI-PKG` row `ok`; `bash -n .claude/hooks/scope-guard.sh`; `rg -nF '"e2e", "ci"]);' .claude/hooks/scope-guard.sh` finds it, while the same `rg` on `git show 1991295:.claude/hooks/scope-guard.sh` finds nothing; `rg -nF '"ci/test/**",' .claude/hooks/scope-guard.sh`; `rg -c 'CI-PKG' .claude/hooks/scope-guard.sh` ≥ 12 |
| S2 | repo-wide | `.claude/hooks/spec-lint.mjs`, `.claude/scripts/checks.sh` (modify) | spec-lint: `PACKAGES` gains `"ci"`; the tag regex becomes `^\[([a-z0-9-]+)\]`; add the T3 self-test rows. checks.sh: the case `client\|reviewer-core\|mcp-server)` gains `\|ci`. | repo-hygiene | — | L1 | `rg -nF '"mcp-server", "ci"];' .claude/hooks/spec-lint.mjs`; `rg -nF 'a-z0-9-' .claude/hooks/spec-lint.mjs`; `rg -nF 'mcp-server\|ci)' .claude/scripts/checks.sh`; each of these finds nothing on `git show 1991295:<file>`. Manual: `node .claude/hooks/spec-lint.mjs self-test` → `0 failing case(s)`, and `node .claude/hooks/spec-lint.mjs check specs/export-to-ci-mvp.spec.md` exits 0 |
| S3 | ci | `ci/package.json`, `ci/pnpm-lock.yaml` (via `pnpm --dir ci install`), `ci/tsconfig.json`, `ci/vitest.config.ts`, `ci/eslint.config.js`, `ci/build.mjs`, `ci/.gitignore`, `ci/src/index.ts` (stub: header + `export {}`), `.github/workflows/ci-runner.yml` (create) | Package `@devdigest/ci` (private, `"type": "module"`, `pnpm.onlyBuiltDependencies: ["esbuild"]`). Scripts `typecheck`, `lint`, `test` (`vitest run --passWithNoTests`), `build` (`node build.mjs`). Deps and dev deps as installed and accepted after review round 1: `openai ^4.104.0`, `yaml ^2.9.1`, `zod ^3.25.76`; dev `@eslint/js ^10.0.1`, `@types/node ^22.20.5`, `esbuild ^0.28.2`, `eslint ^10.12.0`, `globals ^17.13.0`, `typescript ^5.9.3`, `typescript-eslint ^8.71.1`, `vitest ^2.1.9` *(rev 2)*. Aliases per D1. `build.mjs` per D1. `.gitignore` holds `node_modules/` and `dist/`. Workflow, modelled on `mcp-server.yml`: paths `ci/**`, `reviewer-core/**`, `server/src/vendor/shared/**`, `server/src/adapters/git/diff-parser.ts`, and itself; `permissions: contents: read`; install, then typecheck, lint, test, build, and a size check ≤ 5242880. | typescript-expert | NFR-2 | L1 | `pnpm --dir ci typecheck`; `pnpm --dir ci lint`; `pnpm --dir ci test`; `ls ci/pnpm-lock.yaml`; `rg -nF 'dist/' ci/.gitignore`; `rg -nF '5242880' ci/build.mjs`; `rg -nF "- 'ci/**'" .github/workflows/ci-runner.yml` |
| S4 | repo-wide | `AGENTS.md`, `TESTING.md` (modify); `ci/AGENTS.md`, `ci/CLAUDE.md`, `ci/README.md`, `ci/INSIGHTS.md` (create) | Root `AGENTS.md`: "Five **standalone** packages" → "Six **standalone** packages", a `ci/` row in "Where things live", and `ci` in the "Read when" package list. `TESTING.md`: a suite-map row for `ci` (`ci-runner.yml`). `ci/AGENTS.md`: commands, conventions (one ESM file; `index.ts` is the only I/O file; secrets come from env and are never logged; reviewer-core public surface only), and do-not-touch `dist/`. `ci/CLAUDE.md`: the exact shell of `server/CLAUDE.md` with the `@devdigest/ci` title. `ci/README.md`: purpose, the D1 build, the env contract, error codes, exit rule, and the manual NFR-2 check. `ci/INSIGHTS.md`: the standard header plus six empty sections with their markers. | docs | NFR-2 | L1 | `rg -nF 'Six **standalone** packages' AGENTS.md`; `rg -nF 'Five **standalone**' AGENTS.md` finds nothing; `rg -nF 'ci-runner.yml' TESTING.md`; `rg -n '^@AGENTS.md$' ci/CLAUDE.md`; `wc -l ci/CLAUDE.md server/CLAUDE.md` gives equal counts; `rg -c 'newest first:' ci/INSIGHTS.md` = 6; `rg -nF 'pnpm --dir ci build' ci/README.md` |
| S5 | server | `server/src/vendor/shared/contracts/eval-ci.ts` (modify); `client/src/vendor/shared/contracts/eval-ci.ts` (byte copy — the requested re-sync) | Interfaces §Contracts. Copy the server file over the client mirror; this also restores the missing `AgentManifest`. | zod (contracts) | AC-2, AC-12, AC-14, AC-15, AC-19, AC-24, AC-31 | L1 | `pnpm --dir server typecheck`; `pnpm --dir client typecheck`; `pnpm --dir ci typecheck`; `cmp server/src/vendor/shared/contracts/eval-ci.ts client/src/vendor/shared/contracts/eval-ci.ts`; `rg -n 'export const AgentManifest' client/src/vendor/shared/contracts/eval-ci.ts` finds it, while `git show 1991295:client/src/vendor/shared/contracts/eval-ci.ts \| rg -n AgentManifest` finds nothing |
| S6 | repo-wide | `INSIGHTS.md` (append only) | Session protocol: `engineering-insights`, only if the finding is substantial. | engineering-insights | — | L1 | Guard-only: `git diff 1991295 -- INSIGHTS.md \| rg -n '^-[^-]'` finds nothing |
| S7 | server | `server/src/db/schema/ci.ts`, `server/src/db/rows.ts` (modify); migration plus meta (generated) | D3; then `pnpm --dir server install` (first time) and `pnpm --dir server db:generate`. | drizzle-orm-patterns, postgresql-table-design | AC-12, AC-17, AC-19 | L2 | `pnpm --dir server typecheck`; `rg -l 'ci_runs_github_run_installation_uq' server/src/db/migrations` names one `.sql` file N; `rg -n 'agent_run_id' N`; `rg -n 'ci_installations_agent_repo_uq' N`; `rg -n 'DROP' N` finds nothing |
| S8 | server | `server/src/vendor/shared/adapters.ts`, `client/src/vendor/shared/adapters.ts` (byte copy), `server/src/platform/errors.ts`, `server/src/adapters/github/octokit.ts`, `server/src/adapters/mocks.ts`, `server/src/platform/container.ts` (modify); `server/src/adapters/ci-runner/index.ts` (create); `server/test/github-ci.test.ts` (create first) | Ports and mocks per Interfaces. `GitHubAccessError`. Octokit implements `resetBranch` (create the ref or force-update it to the base head), `listWorkflowRuns` (`status: 'completed'`, `created: '>=<date>'`, `per_page`), and `downloadRunArtifact` + `readResultFromZip` (D4, `fflate`). One pure `toGitHubError(err)` maps 403/404 → `GitHubAccessError` for the four write-path methods. `FsRunnerBundleSource(path)` returns null on ENOENT. Container: `runnerBundle` getter and override (D1). | onion-architecture, security (adapters); zod | AC-7, AC-9, AC-13, AC-16, AC-18, NFR-1 | L2 | `pnpm --dir server exec vitest run test/github-ci.test.ts` (written first); `pnpm --dir server typecheck`; `pnpm --dir client typecheck`; `cmp server/src/vendor/shared/adapters.ts client/src/vendor/shared/adapters.ts`; `pnpm --dir server arch`; `pnpm --dir reviewer-core test`; `rg -n "^import [^t].*from '[^.]" server/src/adapters/mocks.ts` finds nothing |
| S9 | server | `<CI>/helpers.ts` (create); `server/package.json`, `server/pnpm-lock.yaml` (via `pnpm --dir server add yaml`); `server/test/ci-helpers.test.ts` (create first) | Pure, ring 1: constants, `slug`, manifest YAML (D5), workflow text (D5), memory jsonl, PR body, `validateWorkflowYaml`. | onion-architecture | AC-2, AC-4, AC-5, AC-6, AC-11, NFR-3 | L2 | `pnpm --dir server exec vitest run test/ci-helpers.test.ts` (written first); `pnpm --dir server typecheck` |
| S10 | server | `<CI>/routes.ts`, `<CI>/deps.ts`, `<CI>/service.ts`, `<CI>/repository.ts` (create); `server/src/modules/index.ts` (modify); `server/test/ci-export.it.test.ts` (create first) | Register all five routes with their contract schemas. In this step implement `preview` and `exportCi` (D5, D6) and the installation upsert plus repo-memory reads in `repository.ts`. `agentCi`, `listRuns` and `refresh` throw `AppError('not_implemented', …, 501)` until S11. | onion-architecture; fastify-best-practices; drizzle-orm-patterns | AC-1, AC-3, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, NFR-4, NFR-5, NFR-6 | L2 | `pnpm --dir server exec vitest run test/ci-export.it.test.ts` (written first); `pnpm --dir server arch`; `rg -nF "import ci from './ci/routes.js';" server/src/modules/index.ts`; `pnpm --dir server exec vitest run test/routes-smoke.test.ts` |
| S11 | server | `<CI>/service.ts`, `<CI>/repository.ts`, `<CI>/helpers.ts` (modify); `server/test/ci-ingest.it.test.ts`, `server/test/ci-clamp.test.ts` (create first) | `agentCi` and `listRuns` (D8); `refresh` plus `writeCiRun` (D7); `clampAgentResult`. `pulls`/`reviews` stay untouched. | onion-architecture; drizzle-orm-patterns | AC-14, AC-15, AC-16, AC-17, AC-18, AC-19, AC-20, AC-21, AC-22, AC-23, AC-24, NFR-1, NFR-4, NFR-6 | L3 | `pnpm --dir server exec vitest run test/ci-ingest.it.test.ts`; `pnpm --dir server exec vitest run test/ci-clamp.test.ts`; `pnpm --dir server exec vitest run --exclude '**/*.it.test.ts'`; `pnpm --dir server arch`; `git diff 1991295 --stat -- server/src/modules/pulls server/src/modules/reviews` is empty |
| S12 | server | `server/README.md` (modify) | Add the ci module, its five routes, the D1 runner build ("run `pnpm --dir ci build`") and the pull-only ingest. Each route goes on one line. | docs | AC-16 | L3 | `rg -nF 'POST /agents/:id/export-ci' server/README.md`; `rg -nF 'POST /ci/refresh' server/README.md`; the same on `git show 1991295:server/README.md` finds nothing |
| S13 | server | `server/INSIGHTS.md` (append only) | Session protocol. | engineering-insights | — | L3 | Guard-only: `git diff 1991295 -- server/INSIGHTS.md \| rg -n '^-[^-]'` finds nothing |
| S14 | ci | `ci/src/run.ts` (create); `ci/test/run.test.ts` (create first) | `runCi` steps 1–6 and 8 of D9 (manifests, single diff fetch, review per agent, mapping, slots, the 120 s race, verdict, exit code) and `toOpenRouterModel`. Uses `pnpm --dir reviewer-core`'s deps via `npm ci` there if needed for local tests only; the build does not depend on them. | typescript-expert; zod | AC-25, AC-26, AC-27, AC-29, AC-30, NFR-3 | L4 | `pnpm --dir ci exec vitest run test/run.test.ts -t "AC-25"`; same for `"AC-26"`, `"AC-27"`, `"AC-29"`, `"AC-30"`, `"NFR-3"`; `pnpm --dir ci typecheck` |
| S15 | ci | `ci/src/run.ts`, `ci/test/run.test.ts` (modify) | Posting (D9 step 7), the result file (D9 step 9) and the redactor (D9 step 10). | typescript-expert; security | AC-28, AC-31, NFR-5 | L4 | `pnpm --dir ci exec vitest run test/run.test.ts`; `pnpm --dir ci lint` |
| S16 | ci | `ci/src/index.ts` (modify) | Entry point only: real `fs`, a `fetch` GitHub client (`GITHUB_API_URL`, `GITHUB_REPOSITORY`, `GITHUB_TOKEN`), `new OpenRouterProvider(key)`, `runCi`, `process.exitCode`, and a direct-run guard. | typescript-expert; security | AC-26, NFR-2 | L4 | `pnpm --dir ci typecheck`; `pnpm --dir ci lint`; `pnpm --dir ci test`. Manual: `pnpm --dir ci build`; `wc -c ci/dist/index.js` ≤ 5242880; `node index.js` copied into an empty temp dir on Node 22 exits non-zero and writes `devdigest-result.json` |
| S17 | ci | `ci/README.md` (modify) | Finish the env contract, error codes (`invalid_manifest`, `diff_fetch_failed`, `missing_api_key`, `model_error`, `model_timeout`), the exit rule and verdict rules. | docs | AC-30 | L4 | `rg -nF 'model_timeout' ci/README.md`; `rg -nF 'invalid_manifest' ci/README.md` |
| S18 | ci | `ci/INSIGHTS.md` (append only) | Session protocol. | engineering-insights | — | L4 | Guard-only: `git diff 1991295 -- ci/INSIGHTS.md \| rg -n '^-[^-]'` finds nothing, and `rg -c 'newest first:' ci/INSIGHTS.md` = 6 |
| S19 | client | `client/src/lib/hooks/ci.ts` (create), `client/src/lib/hooks/index.ts`, `client/messages/en/ci.json`, `client/messages/en/settings.json` (modify); `client/src/lib/hooks/ci.test.ts` (create first) | Hooks per Interfaces; `useCiRefresh` per D10; messages per D11; the `ciNote` text. | frontend-ui-architecture, react-best-practices | AC-45, NFR-7 | L5 | `pnpm --dir client exec vitest run src/lib/hooks/ci.test.ts` (written first); `rg -nF '"heading": "CI deployment"' client/messages/en/ci.json`; `rg -nF 'its results appear under CI Runs.' client/messages/en/settings.json`; `rg -nF 'owned by A4' client/messages/en/settings.json` finds nothing; `pnpm --dir client exec vitest run src/test/smoke.test.tsx` |
| S20 | client | `client/src/vendor/ui/nav.ts` (the deliberate exception), `<AE>/constants.ts`, `<AE>/AgentEditor.tsx`, `<AE>/_components/ConfigTab/ConfigTab.tsx`, `<AE>/_components/ConfigTab/constants.ts` (modify); `client/src/components/app-shell/navCiRuns.test.ts`, `<AE>/AgentEditor.ciTab.test.tsx` (create first) | Append the group `{ section: "GLOBAL", items: [{ key: "ci-runs", label: "CI Runs", icon: "Workflow", href: "/ci-runs" }] }`. `TABS` gains `ci` after `context`, and `AgentEditor` renders `<CiTab agent={agent} />`; S20 creates a placeholder `CiTab` that S21 fills. `ConfigTab` drops the "CI gate" field and no longer sends `ci_fail_on`. | frontend-ui-architecture | AC-32, AC-35, AC-46 | L5 | `pnpm --dir client exec vitest run src/components/app-shell/navCiRuns.test.ts`; `pnpm --dir client test -t "AgentEditor"`; `rg -nF 'section: "GLOBAL"' client/src/vendor/ui/nav.ts`; `git grep -n ciFailOn -- client/src/app/agents \| rg ConfigTab` finds nothing |
| S21 | client | `<AE>/_components/CiTab/{CiTab.tsx,index.ts,styles.ts}`, `client/src/components/ci/CiRunsTable.tsx` (create); `<AE>/_components/CiTab/CiTab.test.tsx` (create first) | The CI tab:<br>- `useCiRefresh([['ci','agent',id]])` on mount<br>- degraded notice<br>- error text and Retry<br>- skeleton while pending<br>- heading and "Active in N repos" badge (hidden at 0)<br>- "Update CI config" opens the wizard in `update` mode (disabled with no installation)<br>- "Add to CI" and the dashed "Add repository" row open it in `add` mode<br>- rows: repo, "GitHub Actions" chip, `v<n>`, then the `last_run` verdict and relative time, else "PR open" (link) or "Manual install"<br>- "Fail CI on" select saving through `useUpdateAgent`<br>- last 20 runs in `CiRunsTable`<br>- "All runs" link to `/ci-runs`<br><br>`CiRunsTable`: repository, PR link, agent, verdict, findings, cost (`formatCost`), duration (em dash when null), and "View job". Links show only for URLs starting with `https://github.com/` and use `rel="noopener noreferrer"`. | frontend-ui-architecture, react-best-practices; react-testing-library | AC-32, AC-33, AC-34, AC-35, AC-36, AC-37, AC-45, AC-48, NFR-7 | L5 | `pnpm --dir client test -t "CiTab"` (written first); `pnpm --dir client typecheck`; `pnpm --dir client lint` |
| S22 | client | `<WZ>/{ExportWizard.tsx,helpers.ts,index.ts,styles.ts}` (create); `client/package.json`, `client/pnpm-lock.yaml` (via `pnpm --dir client add yaml fflate`); `<WZ>/helpers.test.ts`, `<WZ>/ExportWizard.test.tsx` (create first) | Wizard per D10:<br>- Target: GitHub Actions card only (selected) and the repo select<br>- Preview: file list, the selected file's text, editable workflow, runner size<br>- Configure: trigger chips, opened and synchronize preselected, Continue disabled at 0, "Post results as" radios, the static secrets hint<br>- Install: "Open a PR with these files" (preselected) or "Copy files as a zip"; `open_pr` shows the PR link and Close, then the CI tab reloads through invalidation; `files` exports, then builds the zip from the response and downloads it<br>- Errors per D10; Back keeps state | frontend-ui-architecture, react-best-practices; react-testing-library | AC-34, AC-38, AC-39, AC-40, AC-41, AC-42, AC-43, AC-44, NFR-7 | L5 | `pnpm --dir client test -t "ExportWizard"` (written first); `pnpm --dir client typecheck`; `pnpm --dir client lint` |
| S23 | client | `client/src/app/ci-runs/page.tsx`, `client/src/app/ci-runs/_components/CiRunsView/{CiRunsView.tsx,index.ts}` (create); `client/README.md` (modify); `client/src/app/ci-runs/_components/CiRunsView/CiRunsView.test.tsx` (create first) | The page in `AppShell`: `useCiRefresh([['ci','runs']])` on mount and on the Refresh button; degraded notice; `CiRunsTable` over `useCiRuns().items`; "No CI runs yet" when empty. README route map: `/ci-runs` and the agent CI tab, each on one line. | frontend-ui-architecture, next-best-practices | AC-45, AC-47, AC-48 | L5 | `pnpm --dir client exec vitest run src/app/ci-runs/_components/CiRunsView/CiRunsView.test.tsx` (written first); `pnpm --dir client test`; `rg -nF '/ci-runs' client/README.md`. Manual: `/ci-runs` and `/agents/<id>?tab=ci` load in dev |
| S24 | client | `client/INSIGHTS.md` (append only) | Session protocol. | engineering-insights | — | L5 | Guard-only: `git diff 1991295 -- client/INSIGHTS.md \| rg -n '^-[^-]'` finds nothing |
| S25 | server | `<CI>/routes.ts`, `server/README.md` (modify); `server/test/ci-export.it.test.ts` (modify — T17 written first) | D12: the `onRequest` loopback guard on preview and export, plus a pure `isLoopback(ip)` in `routes.ts`. `server/README.md` notes, on one line, that preview and export answer only loopback callers (`403 loopback_only`). *(rev 2)* | fastify-best-practices (backend-http); onion-architecture; security | NFR-6 | L6 | `pnpm --dir server exec vitest run test/ci-export.it.test.ts -t "D12"`; `rg -nF 'loopback_only' server/src/modules/ci/routes.ts`; `rg -nF 'loopback_only' server/README.md`; `rg -n 'loopback' server/src/modules/ci/service.ts` finds nothing; `pnpm --dir server arch` |
| S26 | server | `server/test/ci-helpers.test.ts`, `server/test/ci-export.it.test.ts`, `server/test/ci-ingest.it.test.ts` (modify) | Fill the review-round-1 test gaps exactly as listed in the rev 2 additions to T5, T6 and T7. Tests only: if a new assertion fails, the step reports the production defect and fixes it inside `<CI>/**` only. *(rev 2)* | react-testing-library n/a; onion-architecture (test seams) | AC-2, AC-3, AC-9, AC-11, AC-13, AC-15, AC-19, NFR-4, NFR-5 | L6 | `pnpm --dir server exec vitest run test/ci-helpers.test.ts`; `pnpm --dir server exec vitest run test/ci-export.it.test.ts`; `pnpm --dir server exec vitest run test/ci-ingest.it.test.ts`; `pnpm --dir server exec vitest run --exclude '**/*.it.test.ts'` |
| S27 | server | `server/INSIGHTS.md` (append only) | Session protocol: `engineering-insights`, only if substantial (for example, `app.inject` `remoteAddress` as the loopback test seam). *(rev 2)* | engineering-insights | — | L6 | Guard-only: `git diff 1991295 -- server/INSIGHTS.md \| rg -n '^-[^-]'` finds nothing |
| S28 | ci | `ci/src/run.ts`, `ci/src/index.ts`, `ci/test/run.test.ts` (modify) | D9 step 4 rev 2: exact-stem skill lookup, with the `<entry>-*` prefix fallback removed. D9 step 8a: no manifests → log line, `results: []`, exit 1. D9 step 10a: export `makeRedactor`; `index.ts`'s top-level `catch` prints `makeRedactor([OPENROUTER_API_KEY, GITHUB_TOKEN])(message)`. Tests first, per the rev 2 additions to T9. *(rev 2)* | typescript-expert; security | AC-26, AC-29, AC-30, NFR-5 | L7 | `pnpm --dir ci exec vitest run test/run.test.ts`; `pnpm --dir ci typecheck`; `pnpm --dir ci lint`; `rg -nF 'startsWith(`${slug}-`)' ci/src/run.ts` finds nothing; `rg -nF 'makeRedactor' ci/src/index.ts` |
| S29 | ci | `ci/AGENTS.md`, `ci/README.md` (modify) | `ci/AGENTS.md`: one paragraph explaining why `run.ts` imports `server/src/adapters/git/diff-parser.ts` by relative path. It is the same parser the studio's grounding uses, so a second copy could drift; it is pure (type-only import of `@devdigest/shared`); `ci-runner.yml` watches its path. `ci/README.md`: the exit rule now includes "no manifests → 1". *(rev 2)* | docs | AC-25, AC-29 | L7 | `rg -nF 'diff-parser.ts' ci/AGENTS.md`; `rg -nF 'no manifests' ci/README.md` |
| S30 | repo-wide | `.claude/hooks/scope-guard.sh` (modify) | `TESTS_DENY` gains `"ci/node_modules/**"` and `"ci/dist/**"`. Add T18's blocked rows through the full JSON dispatch helper `runrd` (`"$SELF" write tests`, exit 2), each name starting `CI-PKG`. Put no `'` inside any `node -e '…'` block. *(rev 2)* | repo-hygiene; security lens | — | L7 | `.claude/hooks/scope-guard.sh self-test` exits 0; `bash -n .claude/hooks/scope-guard.sh`; `rg -nF '"ci/node_modules/**",' .claude/hooks/scope-guard.sh`; `rg -nF '"ci/dist/**",' .claude/hooks/scope-guard.sh`; `rg -n 'runrd "CI-PKG' .claude/hooks/scope-guard.sh` lists ≥ 3 rows |
| S31 | ci | `ci/INSIGHTS.md` (append only) | Session protocol. *(rev 2)* | engineering-insights | — | L7 | Guard-only: `git diff 1991295 -- ci/INSIGHTS.md \| rg -n '^-[^-]'` finds nothing |
| S32 | repo-wide | `INSIGHTS.md` (append only) | Session protocol for the harness change in S30 (for example, a `**/*.test.ts` allow glob also admits vendored and build trees). *(rev 2)* | engineering-insights | — | L7 | Guard-only: `git diff 1991295 -- INSIGHTS.md \| rg -n '^-[^-]'` finds nothing |
| S33 | client | `<WZ>/ExportWizard.tsx`, `<AE>/_components/CiTab/CiTab.tsx`, `client/src/app/ci-runs/_components/CiRunsView/CiRunsView.tsx`, `client/messages/en/ci.json` (modify); `client/src/lib/relative-time.ts` (create) | The workflow textarea `aria-label={t("workflowLabel")}` (D11 rev 2). `CiTab`'s `useCiRefresh` takes `[ciKeys.agent(agent.id)]` and `CiRunsView`'s takes `[ciKeys.runs]` (D10 rev 2). `relativeTime` is copied into `client/src/lib/relative-time.ts` and `CiTab` imports it from there; `client/src/app/repos/**` is untouched (Recommendation 8). Remove the unused keys `exportWizard.noInstalledRepo` and `ciTab.loadError` after confirming no user. *(rev 2)* | frontend-ui-architecture, react-best-practices | AC-33, AC-45, NFR-7 | L8 | `pnpm --dir client typecheck`; `pnpm --dir client lint`; `git grep -n 'app/repos' -- client/src/app/agents \| rg CiTab` finds nothing; `git grep -n 'aria-label="Workflow"' -- client/src` finds nothing; `rg -nF '"workflowLabel"' client/messages/en/ci.json`; `rg -n 'noInstalledRepo' client/messages/en/ci.json` finds nothing; `git diff 1991295 --stat -- client/src/app/repos` is empty |
| S34 | client | `<AE>/_components/CiTab/CiTab.test.tsx`, `<WZ>/ExportWizard.test.tsx`, `client/src/lib/hooks/ci.test.ts` (modify) | Fill the review-round-1 client test gaps exactly as listed in the rev 2 additions to T10, T13 and T15. Tests only, unless an assertion exposes a defect in the client CI files. *(rev 2)* | react-testing-library | AC-35, AC-38, AC-42, AC-44 | L8 | `pnpm --dir client test -t "CiTab"`; `pnpm --dir client test -t "ExportWizard"`; `pnpm --dir client exec vitest run src/lib/hooks/ci.test.ts`; `pnpm --dir client test` |
| S35 | client | `client/INSIGHTS.md` (append only) | Session protocol. *(rev 2)* | engineering-insights | — | L8 | Guard-only: `git diff 1991295 -- client/INSIGHTS.md \| rg -n '^-[^-]'` finds nothing |

## Execution
| Lane | Agent | Steps | Depends on | Parallel with |
|------|-------|-------|------------|---------------|
| L1 | implementer (harness + `ci/` scaffold + contracts) | S1–S6 | — | — |
| L2 | implementer (server: schema, ports, preview, export) | S7–S10 | L1 | L4, L5 |
| L3 | implementer (server: CI data, runs list, ingest, docs) | S11–S13 | L2 | L4, L5 |
| L4 | implementer (ci runner) | S14–S18 | L1 | L2, L3, L5 |
| L5 | implementer (client) | S19–S24 | L1 | L2, L3, L4 |
| L6 | implementer (rev 2 server: loopback guard + test gaps) | S25–S27 | L3 | L7, L8 |
| L7 | implementer (rev 2 ci runner fixes + scope-guard deny rows) | S28–S32 | L4 | L6, L8 |
| L8 | implementer (rev 2 client fixes + test gaps) | S33–S35 | L5 | L6, L7 |

- **No separate interface or red lane, by user request.** The user asked for a simple first version in about five lanes. Each implementation step writes its acceptance tests **first** (the file marked "written first" in the step's Files) and then the code that turns them green.
- **Interface pieces.** Contracts land in L1 (S5), because every stream depends on them. The server ports and schema land at the top of L2. The client and the runner touch no server file, so they run beside L2.
- **Disjoint file sets for the parallel lanes:**
  - L2/L3: `server/**` plus `client/src/vendor/shared/adapters.ts` (S8 only).
  - L4: `ci/src/**`, `ci/test/**`, `ci/README.md`, `ci/INSIGHTS.md`.
  - L5: `client/**`, except `client/src/vendor/shared/**`.
- **Review after implementation.** The main session dispatches architecture review, security review and plan-verifier once L3, L4 and L5 are done.
- **Rev 2 status and lanes.** L1–L5 are implemented (uncommitted). Rev 2 adds three small fix lanes; all three run in parallel, with disjoint files *(rev 2)*:
  - L6: `server/src/modules/ci/routes.ts`, `server/README.md`, `server/test/ci-{helpers,export,ingest}*`, `server/INSIGHTS.md`.
  - L7: `ci/src/{run,index}.ts`, `ci/test/run.test.ts`, `ci/AGENTS.md`, `ci/README.md`, `ci/INSIGHTS.md`, `.claude/hooks/scope-guard.sh`, root `INSIGHTS.md`.
  - L8: `<WZ>/ExportWizard.tsx`, `<WZ>/ExportWizard.test.tsx`, `<AE>/_components/CiTab/CiTab.{tsx,test.tsx}`, `client/src/app/ci-runs/_components/CiRunsView/CiRunsView.tsx`, `client/src/lib/relative-time.ts`, `client/src/lib/hooks/ci.test.ts`, `client/messages/en/ci.json`, `client/INSIGHTS.md`.
- **Rev 2 tests.** Tests stay with implementer steps (fewest runs) rather than a test-writer lane. The harness change sits in the ci lane because both are small and file-disjoint. A second review round follows L6–L8 *(rev 2)*.

## Test plan
| Test | Kind | Phase | Covers | Lane | File | Asserts (fails without the change) |
|------|------|-------|--------|------|------|-------------------------------------|
| T1 | hook self-test (full JSON dispatch via `runj`) | impl | — | L1 | `.claude/hooks/scope-guard.sh` (self-test) | Allowed (exit 0): `pnpm --dir ci test`, `pnpm --dir ci typecheck`, `pnpm --dir ci lint`, `pnpm --dir ci exec vitest run test/run.test.ts`. The `write tests` rows `ci/test/run.test.ts` and `ci/src/x.test.ts` are allowed. |
| T2 | hook self-test, **blocked**, full JSON dispatch | impl | — | L1 | `.claude/hooks/scope-guard.sh` (self-test) | Exit 2 for each of: `pnpm --dir ci build`; `pnpm --dir ci exec node dist/index.js`; `pnpm --dir ci/../server test`; `pnpm --dir ./ci test`; `pnpm --dir ci test ../server/test/x.test.ts`; `pnpm --dir ci test` with `ci` a symlink to `server/clones/x`. Blocked `write tests` rows: `ci/src/run.ts`, `ci/build.mjs`, `ci/package.json`, `ci/vitest.config.ts`, `ci/dist/index.js`. |
| T3 | hook self-test | impl | — | L1 | `.claude/hooks/spec-lint.mjs` (self-test) | A `[ci]` and an `[e2e]` tag in `specs/` lint clean; `[foo]` still errors. |
| T4 | unit | impl | AC-13, AC-18, NFR-1 | L2 | `server/test/github-ci.test.ts` | `toGitHubError` maps 403/404 → `GitHubAccessError`; other errors pass through. `readResultFromZip`: ok text; entry missing → `invalid`; over the cap → `too_large`; an entry with `originalSize` above the cap is never inflated. |
| T5 | unit | impl | AC-2, AC-4, AC-5, AC-6, AC-11, NFR-3 | L2, L6 | `server/test/ci-helpers.test.ts` | The manifest round-trips through `AgentManifest` with every AC-2 field and the skill order. The parsed workflow has: canonical `types` per subset; exactly two permissions; the per-PR concurrency group with `cancel-in-progress`; `timeout-minutes: 15`; the fork `if:`; the runner command; Node 22; both secret envs; the upload step with `if: always()`. Every line containing `devdigest/review-action@v1` is a `#` comment. `validateWorkflowYaml` gives the expected line for a duplicate key and for an unclosed flow sequence, and ok for valid text. **Rev 2 adds:** the unclosed-flow-sequence fixture asserts its exact line number (`toBe(<n>)`, not a range or truthiness). *(rev 2)* |
| T6 | `*.it.test.ts` via `app.inject()` | impl | AC-1, AC-2, AC-3, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, NFR-4, NFR-5, NFR-6 | L2, L6 | `server/test/ci-export.it.test.ts` | Preview returns exactly the five-kind path list in order, with the runner `contents` null and `size_bytes` set. Memory has one `{kind,content}` line per row, or `""`. Every commit targets `devdigest/ci` with every path; none names the default branch. An open PR is reused (no reset, no new PR, URL returned). Otherwise `resets[0]` points `devdigest/ci` at the default branch, then one PR titled "Add DevDigest CI review" whose body lists the paths and `OPENROUTER_API_KEY`. An edited workflow is committed verbatim. Invalid YAML → 422 with `details.line`, and nothing is recorded or stored. Installation rows: `pr_open` or `manual`; an existing `active` row stays `active`; version, triggers, `post_as` and `pr_url` are stored. No token → 409; `failOn` permission → 403 `github_permission` with six permissions; `failOn` error → 502 `github_error`; the installation is unchanged after each. A foreign agent or repo → 404 on preview, export and `GET /agents/:id/ci`. Mock LLMs record 0 calls. Responses and DB rows hold no secret value. The existing `D1:` case stays (D1 behaviour). **Rev 2 adds:** *(rev 2)*<br>- AC-2: an agent with one disabled link and one disabled skill → the preview manifest's `skills` and the skill files list only the active skill.<br>- AC-3: memory rows of another repo and another workspace are absent from `memory.jsonl`.<br>- AC-9: a `MockGitHubClient` subclass in the test records one ordered call log; `resetBranch` comes before `commitFiles`, which comes before `openPullRequest`.<br>- AC-13: `details.permissions` deep-equals the exact six-entry list of D6.<br>- NFR-4: an export (`open_pr` and `files`), with mock LLMs injected for `openai`/`anthropic`/`openrouter`, leaves every `.calls` empty.<br>- NFR-5: built with `logLevel: 'info'` and `process.stdout.write` spied, the export happy path and failure paths with a `MockSecretsProvider` token `ghp_SECRET_TEST` print no line containing it. |
| T7 | `*.it.test.ts` | impl | AC-14, AC-15, AC-16, AC-17, AC-18, AC-19, AC-20, AC-21, AC-22, AC-24, NFR-1, NFR-4 | L3, L6 | `server/test/ci-ingest.it.test.ts` | `listRunsCalls` covers only repos with installations, using `devdigest-review.yml`, a 30-day window and `perPage` 100. A foreign head repo is skipped. A second refresh adds no rows. `artifactCalls` use `maxBytes` 1048576. Missing, too-large or invalid artifacts are skipped and counted. A valid result writes the full `agent_runs` and `ci_runs` rows; an unknown agent writes nothing. Storing a run makes the installation `active`. Repo A `'error'` → A in `degraded`, nothing written for A, B stored. The response carries `stored`, `skipped` and `degraded`. `GET /agents/:id/ci` returns the installation fields and the last 20 runs, newest first. `GET /ci/runs` returns the latest 100 of the workspace with every field. CI rows are absent from `GET /pulls/:id/runs` and from the PR-list `cost_usd`. 0 model calls. **Rev 2 adds:** *(rev 2)*<br>- AC-15: one `GET /ci/runs` item checked field by field (`repo`, `pr_number`, `pr_url` = `https://github.com/<repo>/pull/<n>`, `agent_name`, `verdict`, `findings_count`, `cost_usd`, `duration_ms`, `github_url`, `ran_at`).<br>- AC-19: `ci_runs.ran_at` and `agent_runs.ran_at` equal the run's `createdAt`. |
| T8 | unit | impl | AC-23 | L3 | `server/test/ci-clamp.test.ts` | Every count, cost, duration and text bound, including negative and over-limit inputs. |
| T9 | unit | impl | AC-25, AC-26, AC-27, AC-28, AC-29, AC-30, AC-31, NFR-3, NFR-5 | L4, L7 | `ci/test/run.test.ts` | The diff is fetched once and there is one review per valid manifest. The model name is mapped per provider. Skill bodies and memory lines reach the prompt, and the PR text appears only inside the untrusted wrapper. Ungrounded findings are dropped, and blockers follow `ci_fail_on`. Posting: one review per agent titled with its name, `REQUEST_CHANGES` vs `COMMENT` (never `APPROVE`); one comment for `pr_comment`; nothing for `none`. Exit 1 on a blocker. A broken manifest, a diff failure, a model throw or an empty key give `failed` plus an error code, the other agents continue, and the exit is 1. A never-resolving model with `modelTimeoutMs` 50 gives `model_timeout`. The result file parses as `CiResultArtifact` with every AC-31 field. No log line or result-file byte contains the key or the token. **Rev 2 adds:** *(rev 2)*<br>- AC-26: `llmFor` is called with exactly the `OPENROUTER_API_KEY` value.<br>- D9: a skills dir with `foo-12345678.md` and `foo-12345678-old.md` gives manifest entry `foo-12345678` only the first body, and entry `foo` gets no body.<br>- D9: an empty `.devdigest/agents` gives exit 1, `results: []`, and the result file is still written.<br>- NFR-5: `makeRedactor([key, token])` masks both values inside a longer message. |
| T10 | client hook (`renderHook`, fetch mocked) | impl | AC-45, AC-42 | L5, L8 | `client/src/lib/hooks/ci.test.ts` | On mount, `POST /ci/refresh` precedes the refetch of the invalidated key; `refresh()` repeats it; a failed refresh still reloads. **Rev 2 adds:** AC-42 — after `useExportCi(id).mutateAsync(...)` resolves, `ciKeys.agent(id)` and `ciKeys.runs` are invalidated (a mounted `useCiAgent(id)` refetches). *(rev 2)* |
| T11 | unit | impl | AC-46 | L5 | `client/src/components/app-shell/navCiRuns.test.ts` | `NAV` has the `GLOBAL` group with `{ key: 'ci-runs', label: 'CI Runs', href: '/ci-runs' }`. |
| T12 | client RTL | impl | AC-32, AC-35 | L5 | `<AE>/AgentEditor.ciTab.test.tsx` | The tab order ends Context, CI; `tab="ci"` renders the CI tab; the Config tab has no "CI gate" and its save omits `ci_fail_on`. |
| T13 | client RTL | impl | AC-32, AC-33, AC-34, AC-35, AC-36, AC-37, AC-45, AC-48, NFR-7 | L5, L8 | `<AE>/_components/CiTab/CiTab.test.tsx` | Each AC, with real `messages/en` and an `onError` that fails the test on a missing key. **Rev 2 adds:** AC-35 — the "Fail CI on" select offers exactly never, critical, warning and any, and choosing each one sends `PUT /agents/:id` with that `ci_fail_on`. *(rev 2)* |
| T14 | unit | impl | AC-41, AC-43 | L5 | `<WZ>/helpers.test.ts` | `replaceTriggerTypes` changes only `types` and keeps a comment, an extra step and a renamed job intact. `buildZip` round-trips every path, including the edited workflow. `zipFileName('acme/payments-api')` gives `devdigest-ci-acme-payments-api.zip`. |
| T15 | client RTL | impl | AC-34, AC-38, AC-39, AC-40, AC-42, AC-43, AC-44 | L5, L8 | `<WZ>/ExportWizard.test.tsx` | Each AC: the export body's `action` and `workflow`; the zip via a `URL.createObjectURL` spy; the error text with the line and the permissions; every choice kept after an error; the `update`-mode repo list. **Rev 2 adds:** *(rev 2)*<br>- AC-38: the four step labels Target, Preview, Configure, Install; the GitHub Actions card rendered as selected (`aria-pressed`/`aria-checked` true), and no other target card.<br>- AC-44: after a failed export, back through every step: the repo, the triggers (`reopened` on), `post_as` (`pr_comment`), the install option and the edited workflow text are all still set; a second Install sends the same body.<br>- NFR-7: the workflow textarea is found by its translated label. |
| T16 | client RTL | impl | AC-45, AC-47, AC-48 | L5 | `client/src/app/ci-runs/_components/CiRunsView/CiRunsView.test.tsx` | Refresh on mount and on the button; table columns and links; "No CI runs yet"; the degraded notice with the stored rows still shown. |
| T17 | `*.it.test.ts` via `app.inject()` | impl | NFR-6 | L6 | `server/test/ci-export.it.test.ts` | `D12:` cases *(rev 2)*:<br>- `inject({ remoteAddress: '10.1.2.3' })` on `POST /agents/:id/ci/preview` and on `POST /agents/:id/export-ci` → 403, `error.code === 'loopback_only'`, and the GitHub recorders and the installation table are untouched.<br>- The same from `10.1.2.3` with header `x-forwarded-for: 127.0.0.1` → still 403.<br>- Default `127.0.0.1` and `remoteAddress: '::1'` → not 403.<br>- `GET /agents/:id/ci` from `10.1.2.3` is not 403 (unchanged route). |
| T18 | hook self-test, **blocked**, full JSON dispatch | impl | — | L7 | `.claude/hooks/scope-guard.sh` (self-test) | Through `runrd … tests Write …`, each expected exit 2 with the "BLOCKED by scope-guard (write tests)" text: `ci/node_modules/zod/x.test.ts`, `ci/dist/x.test.ts`, `ci/node_modules/.pnpm/a/test/b.ts`. `ci/test/run.test.ts` stays allowed. *(rev 2)* |

## Review hand-off
- **Architecture review:**
  - `server/src/modules/ci/**`: the ring of each file; `routes.ts` does not import `repository.ts`; no `this.container`; `yaml` only in `helpers.ts`; `arch` ≤ 17 warnings.
  - `server/src/adapters/github/octokit.ts`: `fflate`, union returns, `toGitHubError`.
  - `server/src/adapters/ci-runner/index.ts`, `server/src/platform/container.ts`, `server/src/adapters/mocks.ts`, `server/src/db/schema/ci.ts` (D3).
  - `ci/src/run.ts`: the relative import of `server/src/adapters/git/diff-parser.ts` (Recommendation 3). `ci/src/index.ts` is the only I/O file.
  - Client: placement of `client/src/components/ci/CiRunsTable.tsx`; the `nav.ts` exception.
  - Rev 2 *(rev 2)*:
    - the loopback hook stays in ring 3 (`routes.ts`)
    - `client/src/lib/relative-time.ts` (a copy, Recommendation 8)
    - `ciKeys` used everywhere
    - the accepted items (nav exception, diff-parser import, status in the service) need no further review
- **Security review:**
  - `.claude/hooks/scope-guard.sh` — a permission boundary. Every unrefuted bypass becomes a blocked full-dispatch row (T2).
  - `server/src/modules/ci/routes.ts`: workspace scoping, NFR-6.
  - `server/src/adapters/github/octokit.ts`: artifact size and zip-bomb caps, error-message leakage.
  - `server/src/modules/ci/service.ts` refresh: untrusted artifact handling — contract check, clamp, agent allowlist per repo, head-repo check, `https://github.com/` URL prefix.
  - The generated workflow in `helpers.ts`: permissions, fork gate, secrets on same-repo PRs (A-7).
  - `ci/src/**`: redaction, untrusted PR text, fail-closed exit.
  - The client download and external links in `<WZ>/ExportWizard.tsx` and `CiRunsTable.tsx`.
  - `.github/workflows/ci-runner.yml` (`permissions: contents: read`).
  - Rev 2 *(rev 2)*:
    - `server/src/modules/ci/routes.ts` D12: IPv4-mapped IPv6, `X-Forwarded-For` spoofing, `trustProxy` off.
    - `ci/src/index.ts` catch redaction.
    - `.claude/hooks/scope-guard.sh` `TESTS_DENY` (T18).
    - Same-repo PR risk (A-7) accepted, not re-opened.

## Risks / open questions
- **Runner not built.** Preview and export answer `500 config_error` until someone runs `pnpm --dir ci build`. `dev.sh` does not build the runner (spec Non-goal). README and the error message say how. Affects S10.
- **ESM runner in a repository with `"type": "commonjs"`.** Node loads `.devdigest/runner/index.js` as CJS and fails. The job fails closed. Affects S3, S16.
- **GitHub 403 from rate limiting.** It reports `github_permission`. Affects S8.
- **Deleted agent.** Its CI runs disappear from both lists, because the lists join installations, which cascade. Affects S11.
- **First-time installs.** This worktree has no `node_modules`; each lane installs its own package with the matching pnpm version (root INSIGHTS).
- **Manual items.** NFR-2 (S16) and the visual half of AC-32.
- **Loopback guard and remote use.** A user who reaches the studio from another device (or through a reverse proxy) can no longer preview or export. That is intended (D12). A proxy setup would need `trustProxy` plus a different check later. Affects S25 *(rev 2)*.
- **Existing exports with prefixed skill files.** Repositories exported before rev 2 already used exact stems, so no installed repo loses skills when the prefix fallback goes. A hand-renamed skill file is no longer found. Affects S28 *(rev 2)*.

## Out of scope
- Every "Non-goal (left for a later version)" of the spec: the secrets API check, auto-refresh and throttle, bulk update and outdated detection, default-branch status, filters and pagination, e2e flow and script wiring, large-table NFRs and axe, client YAML validation, the installed-repo marker, the parallel-export guard.
- Every out-of-scope Non-goal: other CI targets, a published Action, an inbound endpoint, finding import, Project Context, removing an installation, MCP, and changes to `reviewer-core`.
- `server/src/modules/{pulls,reviews}/**` and `client/src/app/repos/**`.
- `.claude/skills/**` (Recommendation 5) and other mirror drift (Recommendation 6).
- Writing or changing any spec.
- Rev 2 *(rev 2)*:
  - authentication of the API in general (D12 covers only preview and export)
  - pointing the PR list at the shared `relativeTime` (Recommendation 8)

## Revisions
- rev 1 · 2026-10-11 · Initial plan from implementation-planner: S1–S24, T1–T16, AC-1–AC-48, lanes L1–L5 · SPEC-04 simple first version, multi-agent with 5 lanes; Q-1…Q-4 resolved as D1–D4; harness steps kept (scope-guard, spec-lint, checks.sh, ci docs and workflow, eval-ci mirror re-sync, `ciNote`, nav exception, schema via `db:generate`)
- rev 2 · 2026-10-11 · Added D12 loopback-only preview/export (S25, T17). Changed D9 (exact-stem skills, no-manifest exit 1, redacted entry catch; S28–S29), D10/D11 (`ciKeys`, `relativeTime` copy, i18n aria label, unused keys dropped; S33), the client runtime-values constraint (`satisfies`-typed local constants) and the test-title convention (`D<n>:` allowed). Added `TESTS_DENY` rows for `ci/node_modules`/`ci/dist` (S30, T18). Filled the review-round-1 test gaps into T5, T6, T7, T9, T10, T13, T15 (S26, S34). Recorded the S3 dependency ranges as accepted. Accepted the nav exception, the diff-parser relative import (documented in `ci/AGENTS.md`), the service-chosen HTTP status and same-repo PR risk A-7. New lanes L6–L8, all parallel. · Reviewer round 1 findings plus user decisions verified at AskUserQuestion (security major: an unauthenticated LAN caller could commit arbitrary workflow YAML with the user's token)

**Plan status:** Ready
