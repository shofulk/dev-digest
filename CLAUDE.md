# DevDigest

Local-first AI review of pull requests. Four **standalone** packages — no monorepo
workspace: each has its own `package.json` and lockfile, cross-package code is
shared through tsconfig path aliases, not published modules.

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
| `docs/agent-prompts/` | built-in reviewer system prompts |

## Read when

- **Touching any package** → read `<pkg>/CLAUDE.md` first
  (`server` · `client` · `reviewer-core` · `e2e`).
- **Need architecture, diagrams or data flow** → read `<pkg>/README.md`.
  It is the source of truth; never restate it here.
- **Implementing a feature** → read `<pkg>/.spec/<feature>.spec.md` first. If no
  spec exists, ask whether to write one before the code.
- **Debugging anything non-trivial** → read `<pkg>/INSIGHTS.md` first (see
  **Session protocol** below).
- **Asking "why is it built this way"** → read `<pkg>/.doc/<topic>.md`.
- **Changing tests or CI** → read `TESTING.md`.

## Session protocol

The `engineering-insights` skill owns both ends of this; invoke it rather than improvising.

- **Before working in a package** → read its `INSIGHTS.md` in full, plus the matching skill
  in `.claude/skills/`, and name the three entries most relevant to the task. An unread
  `INSIGHTS.md` makes the whole loop worthless.
- **When a task ends, or a non-obvious cause is solved** → run `engineering-insights` and
  append what is worth keeping to the `INSIGHTS.md` of the package the work touched
  (repo-wide or cross-package findings go in the root `INSIGHTS.md`). Do not skip this.
- **Only substantial findings.** Re-read the file first; if the finding is already there,
  or would be obvious to anyone reading the code, write nothing.
- `INSIGHTS.md` is **append-only** — never rewrite or delete an entry; retire a wrong one
  with a newer dated entry marked `**Supersedes:**`.

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

## Do not touch

- `*/src/vendor/**` — mirrored shared code; edit the source in
  `server/src/vendor/shared`.
- `server/src/db/migrations/**` — generated. Change the schema, run `db:generate`.
- `.claude/skills/**` — vendored skills, tracked by `skills-lock.json`.
  First-party skills (`engineering-insights`) live there too and are edited here;
  they are **not** added to `skills-lock.json`.
- `*/pnpm-lock.yaml` — generated, one per package (there is no workspace-root
  lockfile). Never hand-edit and never hoist: change dependencies with
  `pnpm --dir <pkg> add|remove` and commit the lockfile that run rewrites.
  `skills-lock.json` is likewise written by the skills tooling, not by hand.

## Gotchas

- The app boots with **no API keys**; every secret is optional in
  `server/src/platform/config.ts` and can be set at runtime via Settings.
- Secrets live in `~/.devdigest/secrets.json` (mode `0600`), read only through
  `LocalSecretsProvider`. Never in the database, never in git.
- `GITHUB_TOKEN` is canonical; `GITHUB_PAT` is accepted as a fallback.
- The grounding gate is mandatory: a finding that does not cite a real diff line
  is dropped, and the score is recomputed from the survivors — never trusted from
  the model.
