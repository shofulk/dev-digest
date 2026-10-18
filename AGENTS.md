# DevDigest

Local-first AI review of pull requests. Five **standalone** packages — no monorepo
workspace: each has its own `package.json` and lockfile, cross-package code is
shared through tsconfig path aliases, not published modules (`mcp-server` is the one
exception — it imports nothing from `server/`, by design; see its own `AGENTS.md`).

## Stack

Node >= 22 | pnpm >= 10 | TypeScript 5 | Fastify 5 | Drizzle ORM + Postgres (pgvector)
| Next.js 15 App Router + React 19 | TanStack Query | Zod 3 | Vitest | agent-browser
(e2e) | Docker (Postgres only).

## Commands

| Task | Command |
|------|---------|
| Everything, from zero | `./scripts/dev.sh` (flags: `--no-seed` `--no-client` `--db-only`) |
| Postgres | `docker compose up -d` |
| API `:3001` | `pnpm --dir server dev` |
| Web `:3000` | `pnpm --dir client dev` |
| Migrate / seed | `pnpm --dir server db:migrate` · `pnpm --dir server db:seed` |
| Tests | `pnpm --dir <pkg> test` |
| Typecheck | `pnpm --dir <pkg> typecheck` |
| Lint | `pnpm --dir <pkg> lint` |

Migrations do **not** run on boot. `relation … does not exist` means you skipped
`db:migrate`.

## Where things live

| Path | What |
|------|------|
| `server/` | Fastify API, Drizzle, feature plugins in `src/modules/<name>/` |
| `server/src/modules/repo-intel/` | repo indexer (symbols + import graph) → review context |
| `server/src/platform/` | config, DI container, SSE, prompts, resilience |
| `server/src/adapters/` | ports to the outside world (llm, github, git, astgrep, secrets, …) |
| `server/src/vendor/shared` | `@devdigest/shared` — Zod contracts for every package |
| `client/` | Next.js studio; routes `src/app/**`, data hooks `src/lib/hooks/*` |
| `reviewer-core/` | pure engine: diff → prompt → LLM → grounded findings |
| `e2e/` | deterministic browser flows (`specs/NN-name.flow.json`) |
| `mcp-server/` | local stdio MCP server — a thin HTTP-API client exposing reviewer agents, PR review runs, findings and conventions to MCP clients (Claude Code) |
| `docs/agent-prompts/` | built-in reviewer system prompts |
| `docs/retros/` | committed run retros (`<feature>.md`) and `ledger.md`, one row per `/sdd-engineering:run-plan` run |
| `.sdd/config.json` | the project contract the `sdd-engineering` plugin reads (context files, packages and their checks, routing, project agents); the rest of `.sdd/` is local |
| `specs/` | cross-module feature specs; its `README.md` is the spec format of record (template, EARS) |

## Read when

- **Touching any package** → read `<pkg>/AGENTS.md` first
  (`server` · `client` · `reviewer-core` · `e2e` · `mcp-server`).
- **Need architecture, diagrams or data flow** → read `<pkg>/README.md`.
  It is the source of truth; never restate it here.
- **Implementing a feature** → read `<pkg>/.spec/<feature>.spec.md` (one package) or
  `specs/<feature>.spec.md` (two or more packages) first. If no spec exists, ask whether
  to write one with the `sdd-engineering:spec-creator` agent before the code.
- **Placing or moving a file under `server/src`** → read **Backend rings** below.
- **Debugging anything non-trivial** → read `<pkg>/INSIGHTS.md` first (see
  **Session protocol** below).
- **Asking "why is it built this way"** → read `<pkg>/.doc/<topic>.md`.
- **Changing tests or CI** → read `TESTING.md`.

## Session protocol

The `engineering-insights` skill owns both ends of this; invoke it rather than improvising.

- **Before working in a package** → read its `INSIGHTS.md` in full, plus the matching skill
  (in `.claude/skills/` or from a plugin, see **Plugins**), and name the three entries most
  relevant to the task. An unread `INSIGHTS.md` makes the whole loop worthless. One
  exception: an agent executing a lane of a Development Plan reads only the entries the
  plan's *Constraints* cite, plus an `rg` for its steps' key terms — the planner already did
  the full read for the whole plan.
- **When a task ends, or a non-obvious cause is solved** → run `engineering-insights` and
  append what is worth keeping to the `INSIGHTS.md` of the package the work touched
  (repo-wide or cross-package findings go in the root `INSIGHTS.md`). Do not skip this.
- **Only substantial findings.** Re-read the file first; if the finding is already there,
  or would be obvious to anyone reading the code, write nothing.
- `INSIGHTS.md` is **append-only** — never rewrite or delete an entry; retire a wrong one
  with a newer dated entry marked `**Supersedes:**`.
- **Before opening a pull request** → run `/pr-self-review`. It reviews the local change set
  against the skills that govern the touched files and blocks `gh pr create|merge` while a
  verified critical finding stands.

## Plugins

`.claude/settings.json` declares the stable channel of the
[`shofulk/sdd-marketplace`](https://github.com/shofulk/sdd-marketplace) marketplace
(`sdd-stable`) and enables `sdd-engineering` with its dependencies `engineering-paved-path`,
`research-tools` and `architecture-review`. They supply the spec-driven flow and the stack
skills:

| Plugin | Agents | Skills |
|---|---|---|
| `sdd-engineering` | `spec-creator`, `implementation-planner`, `implementer`, `plan-verifier` | `run-plan`, `workflow-retro`, `spec-writing`, `mermaid-diagram` |
| `engineering-paved-path` | — | `onion-architecture`, `frontend-ui-architecture`, `react-best-practices`, `react-testing-library`, `nextjs-app-router`, `fastify-best-practices`, `security` |
| `research-tools` | `researcher` | — |
| `architecture-review` | `architecture-reviewer` | — |

- Name them with the plugin prefix: `sdd-engineering:spec-creator`,
  `/sdd-engineering:run-plan <plan>`, `engineering-paved-path:security`.
- The flow — spec → plan → `/sdd-engineering:run-plan` → `/sdd-engineering:workflow-retro` —
  is described in the plugin's README. The plugin reads this repository through
  `.sdd/config.json`; the project agents it calls when present are `test-writer`,
  `security-reviewer`, `retro-writer` and `doc-writer`.
- `claude plugin list --json` shows the four plugins and their versions; each session appends
  the active versions to `.sdd/trace.jsonl`. If the list does not show them, install them
  once: `claude plugin marketplace add shofulk/sdd-marketplace#stable`, then
  `claude plugin install sdd-engineering@sdd-stable --scope project` (the three dependencies
  come with it; `.claude/settings.json` stays as committed).
- A plugin is changed in its marketplace repository, never by copying it back here.

## Conventions

- Packages are independent. Install inside the package (`pnpm --dir <pkg> …`);
  never hoist dependencies to the repo root.
- Zod contracts are edited in `server/src/vendor/shared` only. `client/src/vendor/*`
  and every other `vendor/` copy are mirrors.
- A new server feature is a self-contained `src/modules/<name>/` Fastify plugin —
  routes + service, registered through `modules/index.ts`.
- Everything external reaches the code through an adapter resolved from the DI
  container (`server/src/platform/container.ts`). No direct SDK calls in services.
- The DB schema already contains **every** table, including ones later course
  lessons fill. Fill an empty table; do not add one.
- Server tests split by filename: `*.it.test.ts` are DB-backed (testcontainers),
  everything else must be hermetic.

## Backend rings

`engineering-paved-path:onion-architecture` holds the rules — dependencies point inward,
the four placement questions, the per-tool rules. This is DevDigest's classification of
`server/` and `reviewer-core/` by real path; `pnpm --dir server arch` enforces it.

| Ring | Paths | May import |
|---|---|---|
| **0 — Domain / contracts** | `server/src/vendor/shared/**`, `reviewer-core/src/**`, and the pure half of `platform/` (`errors.ts`, `model-router.ts`, `resilience.ts`, `grounding.ts`, `prompt.ts`, `structured.ts`, `price-book.ts`, `trace-builder.ts`) | `zod`, other ring-0 files. Nothing else. |
| **1 — Application / services** | `modules/*/service.ts`, `modules/*/run-executor.ts`, `modules/*/helpers.ts`, `modules/*/findings.ts`, `modules/*/diff-loader.ts`, `modules/repo-intel/pipeline/**` | ring 0, port **types** (`@devdigest/shared`), repository **types**, `platform/errors.ts` |
| **2 — Infrastructure** | `src/adapters/**`, `modules/*/repository.ts` + `modules/*/repository/**`, `src/db/**`, and the infra half of `platform/` (`jobs.ts`, `sse.ts`, `run-logger.ts`, `prompts.ts`) | ring 0, its own SDK, `src/db/**` |
| **3 — Composition root / edge** | `src/server.ts`, `src/app.ts`, `modules/index.ts`, `modules/*/routes.ts`, `platform/container.ts`, `platform/config.ts`, plugins | everything |

`modules/_shared/**` is ring 1 unless it touches Fastify (`context.ts` does) — then it is
ring 3.

- `platform/` is **not** a ring. It is split; the table above is the classification, and a
  new file in `platform/` must be placed into one of the two halves in its header comment.
- A module folder is a vertical slice, not a layer. `modules/reviews/` contains ring 1, 2
  and 3 files side by side; the ring is the **file**, not the folder.

## Do not touch

- `*/src/vendor/**` — mirrored shared code; edit the source in
  `server/src/vendor/shared`.
- `server/src/db/migrations/**` — generated. Change the schema, run `db:generate`.
- `.claude/skills/**` — vendored skills, tracked by `skills-lock.json`.
  A skill absent from `skills-lock.json` is first-party (`engineering-insights`,
  `pr-self-review`) — edit it here, and never add it to the lockfile. The skills and agents
  listed under **Plugins** are not in this repository: change them in the marketplace.
- `*/pnpm-lock.yaml` — generated, one per package (there is no workspace-root
  lockfile). Never hand-edit and never hoist: change dependencies with
  `pnpm --dir <pkg> add|remove` and commit the lockfile that run rewrites.
  `skills-lock.json` is likewise written by the skills tooling, not by hand.
- `CLAUDE.md` (root and every package) — a shell whose only instruction content is the
  `@AGENTS.md` import, above it nothing but the pointer paragraph saying so; kept for
  Claude Code older than 2.1.277. Instructions live in
  `AGENTS.md`, one per package plus the root; never duplicate them into `CLAUDE.md`,
  and never delete the shell.

## Gotchas

- The app boots with **no API keys**; every secret is optional in
  `server/src/platform/config.ts` and can be set at runtime via Settings.
- Secrets live in `~/.devdigest/secrets.json` (mode `0600`), read only through
  `LocalSecretsProvider`. Never in the database, never in git.
- `GITHUB_TOKEN` is canonical; `GITHUB_PAT` is accepted as a fallback.
- The grounding gate is mandatory: a finding that does not cite a real diff line
  is dropped, and the score is recomputed from the survivors — never trusted from
  the model.
