# Routing — which skill judges which file

Read by `pr-self-review` step 4. Intersect every bucket's globs with the change set; a bucket
with no match does not run. A file in several buckets is reviewed by each — different lenses,
deduped afterwards.

Every skill named here must resolve at run time. One that does not is a **major**
`routing-drift`: the bucket reviewed less than it claims, and the run would otherwise pass for
the wrong reason.

## Buckets

| Bucket | Globs | Skills | Deterministic checks |
|---|---|---|---|
| **frontend** | `client/src/app/**`, `client/src/components/**`, `client/src/lib/**`, `client/*.config.*` | `frontend-ui-architecture`, `react-best-practices`, `next-best-practices`, `vercel-react-best-practices` | `pnpm --dir client typecheck`, `lint`, `test` |
| **frontend-tests** | `client/**/*.test.ts`, `client/**/*.test.tsx`, `client/src/test/**` | `react-testing-library` | — |
| **backend-arch** | `server/src/**` | `onion-architecture` | `pnpm --dir server arch` |
| **backend-http** | `server/src/modules/*/routes.ts`, `server/src/app.ts`, `server/src/server.ts`, `server/src/modules/index.ts`, `server/src/modules/_shared/context.ts`, `server/src/platform/sse.ts` | `fastify-best-practices` | — |
| **backend-data** | `server/src/db/**`, `server/src/modules/*/repository.ts`, `server/src/modules/*/repository/**` | `drizzle-orm-patterns`, `postgresql-table-design` | `pnpm --dir server typecheck` |
| **contracts** | `server/src/vendor/shared/**`, `**/*.schema.ts`, any diff hunk containing `z.object(`/`z.infer` | `zod` | vendor-mirror drift (severity.md §1) |
| **engine** | `reviewer-core/**` | `typescript-expert` | `pnpm --dir reviewer-core test`, `typecheck`, `lint` |
| **repo-intel** | `server/src/modules/repo-intel/**` | `onion-architecture`, `typescript-expert` | `pnpm --dir server test` |
| **adapters** | `server/src/adapters/**` | `onion-architecture`, `security` | `pnpm --dir server test` |
| **e2e** | `e2e/**` | read `e2e/AGENTS.md` + `TESTING.md` (no skill) | `pnpm --dir e2e lint` |
| **security** | `server/src/modules/*/routes.ts`, `server/src/adapters/**`, `server/src/platform/config.ts`, `server/src/platform/prompts.ts`, any path matching `secret|token|auth|upload|password|key`, any `client/src/app/**/route.ts` | `security` | secret scan (severity.md §1) |
| **types** | any `**/*.ts`, `**/*.tsx` outside `vendor/`, `dist/`, `migrations/` | `typescript-expert` | per-package `typecheck` |
| **repo-hygiene** | always runs | root `AGENTS.md` + each touched `<pkg>/AGENTS.md` | all tripwires (severity.md §1) |
| **docs** | `**/*.md` (excluding `INSIGHTS.md`, which is append-only) | `doc-standards`, `file-conventions` | — |

## Notes that decide the edge cases

- **`server/src/platform/` is not one thing.** Its files split across rings — a change to
  `container.ts`, `config.ts` or `prompts.ts` is backend-http/security territory; a change to
  `grounding.ts`, `resilience.ts` or `model-router.ts` is pure-core and goes to **types** +
  **backend-arch**. `onion-architecture` has the classification table; the bucket must use it
  rather than guess.
- **`*/src/vendor/**` is never reviewed on its own merits** — it is a mirror. A diff there is
  a tripwire (severity.md §1), not a review target. The exception is the source of truth,
  `server/src/vendor/shared/**`, which routes to **contracts**.
- **A new `src/modules/<name>/`** routes to backend-arch, backend-http and backend-data at
  once, plus the "registered in `modules/index.ts`" tripwire.
- **`e2e/` has no skill** — the bucket reads `e2e/AGENTS.md` and `TESTING.md` instead, and
  judges determinism (seeded data, no LLM in the loop) rather than style.
- **Adding a skill to `.claude/skills/` without adding a row here** is surfaced once per run
  as a `context` note. A new skill should answer "what files does this govern?".
