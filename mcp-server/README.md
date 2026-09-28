# DevDigest MCP server

A local stdio MCP server that lets Claude Code (or any MCP client) list DevDigest reviewer
agents, run one on a pull request and get its verdict and findings back, re-read the
findings of a finished run, and read a repo's accepted coding conventions — built entirely
on the existing DevDigest HTTP API. No database access, no DI container, no change to
`server/`, `client/`, `reviewer-core/` or `e2e/`.

## Architecture

Dependencies point inward, one ring per concern (the `onion-architecture` skill applied by
analogy — see `.claude/skills/onion-architecture` at the repo root):

```
src/domain/**        ring 0 — contracts, the DevDigestApi port, typed domain errors
                      (a closed DomainErrorKind union, S3), pure findings rules
                      (sort/filter/shape, data-only budget cut). No I/O, no hint text.
      ↑
src/app/**            ring 1 — use cases: resolve.ts (repo/pr/agent resolution),
                      run-review.ts (trigger + poll to a deadline), use-cases.ts
                      (listAgents, runAgentOnPr, getFindings, getConventions).
      ↑
src/adapters/**        ring 2 — the HTTP adapter (createHttpApi), implementing the
                      DevDigestApi port over fetch. Throws DomainError only.
      ↑
src/tools/** + server.ts + config.ts + log.ts + index.ts
                      ring 3 — edge / composition root. Zod schemas, tool descriptions,
                      domain-error → forward-leading text (tools/errors.ts), the MCP
                      result mapping (tools/result.ts). index.ts is the only file that
                      constructs the concrete HTTP adapter.
```

`@devdigest/shared` is **never imported** here (rev 3 of the plan): the shared contracts are
Zod 3 source and fail to typecheck under this package's Zod 4 (`z.record` over an enum key
is exhaustive in Zod 4, so `.default({})` no longer typechecks). `src/domain/contracts.ts`
instead declares minimal local interfaces, each naming the shared contract it mirrors in a
comment — a rename or field removal on the server side is caught by the live smoke check
(§ Running against a live DevDigest), not by `tsc`.

## Tools

| Tool | Input | Output (concise) | Annotations |
|---|---|---|---|
| `list_agents` | — | `id, name, description, model, enabled` per agent | read-only |
| `run_agent_on_pr` | `repo, pr, agent` | `status, run_id, agent, verdict, score, total, findings[]` | not read-only, not destructive, not idempotent |
| `get_findings` | `repo, pr, agent?, run_id?, min_severity?, limit?, response_format?` | same shape as `run_agent_on_pr` | read-only |
| `get_conventions` | `repo, category?` | `repo, total, conventions: [{category, rule, evidence}]` | read-only |
| `get_blast_radius` | `repo, pr` | `repo, pr, summary, degraded, reason, limits, changed_symbols, downstream[{symbol, callers[{name,file,line,depth,via}], endpoints_affected, crons_affected}]` | read-only |

Addressing: `repo` is `owner/name` (case-insensitive), or a unique bare name; `pr` is the
GitHub PR number; `agent` is an id, or a name matched case-insensitively.

## Run lifecycle

`run_agent_on_pr`:

1. Resolves `repo` → `pr` → `agent` through the HTTP API (`GET /repos`,
   `GET /repos/:id/pulls`, `GET /agents`).
2. Refuses a disabled agent (`AgentDisabled`) **before** POSTing — the API itself does not
   check `enabled`.
3. `POST /pulls/:id/review` `{agentId}` triggers the run (fire-and-forget on the API side).
4. Polls `GET /pulls/:id/runs` every `POLL_MS` (3 s) for that `run_id`, up to `RUN_WAIT_MS`
   (100 s) counted from **handler start**, not from the POST — so a slow
   `GET /repos/:id/pulls` GitHub sync cannot silently eat the budget.
5. On `done`, reads `GET /pulls/:id/reviews` and picks the review by **exact `run_id` and
   `kind === 'review'`** (never "latest by agent" — concurrent runs would collide), then
   shapes it (severity sort, dismissed findings dropped first) and returns **concise**
   findings capped at the default limit (20, O7) — `run_agent_on_pr` takes no filter
   arguments; call `get_findings` for `min_severity`, a different `limit`, or
   `response_format: "detailed"`.
6. Past the deadline, returns `status: "running"` with the `run_id` and a hint to call
   `get_findings` later. `failed`/`cancelled` return their status and the run's `error`.

`get_findings` runs the same selection and shaping, but never triggers a run and never
sleeps — it picks the run by `run_id`, else the latest run of `agent`, else the latest run
on the PR, and reports whatever status it finds (including `running`).

## Config

| Var | Default | Notes |
|---|---|---|
| `DEVDIGEST_API_URL` | `http://localhost:3001` | Trailing `/` stripped. **This sandbox's `server/.env` sets `API_PORT=3003`** — export `DEVDIGEST_API_URL=http://localhost:3003` before starting Claude Code, or the "API unreachable" error will name the wrong port. |

`RUN_WAIT_MS` (100 000), `POLL_MS` (3 000), `REQUEST_TIMEOUT_MS` (30 000),
`RESPONSE_MAX_CHARS` (20 000) and `TEXT_FIELD_MAX` (500) are fixed constants in
`src/config.ts` — no env override (O3).

## Token budget (C4)

Server `instructions` ≤ 500 chars; every tool description ≤ 400; every argument description
≤ 120. The only enums are `min_severity`, `response_format` and `category`. No
`outputSchema`, no `alwaysLoad`.

Every response — success or error, from every tool — is capped at `RESPONSE_MAX_CHARS`
(20 000 chars). `src/domain/findings.ts`'s `fitToBudget` is data-only (it drops tail list
items and reports a count, never text); the cap and cut hint texts themselves — the ones
naming `limit`, `min_severity`, `category` and `get_findings` — are built in
`src/tools/budget.ts`, the only place in the package that owns hint wording. `guard` in
`src/tools/result.ts` is the last-resort net: a result whose serialized text still exceeds
the budget after every domain- and tool-level trim never leaves the server.

**Every** free-text field returned to the model is truncated to `TEXT_FIELD_MAX` (500 chars)
with `…`: finding `title`, `rationale`, `suggestion`, the `file` part of `location`;
convention `rule` and the path part of `evidence`; a run's `error`; agent `description`.
This text — finding and convention text especially — is untrusted data from the PR or the
repo, never instructions; the instructions and three tool descriptions say so explicitly, and
no fencing is applied (a user decision, see the plan's O4/R12).

Every value echoed into an error text — an `ApiFailure` detail, a URL, a repo/agent/run
query, a list of known repos or ambiguous matches — is clipped to `TEXT_FIELD_MAX` in
`src/tools/errors.ts` (rev 5); the `repo`/`agent` echoed into `run_agent_on_pr`'s "still
running" hint is clipped the same way in `src/tools/budget.ts`.

## Running

```bash
pnpm --dir mcp-server start          # stdio, tsx src/index.ts — no build step (O6)
pnpm --dir mcp-server test           # vitest, fully hermetic (AC13)
pnpm --dir mcp-server typecheck
pnpm --dir mcp-server lint
```

### With the MCP Inspector

```bash
npx @modelcontextprotocol/inspector pnpm --dir mcp-server start
```

or, for a scripted check:

```bash
npx @modelcontextprotocol/inspector --cli pnpm --dir mcp-server start --method tools/list
```

### Running against a live DevDigest

The server makes no API call at startup — only when a tool is called. Start the stack first
(`./scripts/dev.sh`), export `DEVDIGEST_API_URL` if the API port is not 3001 in this
sandbox, then register `.mcp.json` (repo root) with Claude Code and approve it once (`/mcp`).
