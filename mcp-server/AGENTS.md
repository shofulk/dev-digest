# `@devdigest/mcp-server` — the DevDigest MCP server

Local stdio MCP server: a thin client of the existing DevDigest HTTP API. No DB access, no
DI container, no change to `server/`. Exposes `list_agents`, `run_agent_on_pr`,
`get_findings`, `get_conventions` and a stub `get_blast_radius` to MCP clients (Claude Code).

## Read when

- Architecture, the run lifecycle, config → `./README.md` (source of truth; never restate
  it here).
- Implementing a feature → `./.spec/<feature>.spec.md` first. If no spec exists, ask
  whether to write one before the code.
- Starting any work here → `./INSIGHTS.md` first; at the end of the task run
  `engineering-insights` to append what is worth keeping (append-only).

## Commands

`pnpm --dir mcp-server start` (stdio, `tsx src/index.ts`) · `pnpm --dir mcp-server test`
(vitest) · `pnpm --dir mcp-server typecheck` · `pnpm --dir mcp-server lint`. No `build` — the
package runs from TypeScript through `tsx` (O6).

## Conventions

- **Stdout is the JSON-RPC channel.** Nothing but MCP frames goes to stdout. Every
  diagnostic goes to stderr through `src/log.ts` — never a bare `console.log` or
  `process.stdout.write` (enforced by `eslint.config.js`).
- **Onion rings (C1 of the plan; the `onion-architecture` skill applied by analogy).**
  Dependencies point inward: `src/domain/**` (contracts, the `DevDigestApi` port, typed
  domain errors, pure findings rules) ← `src/app/**` (use cases: `resolve.ts`,
  `run-review.ts`, `use-cases.ts`) ← `src/adapters/**` (the HTTP adapter) ← `src/tools/**` +
  `src/server.ts` + `src/config.ts` + `src/log.ts` + `src/index.ts` (edge / composition
  root). Every file under `src/` opens with a header comment stating its ring, and its
  imports agree with it. `src/index.ts` is the only file that constructs the concrete HTTP
  adapter.
- **No `@devdigest/shared` import, anywhere (rev 3).** The shared contracts are Zod 3 source
  and fail to typecheck under this package's Zod 4 (`z.record` over an enum key is exhaustive
  in Zod 4). `src/domain/contracts.ts` declares minimal local interfaces instead, each naming
  its source contract in a comment. `server/**` is never imported either — this package is a
  pure HTTP client of it. Both are enforced by `eslint.config.js`'s `no-restricted-imports`.
- **Error and hint text placement (rev 5).** Placement rule: every `fail()` text in the
  package — including `guard`'s unexpected-error and budget-exceeded texts and the
  `get_blast_radius` stub — lives only in `src/tools/errors.ts`, which clips every echoed
  field (a URL, an API message, a repo/agent/run query, a list of known repos or ambiguous
  matches) to `TEXT_FIELD_MAX`. Second half of the rule: every success-path hint — a result's
  `hint` key: the findings cap, the findings cut, the `run_agent_on_pr` "still running" hint
  and the `get_conventions` empty-list hint — lives only in `src/tools/budget.ts`, which
  clips the `repo`/`agent` it echoes too. Tool descriptions and input schemas stay in their
  own tool files. Everywhere else, a failure is a typed `DomainError` subclass from
  `src/domain/errors.ts` carrying data only (a repo query, a PR number, a URL tried), and
  `src/domain/findings.ts` returns counts only, never a "showing N of M" or "N omitted"
  string. `toForwardText()` is an exhaustive switch over `KnownDomainError['kind']`, so a new
  domain error class that forgets a case fails `typecheck`.
- **Exhaustiveness is real, not a convention (rev 4).** `DomainErrorKind` in
  `src/domain/errors.ts` is a closed literal union (`DOMAIN_ERROR_KINDS`), not `string`, and
  a type-level assertion ties it to `KnownDomainError['kind']` — a new `DomainError`
  subclass with a `kind` outside that list, or a kind added to one without the other, fails
  `typecheck` before it ever reaches `toForwardText`'s `switch`. The one cast from
  `DomainError` to `KnownDomainError` sits in `src/tools/result.ts`'s `guard`.
- **Per-ring import allowlists, not denylists (rev 5).** `src/domain/** may import only`
  `./` ring-0 files of its own — no package, no `node:*`, no `..` segment at all.
  `src/app/**` may import only `./` and `../domain/`. `src/adapters/**` may reach upward
  only into `../domain/` (never a ring-3 root file, `../app/` or `../tools/`). These rules
  are ESLint `regex` patterns that match a relative import with or without its file
  extension. Relative imports carry an explicit `.js` extension throughout `src/**`, which
  `moduleResolution: NodeNext` (`tsconfig.json`) enforces at `typecheck` on top of ESLint —
  an extensionless import fails `typecheck` even where lint alone might miss a new
  spelling (R17; if the NodeNext probe was reverted, `Bundler` stays and the ESLint rules
  are the only guard). Outside `src/adapters/**`: no `fetch`, `globalThis.fetch`,
  `global.fetch`, `self.fetch` (destructuring `const { fetch } = globalThis` included), and
  no `node:http`/`https`/`net`/`undici` import (plus `http2`/`tls`/`dgram`) — enforced by
  `eslint.config.js`'s `no-restricted-globals`, `no-restricted-properties` and
  `no-restricted-imports`. `process.env` stays confined to `src/config.ts` the same way.
- **Tool design (C4 of the plan).** Result, not operation — a tool does the whole job
  (`run_agent_on_pr` triggers, waits and returns findings in one call). Flat scalar
  arguments only (`z.string`, `z.number`, `z.enum`) — no nested objects or arrays in an input
  schema. Concise, structured output: `structuredContent` is always a JSON object (arrays are
  wrapped), plus the identical JSON as one text block. Errors lead forward: never a bare
  status, always the next call to make.
- **Budget.** `instructions` ≤ 500 chars, tool descriptions ≤ 400, argument descriptions
  ≤ 120. Every response stays ≤ `RESPONSE_MAX_CHARS` (20 000 chars); free-text fields are
  truncated to `TEXT_FIELD_MAX` (500 chars). See `src/config.ts`.
- **`src/tools/*.ts` stay thin.** Parse args → call exactly one use case from
  `src/app/use-cases.ts` → add a forward hint if needed → `ok()`/`fail()` from
  `src/tools/result.ts`. Business branching (resolve, the `AgentDisabled` gate, run
  selection, the conventions filter) lives in the use case, not the tool file.
- **Hermetic tests only (AC13).** No network, no Docker. `test/helpers/fake-api.ts` is an
  in-memory `DevDigestApi`; `test/helpers/connect.ts` wires `createServer` to the SDK's
  in-memory client/transport pair.

## Do not touch

`server/**`, `client/**`, `reviewer-core/**`, `e2e/**` — this package changes none of them
(AC15). `src/domain/contracts.ts` is the only seam that may ever name a shared contract by
comment; it still never imports `@devdigest/shared`.
