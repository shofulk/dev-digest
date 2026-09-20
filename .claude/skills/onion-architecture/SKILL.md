---
name: onion-architecture
description: Onion/ports-and-adapters rules for the DevDigest backend — which ring every file belongs to, what each ring may import, and the per-tool rules (Fastify, Zod, Drizzle, the DI container, reviewer-core) that keep dependencies pointing inward. Use when adding or moving a file under server/src (a new src/modules/<name>/, a new adapter, a change to container.ts, service.ts, repository.ts or routes.ts), when deciding where code should live, and when reviewing backend changes for layer violations.
---

# Onion architecture — DevDigest backend

One rule, stated once: **dependencies point inward.** Inner rings declare the interface,
outer rings implement it, and nothing inner ever names anything outer — not by import, not
by type, not by an error class.

This file is the enforcement contract for `server/` and `reviewer-core/`. It does not
restate why (`server/README.md`), it says what is allowed.

## The rings, by real path

| Ring | Paths | May import |
|---|---|---|
| **0 — Domain / contracts** | `server/src/vendor/shared/**`, `reviewer-core/src/**`, and the pure half of `platform/` (`errors.ts`, `model-router.ts`, `resilience.ts`, `grounding.ts`, `prompt.ts`, `structured.ts`, `price-book.ts`, `trace-builder.ts`) | `zod`, other ring-0 files. Nothing else. |
| **1 — Application / services** | `modules/*/service.ts`, `modules/*/run-executor.ts`, `modules/*/helpers.ts`, `modules/*/findings.ts`, `modules/*/diff-loader.ts`, `modules/repo-intel/pipeline/**` | ring 0, port **types** (`@devdigest/shared`), repository **types**, `platform/errors.ts` |
| **2 — Infrastructure** | `src/adapters/**`, `modules/*/repository.ts` + `modules/*/repository/**`, `src/db/**`, and the infra half of `platform/` (`jobs.ts`, `sse.ts`, `run-logger.ts`, `prompts.ts`) | ring 0, its own SDK, `src/db/**` |
| **3 — Composition root / edge** | `src/server.ts`, `src/app.ts`, `modules/index.ts`, `modules/*/routes.ts`, `platform/container.ts`, `platform/config.ts`, plugins | everything |

`modules/_shared/**` is ring 1 unless it touches Fastify (`context.ts` does) — then it is
ring 3.

Two facts that decide most arguments:

- `platform/` is **not** a ring. It is split; the table above is the classification, and a
  new file in `platform/` must be placed into one of the two halves in its header comment.
- A module folder is a vertical slice, not a layer. `modules/reviews/` contains ring 1, 2
  and 3 files side by side; the ring is the **file**, not the folder.

## Where does this file go — four questions

Ask in order, stop at the first yes.

1. Does it know about HTTP, Fastify, wiring or process boot? → **ring 3** (`routes.ts`,
   `index.ts`, `container.ts`).
2. Does it know about SQL, an SDK, the filesystem, the network or the event loop? →
   **ring 2** (`repository/`, `adapters/<port>/`).
3. Does it orchestrate a use case — several ports in a sequence, with rules about order,
   failure and retries? → **ring 1** (`service.ts` and its extracted helpers).
4. Is it a rule, a shape or a contract that would still be true with no database and no
   HTTP? → **ring 0** (`vendor/shared/contracts`, `reviewer-core/src`).

If it wants to be two rings at once, it is two files.

## Per-tool rules

### Fastify — only ring 3 knows it exists

- `import 'fastify'` / `@fastify/*` is legal **only** in `routes.ts`, `modules/index.ts`,
  `server.ts`, `app.ts` and plugins. A service importing `FastifyInstance` is a violation,
  not a shortcut.
- `FastifyRequest`, `FastifyReply` and `req.log` never cross into ring 1. The logger is a
  port: pass the structured `Logger` type (`modules/reviews/run-executor.ts:22`), which
  `req.log` satisfies structurally. Never pass `reply` in to let a service write a response.
- A route handler does three things: parse the request with its Zod contract, call one
  service method, return a DTO. Branching business rules in a handler belong in the service.
- Failures leave ring 1 as `AppError` subclasses from `platform/errors.ts`. HTTP status
  codes are decided by the error handler, never by a service.
- Plugin encapsulation is the wiring seam: a module registers its own routes and builds its
  own service instance at registration time, not at request time.

### Zod — parse at the boundary, trust inside

- Contracts live in `server/src/vendor/shared/contracts` and are edited only there. They are
  the language of the ports, so ring 0 owns them.
- One contract drives request validation and response serialization
  (`fastify-type-provider-zod`). Never hand-write a second response shape.
- Parse once, at the edge. A ring-1 service that re-parses its own arguments is saying it
  does not trust its boundary — move the boundary instead.
- A DTO is not a DB row. `ReviewDto` is built by an explicit mapper (`helpers.ts`), never by
  casting a Drizzle row.
- When a contract field is read back out of a stored jsonb document, it must be `nullish()`
  — see the `RunStats` entry in `server/INSIGHTS.md`.

### Drizzle — persistence is a ring-2 detail

- `drizzle-orm`, `postgres`, `src/db/schema.js` and `src/db/client.js` may be imported only
  from `src/db/**`, `modules/*/repository*`, `src/adapters/**` and `platform/jobs.ts`.
- A repository returns domain types or row types declared in `src/db/rows.ts` — never a
  query builder, never a partially-applied `db` handle, never a Drizzle error.
- An inline `typeof t.<table>.$inferSelect` outside `src/db/rows.ts` and `repository*` is a
  leak. Row shapes are named once in `db/rows.ts`; ring 1 imports the name (`AgentRow`,
  `PullRow`), and the owning repository re-exports it so its public type API is unchanged.
- A transaction is owned by the repository or by an explicit unit-of-work handed in. A
  service must not take Drizzle's transaction type as a parameter.
- Schema changes go through `src/db/schema.ts` + `pnpm db:generate`. Migrations are never
  hand-written.

### The DI container — resolve at construction, never at call time

The repo convention (`server/AGENTS.md`) is that services take the `Container`. That is
fine; what is not fine is keeping it and reaching through it later. Concretely:

- A service's constructor resolves everything it needs into fields (`this.repo`,
  `this.bus`, `this.jobs`) and does not keep `container` as a field it queries inside
  methods. A method body containing `this.container.<anything>` is a service locator, and it
  is the failure this rule exists to stop. **This is the largest outstanding debt in the
  package** (`modules/repos/service.ts`, `modules/repo-intel/service.ts`,
  `modules/agents/service.ts` all do it today), so the rule is enforced forward: a new or
  edited service resolves in the constructor; existing call sites are converted when the
  file is touched for other reasons, never in a drive-by sweep.
- A ring-1 file never constructs a ring-2 concrete class. `new ReviewRepository(db)`,
  `new OctokitGitHubClient(token)` and friends belong in `platform/container.ts` — the
  composition root is the only place allowed to know which implementation is real.
- Only ports (interfaces from `@devdigest/shared`) appear in ring-1 field and parameter
  types. `OpenAIProvider` as a type in a service is a violation; `LLMProvider` is correct.
- Tests inject through `ContainerOverrides` with `src/adapters/mocks.ts`. A service that
  cannot be tested with mocks alone has an undeclared dependency.

### Adapters — one port, one SDK, no upward knowledge

- Every SDK (`octokit`, `openai`, `@anthropic-ai/sdk`, `simple-git`, `@ast-grep/napi`,
  `@vscode/ripgrep`, `dependency-cruiser`, `js-tiktoken`) is imported in exactly one adapter
  folder. A second import site is a missing port.
- The port interface is declared in ring 0 (`@devdigest/shared`), never in the adapter. The
  adapter file names the interface it implements in its class declaration.
- `src/adapters/**` never imports `src/modules/**`. If an adapter needs a module's data, the
  data is passed in.
- Secrets reach an adapter as a constructor argument. Adapters do not read `process.env` and
  do not call `SecretsProvider` themselves — the container does that.

### reviewer-core — the purity guard

`reviewer-core/src` is ring 0 for both consumers (studio and CI runner). It may not import
`fastify`, `drizzle-orm`, `src/db/**`, `node:fs`, `node:child_process`, `octokit` or any
provider SDK. Its only side effect is a call through an injected `LLMProvider`. A helper
that needs the filesystem belongs in `server/src/adapters` and is passed in.

## Anti-patterns

| Smell | Why it breaks the onion | Move to |
|---|---|---|
| `this.container.x` inside a method | service locator: the dependency is invisible in the signature | resolve in the constructor |
| `new <Concrete>()` in a service | ring 1 naming a ring-2 implementation | `platform/container.ts` |
| `$inferSelect` / Drizzle types in a service or DTO | persistence shape becomes the domain shape | mapper + `db/rows.ts` |
| `req` / `reply` / `app.log` below `routes.ts` | HTTP leaks into the use case | `Logger` port, plain arguments |
| Business branching in a route handler | the rule is untestable without an HTTP server | service method |
| Entities as pure data bags with every rule in a service | anemic domain — the onion is only folders | push invariants into the contract/domain helpers |
| A module importing another module's `service.ts` or `repository.ts` | slice coupling; the container stops being the wiring | `modules/_shared/` or a shared repo on the container |
| A repository method that only wraps one `db.select()` with no aggregate boundary | a worse interface over the database | inline it, or give the repository a real aggregate |

## Enforcement

`enforcement/dependency-cruiser.cjs` in this skill is the machine-checkable subset of the
rules above. It is installed at `server/.dependency-cruiser.cjs` and run with:

```
pnpm --dir server arch
```

`dependency-cruiser` is already a server dependency (it also backs `adapters/depgraph`), so
this costs no install. Edit the copy in this skill and re-copy it to `server/`, so the two
do not drift.

Rules that are already clean are `error`; rules with known outstanding violations are
`warn` and carry an `OUTSTANDING` comment naming every violating file, so a warning means
"this one, still open" and not background noise. Promote a rule to `error` in the same
commit that clears its last violation.

Baseline at the time of writing: **0 errors, 17 warnings** —
`no-orm-outside-persistence` (8), `no-circular` (5, four of them the
`container.ts ↔ repo-intel/service.ts` knot), `routes-dont-touch-persistence` (4, counted
inside the ORM total), `adapters-dont-know-modules` (2), `no-cross-module-internals` (1).
A change that raises any of those counts is a regression.

Two resolution details the rules depend on, both of which silently break naive regexes:

- pnpm resolves packages to `node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/…`, so a
  rule anchored `^node_modules/<pkg>/` never matches. Leave those paths unanchored.
- `@devdigest/reviewer-core` and `@devdigest/shared` are tsconfig path aliases, so
  dependency-cruiser cruises `../reviewer-core/src/**` as part of the server graph, and
  reviewer-core's `@devdigest/shared` imports appear as `src/vendor/shared/**`. Any rule
  written over `^src/` therefore also fires on imports originating in reviewer-core.

Type-level leaks (a Drizzle row in a service signature, an anemic entity) are not
expressible in dependency-cruiser. Those are the review checklist below.

## Review checklist

Before finishing any change under `server/src`:

1. Every new file states its ring in the header comment, and the imports agree with it.
2. No ring-1 file imports `fastify`, `drizzle-orm`, `src/db/schema.js`, or a concrete
   adapter class.
3. No method body reaches through `this.container`.
4. Every new SDK import sits in an adapter behind a port declared in `@devdigest/shared`.
5. `pnpm --dir server exec depcruise src --config .dependency-cruiser.cjs` reports no new
   violations, and no `warn` count went up.
6. The new service path is exercised by a hermetic test using `adapters/mocks.ts`. Needing
   a real Postgres to test a use case means the use case is in the wrong ring.

See `examples.md` for before/after pairs taken from this codebase, and `references.md` for
sources.
