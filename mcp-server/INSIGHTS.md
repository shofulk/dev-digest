# INSIGHTS — `mcp-server`

Empirical findings about this package: things that cost time to discover and that the code
does not say out loud. Written and read by the `engineering-insights` skill — read this
file before working here, append to it when the work turns up something non-obvious.

**Append-only.** Never rewrite or delete an existing entry. A finding that turns out to be
wrong is retired by a newer dated entry carrying `**Supersedes:**`. New entries go directly
under their section's marker, newest first.

Entry shape (`Cause` / `Signal` / `Fix` are required under Recurring Errors & Fixes and
optional elsewhere; `Evidence` is always required):

```markdown
### YYYY-MM-DD — <the symptom or claim, as it first looked>

**Cause:** what was actually happening.
**Signal:** how to recognise it next time (error text, log line, failing test).
**Fix:** what resolved it, or the workaround that holds.
**Evidence:** `path/to/file.ts:42`
```

Not for: architecture (that is `README.md`), design rationale (`.doc/`), feature contracts
(`.spec/`), or anything a linter or type-checker already catches.

## What Works

Approaches and solutions that held up.

<!-- newest first: what-works -->

## What Doesn't Work

Dead ends and antipatterns. The most valuable section and the one most often skipped —
a documented dead end saves the next session the whole detour.

<!-- newest first: what-doesnt-work -->

## Codebase Patterns

Conventions and structural decisions that are not stated in the code.

<!-- newest first: codebase-patterns -->

### 2026-09-27 — a naive mutual-`extends` check does not prove two unions are exactly equal; it silently passes when one side has an extra member

Building `AssertMutuallyAssignable<A, B> = A extends B ? (B extends A ? true : never) : never`
for the S3 `DomainErrorKind`/`KnownDomainError['kind']` exhaustiveness assertion looked
right and *compiled* even with a deliberately mutated `A` carrying one extra literal member
not present in `B` (added `'x'` to `DOMAIN_ERROR_KINDS` without a matching class). Cause:
both `A extends B` and the nested `B extends A` are naked-type-parameter conditionals, so TS
distributes each one over its own union members independently; the extra member's branch
evaluates to `never`, and `never` is absorbed away when unioned with the `true` results from
every matching member — the type checker never sees the mismatch. Fix: use the standard
invariant-position "exact type equality" trick, which avoids distribution entirely:
`type IsExactly<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;`
then `AssertMutuallyAssignable<A, B> = IsExactly<A, B> extends true ? true : never`. Proved by
adding the same mutation and confirming `tsc` now fails with `Type 'true' is not assignable
to type 'never'` (T14, control 2). Any future "these two literal unions must match exactly"
assertion in this package should use `IsExactly`, not a hand-rolled mutual `extends`.
**Evidence:** `mcp-server/src/domain/errors.ts` (`IsExactly`, `AssertMutuallyAssignable`)

## Tool & Library Notes

Quirks of dependencies, CLIs and the toolchain.

<!-- newest first: tool-and-library-notes -->

### 2026-09-27 — the CI paths filter is not a drift detector; nothing about it is compile-time

**Supersedes:** 2026-09-27 entry below ("`server/src/vendor/shared` contracts fail `tsc`
under this package's zod 4"), specifically its claim that the CI workflow's `paths:` entry
watching `server/src/vendor/shared/**` is "the only *static* drift detector for a server-side
rename or field removal." That framing implied some compile-time check still exists. It does
not: since rev 3, nothing in `mcp-server/src/**` imports `server/src/vendor/shared` at all
(confirmed again in rev 5 by `! rg -n '@devdigest/shared' mcp-server/src`), so there is no
import graph for a rename or field removal to break. The `paths:` entry only re-triggers the
hermetic test suite when the shared contracts change — it re-runs tests, it does not detect
anything about them. The only real drift detector for "did a server route/field change under
this package's feet" is the S12 live smoke run against a real DevDigest API (`list_agents`
byte count, a real `run_agent_on_pr`, etc.) — a *runtime* check, not a static one. The
distinction matters because it is tempting to read `paths:` in a workflow file as some kind
of contract-compatibility gate; here it is not one.
**Evidence:** `.github/workflows/mcp-server.yml` (header comment), `mcp-server/eslint.config.js` (`noSharedImport`)

### 2026-09-27 — an ESLint `no-restricted-imports` allowlist beats an enumerated denylist for a ring boundary, but only with `regex`, and only if the regex also excludes `..` segments

Rev 4's per-ring rule was a denylist: `['../config.js', '../log.js', '../server.js',
'../index.js', '../*.js']`. It worked against every spelling the plan had tried, but retro
review found it was a spelling *enumeration* — `'../config'` (no extension), `'..'` and
`'../index'` (no `.js`) all imported the same forbidden file yet matched none of those
literal `group` strings, because `no-restricted-imports`'s plain `group` patterns are glob
matches against the literal import specifier, not path-normalizing. Rev 5 replaced every
per-ring denylist with an allowlist expressed as a single `regex` pattern per ring (ESLint
10.11 compiles `no-restricted-imports`'s `regex` option with the `iu` flags and matches
against the raw source text, same as `group`, but a regex can express "anything that isn't
this shape" instead of enumerating every disallowed shape): `^(?!\./)|/\.\.(/|$)` for
`src/domain/**` reads as "flag anything that doesn't start with `./`, OR anything containing
a `..` path segment anywhere" — the second alternative is required even on an allowlist,
because `./sub/../../../etc` starts with `./` but still escapes the ring. Getting the
`(?!\./)` negative lookahead right (vs. accidentally writing `^\./` as a *match* pattern,
which produces the opposite of a restriction) and remembering the second `/\.\.(/|$)` clause
were both easy to get subtly wrong; the T12 negative controls (`'../config'`, `'..'`,
`'../index'`, and a `'./../config.js'` traversal spelled through an already-allowed prefix)
are what actually proves the allowlist has no gap, not reading the regex.
**Evidence:** `mcp-server/eslint.config.js` (`DOMAIN_ONLY_LOCAL_IMPORTS`, `APP_ONLY_DOMAIN_IMPORTS`, `ADAPTERS_NO_OUTER_IMPORTS`), `docs/plans/mcp-server.plan.md` (rev 5, T12)

### 2026-09-27 — the `moduleResolution: NodeNext` probe (R17) passed clean: no source edit needed, and it closes a lint-only gap ESLint cannot

Switching `tsconfig.json`'s `module`/`moduleResolution` from `ESNext`/`Bundler` to
`NodeNext`/`NodeNext` (rev 5, S1) required no source change at all, because every relative
import in `src/**` and `test/**` already carried an explicit `.js` extension (a pre-existing
habit, not something added for this probe). `typecheck`, `test` (vitest via `tsx`'s esbuild
transform) and `start` (`tsx src/index.ts`, the AC1 zero-stdout-bytes check) all still pass
unchanged. The payoff: `moduleResolution: NodeNext` makes an *extensionless* relative import
(`'../config'`) or a bare `'..'`/`'../index'` fail `typecheck` with TS2834/TS2835 — a class of
ring-boundary bypass that lint's `no-restricted-imports` `regex` option also happens to catch
today, but redundantly from a different layer (compiler vs. linter), which is worth having
given how easy the rev-4 denylist gap (previous entry) was to miss by inspection alone.
**Evidence:** `mcp-server/tsconfig.json`, `docs/plans/mcp-server.plan.md` (rev 5, S1, T14)

### 2026-09-27 — a generic constraint `<T extends Record<string, unknown> & {...}>` rejects a named interface with no index signature, even though the interface is a plain data shape

Writing `budgetFindings<T extends Record<string, unknown> & { findings: unknown[]; total:
number }>` and calling it with a `RunOutcome` (a named `interface`, not a type literal)
failed `tsc` with "Index signature for type 'string' is missing in type 'RunOutcome'" —
unlike ordinary assignability (`const r: Record<string, unknown> = someRunOutcome` does
typecheck), *generic constraint satisfaction* at a call site checks the argument type
against the full constraint structurally, and a declared `interface`/`class` without an
index signature does not satisfy an intersection that includes one, even though every one of
its properties is trivially assignable to `unknown`. Fix: drop the `Record<string, unknown>
&` half of the constraint and rely on the narrower structural shape alone (`T extends {
findings: unknown[]; total: number }`); the domain `fitToBudget<T extends object, K extends
keyof T & string>` needed the same fix (`T extends Record<string, unknown>` → `T extends
object`). Same applies to any future generic over an API-shaped interface passed by these
use cases.
**Evidence:** `mcp-server/src/tools/budget.ts` (`budgetFindings`, `budgetAgents`,
`budgetConventions`), `mcp-server/src/domain/findings.ts` (`fitToBudget`)

### 2026-09-27 — `mcp-inspector --cli`'s positional `target` must come immediately after `--cli`, *before* `--method` — not after it

**Supersedes:** 2026-09-27 entry below ("positional `target` must come immediately after
`--method`"). Re-run in the rev-4 fix round with the same installed Inspector version:
`mcp-inspector --cli --method tools/list node …/tsx/dist/cli.mjs mcp-server/src/index.ts`
(target *after* `--method`, exactly as the superseded entry prescribed) now fails with
`{"error":{"code":"error","message":"No servers found in config file"}}` — every ordering
with `--method` before the target command does, including the exact invocation the
superseded entry recommends. What works instead: `mcp-inspector --cli <command>
<args...> --method <method> --tool-name <name> --tool-arg k=v -e KEY=VAL` — the target
command comes right after `--cli`, and `--method` plus every other Inspector flag follow it.
Putting `-e KEY=VAL` right after the target (before `--method`) also works; only `--method`
before the target is fatal. The commander.js variadic-args parser evidently now treats
anything before the first *known* flag after `--cli` as part of the target only if `--method`
has not already been consumed — an Inspector version/behavior drift from when the superseded
entry was written, not a plan or package bug.
**Evidence:** manual S12(a)/(b)/(d)/(e) live re-checks in the mcp-server rev-4 fix round (`docs/plans/mcp-server.plan.md`)

### 2026-09-27 — `mcp-inspector --cli` positional `target` must come immediately after `--method`, before any other flag (including `-e`/`--tool-arg`)

Every ordering with `-e KEY=VAL` or `--tool-arg` placed before the `target...` (even behind a
`--` separator) failed with either `"No servers found in config file"` or `"Method is
required"` — the CLI's own top-level help note ("Mode flags must appear before app options;
all following arguments are forwarded unchanged") does not warn that order matters *inside*
`--cli` mode too, once the variadic `target` starts consuming argv. What worked:
`mcp-inspector --cli --method <method> <command> <args...> --tool-name <name> --tool-arg k=v
-e KEY=VAL` — `--method` first, then the full target command + its own args, then every other
Inspector flag *after* the target. `pnpm --silent --dir mcp-server start` as the target itself
also failed opaquely (`"Connection closed"`); spawning
`node mcp-server/node_modules/tsx/dist/cli.mjs mcp-server/src/index.ts` directly as the target
avoided whatever pnpm-wrapper interaction caused that.
**Evidence:** manual S12(a)–(e) runs (`docs/plans/mcp-server.plan.md`), `mcp-server/README.md` (§ Running → With the MCP Inspector)

### 2026-09-27 — bare `pnpm --dir mcp-server start` writes pnpm's own banner to stdout; `--silent` is required for AC1

`pnpm --dir mcp-server start </dev/null` (no `--silent`) exits 0 but writes 127 bytes to
stdout before the server ever starts (`> @devdigest/mcp-server@0.0.0 start …` +
`> tsx src/index.ts`), which would corrupt the MCP stdio channel if `.mcp.json` invoked it
that way. `pnpm --silent --dir mcp-server start </dev/null 2>/dev/null | wc -c` → `0`, exit 0
— confirming the plan's R3. `.mcp.json`'s `args` therefore include `--silent` before `--dir`.
**Evidence:** `.mcp.json`, `mcp-server/test/stdio.test.ts` (T11 spawns `tsx` directly, bypassing pnpm, so it needs no `--silent`)

### 2026-09-27 — `server/src/vendor/shared` contracts fail `tsc` under this package's zod 4

Confirms the plan's R2: `tsc` fails inside `contracts/platform.ts` because a Zod 4
`z.record(enum, …).default({})` is exhaustive over the enum key and no longer typechecks
(`z.record` semantics changed between v3 and v4). Fallback taken: `src/domain/contracts.ts`
declares minimal local interfaces (one per field this package actually reads, each commented
with its source contract), the `@devdigest/shared` tsconfig path alias is removed, and ESLint
bans any import of `@devdigest/shared` or `../server/**` outright (not just non-type
imports). The CI workflow still watches `server/src/vendor/shared/**` in its `paths:` filter
— since there is no compile-time dependency any more, that path is the only *static* drift
detector for a server-side rename or field removal; the S12 live smoke run is the runtime one
(see the `list_agents` entry above, found only by running against the real API).
**Evidence:** `mcp-server/src/domain/contracts.ts`, `mcp-server/tsconfig.json`, `mcp-server/eslint.config.js`, `.github/workflows/mcp-server.yml`

### 2026-09-27 — `@modelcontextprotocol/server` v2.1.0 / `client` v2.1.0 API surface (SDK v2, zod 4.6.5)

- `McpServer` and `InMemoryTransport` come from `@modelcontextprotocol/server` (the package
  root, not a subpath); `serveStdio(factory, {onerror})` comes from the `/stdio` subpath and
  returns a handle with `close()`.
- `registerTool(name, {description, inputSchema: z.object(...), annotations}, cb)` — the
  raw-shape form (`inputSchema` as a plain `{field: z.string()}` record) is deprecated, and a
  `z.object(...)` does **not** satisfy the raw-shape overload's `ZodRawShape` constraint, so
  passing it selects the *other* overload, whose callback must return the full SDK
  `CallToolResult` (which includes `resultType` for the 2026-07-28 `input_required`
  variant) — a hand-rolled minimal result type does not structurally match and `tsc` rejects
  every `registerTool` call with a confusing "no overload matches" error. Fix: import
  `CallToolResult` from `@modelcontextprotocol/server` and use it as the tool-result type.
- `new McpServer(info, {instructions, capabilities: {tools: {}}})` — `instructions` is read
  back by `Client.getInstructions()`.
- `Client` comes from `@modelcontextprotocol/client`, with `connect`, `listTools`,
  `callTool({name, arguments})`, `getInstructions()`.
- `InMemoryTransport.createLinkedPair()` is exported by both packages (the same class) — pass
  one half to `server.connect()`, the other to `client.connect()`.
**Evidence:** `mcp-server/node_modules/@modelcontextprotocol/server/dist/createMcpHandler-*.d.mts` (`McpServer`, `registerTool`, `ServerOptions`), `mcp-server/src/tools/result.ts`, `mcp-server/test/helpers/connect.ts`

## Recurring Errors & Fixes

Errors seen more than once, each with the signal that identifies it.

<!-- newest first: recurring-errors-and-fixes -->

### 2026-09-27 — `list_agents` leaked full Agent rows (`system_prompt`, `output_schema`, …) past the token budget

**Cause:** `use-cases.ts` mapped agents with `{ ...a, description: truncate(...) }`; `a` is typed
against this package's narrow local `Agent` interface (`id`/`name`/`description`/`model`/
`enabled`), but the real `GET /agents` response is the server's full `Agent` row (also
`provider`, `system_prompt`, `output_schema`, `version`, `strategy`, `ci_fail_on`,
`repo_intel`). TypeScript's structural typing lets the spread compile — nothing in the type
system flags "the runtime value has more fields than the type says."
**Signal:** a hermetic unit test against `test/helpers/fake-api.ts` never catches this,
because the fake object is built to match the narrow interface by construction. Only a live
smoke call against the real API (plan S12b) showed a ~44 KB `list_agents` response instead of
~800 bytes — one field (`system_prompt`) alone blew past `TEXT_FIELD_MAX`.
**Fix:** build the concise object with an explicit field list
(`{id: a.id, name: a.name, description: truncate(...), model: a.model, enabled: a.enabled}`),
never `{...row, ...}`, whenever a mapped type is a *subset* of what the API actually returns.
Added a regression test asserting `Object.keys(...)` is exactly the five fields even when the
fake row is given extra ones.
**Evidence:** `mcp-server/src/app/use-cases.ts` (`listAgents`), `mcp-server/test/use-cases.test.ts` ("strips fields beyond the concise shape…")

## Session Notes

Dated summaries of sessions worth remembering as a whole.

<!-- newest first: session-notes -->

### 2026-09-27 — rev 4 fix round: real C4 budget wiring, injection-mitigation text, exhaustive error mapping

Implemented the rev-4 deltas (S1, S3, S5, S7, S10, S11, S13, S14) on top of the rev-3 build:
a closed `DomainErrorKind` union with a real (not hand-rolled-and-broken) mutual-equality
type assertion; `guard`/`toForwardText` now resolve to `isError` instead of throwing on an
unmapped kind; every free-text field (finding `title`/`rationale`/`suggestion`/`location`
file part, convention `rule`/`evidence` path part, run `error`, agent `description`)
truncated to `TEXT_FIELD_MAX`; a new `src/tools/budget.ts` owning every cap/cut hint string,
applied to all four data-returning tools with `guard`'s last-resort net enforcing
`RESPONSE_MAX_CHARS` on every response including errors; `run_agent_on_pr`'s schema cut down
to exactly `{repo, pr, agent}` (O7); an "untrusted data" sentence added to `INSTRUCTIONS` and
three tool descriptions; ring-3-root-file and `fetch`/`globalThis.fetch` ESLint bans added
per ring. `pnpm typecheck`/`lint`/`test` all pass (16 files, 107 hermetic tests, up from 13
files/87 tests in rev 3). All eight T12 lint negative controls and all three T14 typecheck
negative controls were run by hand and reverted (none committed). Live re-check against the
same running sandbox stack (`API_PORT=3003`): `tools/list` order and the trimmed
`run_agent_on_pr` schema confirmed; `list_agents` 832 bytes; `get_findings` on the existing
PR #482 run 148 bytes; `get_conventions` on an empty repo returns the "no conventions" hint;
the "no run" error confirmed on `shofulk/dev-digest#1`; the unreachable-API error confirmed
against `http://localhost:1`. `git diff --stat main -- server client reviewer-core e2e`
stays empty (AC15).
**Evidence:** `docs/plans/mcp-server.plan.md` (rev 4), `mcp-server/src/tools/budget.ts`, `mcp-server/src/domain/errors.ts`

### 2026-09-27 — mcp-server S1–S13 built and verified against a live DevDigest stack

Built the full package (domain → app → adapters → tools/index → composition root) per
`docs/plans/mcp-server.plan.md` rev 3, continuing from the main session's S1/S2 scaffold.
`pnpm typecheck`/`lint`/`test` all pass (13 files, 87 hermetic tests). Live evidence against
the sandbox's already-running stack (`API_PORT=3003`, an OpenRouter key present in
`server/.env`): `tools/list` returns the 5 tools in the fixed order with the right
annotations; `list_agents` returns the 4 seeded agents in ≈800 bytes (after the spread-leak
fix above); a real `run_agent_on_pr` on the seeded PR #482 with "General Reviewer" completed
in ~7 s with `status:"done", verdict:"approve", score:100` — well under `RUN_WAIT_MS` (100 s);
`get_findings` re-read the same run without re-triggering; the "no run" and "API unreachable"
forward-leading errors were both confirmed live. `git diff --stat main -- server client
reviewer-core e2e` is empty (AC15).
**Evidence:** `docs/plans/mcp-server.plan.md` (S12), `mcp-server/README.md`

## Open Questions

Things left unresolved, so the next session does not re-derive the same uncertainty.

<!-- newest first: open-questions -->

### 2026-09-27 — `/context` startup-cost number (AC14) not yet recorded

Plan S12(f) — approving `.mcp.json`'s `devdigest` server in Claude Code and reading the
`/context` startup-cost number — needs an interactive Claude Code session and could not be
done from this subagent. `DEVDIGEST_API_URL=http://localhost:3003` must be exported before
launching Claude Code in this sandbox (the default `.mcp.json` URL is `:3001`, which is wrong
here). Record the number in this file once measured, superseding this entry.
**Evidence:** `docs/plans/mcp-server.plan.md` (S12 step f, AC14)
