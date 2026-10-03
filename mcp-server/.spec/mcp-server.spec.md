# DevDigest MCP server — `mcp-server`

## Goal

A local stdio MCP server lets Claude Code (and any MCP client) list DevDigest reviewers,
run one on a pull request and get its verdict and findings back, re-read the findings of a
finished run and read the repo's accepted conventions — built only on the existing HTTP
API, and costing almost nothing in context when a new chat starts.

## Background

The README roadmap names this `devdigest-mcp` (L04). Nothing MCP-related exists on `main`.
`upstream/lesson-4-lab/mcp-finish` carries a reference implementation (`a3ea46d`,
`mcp-server/`) worth reading for its pitfalls, not for copying: it predates MCP spec
2026-07-28 and SDK v2.

Facts this spec relies on:

- Every endpoint needed is on the HTTP API, unauthenticated, bare JSON (no envelope).
  The API port is **not** always 3001 — `server/.env` may set `API_PORT`.
- `GET /repos` → `Repo[]` (`full_name` = `owner/name`).
- `GET /repos/:id/pulls` → `PrMeta[]`. It syncs from GitHub when a token is configured and
  falls back to persisted PRs; `PrMeta.id` (the internal uuid) is **nullish**.
- `POST /pulls/:id/review` takes the PR **uuid** and `RunRequest` `{agentId}`, is async,
  returns `ReviewRunResponse` `{pr_id, runs:[{run_id, agent_id, agent_name}]}` and is
  rate-limited to 10/min.
- `GET /pulls/:id/runs` → `RunSummary[]` (`status`: running | done | failed | cancelled,
  `error`, `agent_id`, `ran_at`).
- `GET /pulls/:id/reviews` → `ReviewRecord[]` (`run_id`, `kind`, `verdict`, `score`,
  `findings[]`).
- `run-executor.ts` inserts the review and its findings **before** flipping
  `agent_runs.status` to `done`, so a `done` run already has its findings.
- `GET /repos/:id/conventions` → `ConventionCandidate[]` of every status; only `accepted`
  ones are conventions.

## Tool design principles

Every tool follows four rules:

1. **Result, not operation.** A tool does the whole job. `run_agent_on_pr` creates the run,
   waits for it and returns its findings — the model never orchestrates three calls.
2. **Flat arguments.** Only scalars: `repo`, `pr`, `agent`, … — no nested objects, which
   models (non-Anthropic ones especially) get wrong more often.
3. **Concise, structured answers.** `{verdict, findings[]}` with only the fields the model
   needs, never a raw API dump — one full response can cost tens of thousands of tokens.
4. **An error leads forward.** Not a bare "404" but the next step: "agent not found — call
   `list_agents`", so the agent does not get stuck.

## Design

### Package

`mcp-server/` — a standalone package (own `package.json`, `pnpm-lock.yaml`, `AGENTS.md`,
`CLAUDE.md` shell, `INSIGHTS.md`), per the root `AGENTS.md`. A thin client of the existing
HTTP API: no DB access, no DI container, **no change to `server/`**. Layered by the
`onion-architecture` rule (dependencies point inward): `domain/` (contracts, the
`DevDigestApi` port, domain errors, pure findings rules) ← `app/` (use cases) ←
`adapters/` (HTTP) ← `tools/` + `index.ts` (MCP edge, composition root).

- SDK: `@modelcontextprotocol/server` **v2** + `zod` **4** (v2 fails silently at runtime
  with Zod 3). Zod 4 lives only in this package.
- `@devdigest/shared` is reachable through a tsconfig path alias and imported with
  `import type` only — no Zod 3 contract is executed here.
- Transport: stdio. Nothing but MCP frames on stdout; all logging goes to stderr.
- Config: `DEVDIGEST_API_URL` (default `http://localhost:3001`).
- Registration: a project-scoped `.mcp.json` at the repo root, server name `devdigest`,
  so tools surface as `mcp__devdigest__<tool>`.

### Addressing

- `repo` — `owner/name`, matched case-insensitively against `Repo.full_name`; a bare
  `name` is accepted when it is unique.
- `pr` — the GitHub PR number, matched against `PrMeta.number`; a match without an `id`
  is treated as not imported.
- `agent` — an agent id, or its name matched case-insensitively.

### Tools

Names are bare snake_case — the client already namespaces them.

| Tool | Input | Output (concise) | Annotations |
|---|---|---|---|
| `list_agents` | — | `id, name, description, model, enabled` per agent | read-only |
| `run_agent_on_pr` | `repo, pr, agent` | `status, run_id, agent, verdict, score, total, findings[]` | not read-only, not destructive, not idempotent |
| `get_findings` | `repo, pr, agent?, run_id?, min_severity?, limit?, response_format?` | same shape as `run_agent_on_pr` | read-only |
| `get_conventions` | `repo, category?` | accepted conventions: `category, rule, evidence` (`path:line`) | read-only |
| `get_blast_radius` | `repo, pr` | superseded by `docs/plans/blast-radius.plan.md` (AC11) | read-only |

Read-only tools also carry `openWorldHint: false`.

**`run_agent_on_pr`** triggers `POST /pulls/:id/review` with `{agentId}`, then polls
`GET /pulls/:id/runs` every 3 s for that `run_id`. On a terminal status it reads the
matching review from `GET /pulls/:id/reviews` and returns it. It waits at most
`RUN_WAIT_MS` (default 100 s — under Claude Code's 2-minute auto-background threshold);
past that it returns `status: "running"` with the `run_id` and says to call `get_findings`
with the same `repo`/`pr`/`agent` later.

**`get_findings`** picks the run: `run_id` if given; else the latest run of `agent` if
given; else the latest run on the PR. It never waits — a `running` run is reported as
such.

**Findings shape.** Dismissed findings (`dismissed_at` set) are hidden. `concise` (default): `id, severity, file:line, title`. `detailed` adds
`rationale, suggestion, category, confidence`. Sorted CRITICAL → WARNING → SUGGESTION,
filtered by `min_severity`, capped by `limit` (default 20, max 50); `total` counts the
filtered set, so the model knows when it saw only part of it.

### Token budget

With Claude Code's default tool search, only tool **names** and the server
**instructions** load at session start; descriptions and schemas load on demand via
ToolSearch. So:

- `instructions` ≤ 500 chars: what DevDigest is, when to reach for it, and the keywords a
  user would say (pull request, PR review, findings, conventions, reviewer agents).
- Each tool description ≤ 400 chars, most important fact first; argument descriptions
  ≤ 120 chars. The only enums are `min_severity`, `response_format` and `category`.
- No `alwaysLoad`. No `outputSchema` — structured results are returned as
  `structuredContent` plus the same JSON as a text block.
- Every response stays well under Claude Code's 10k-token warning.

## Acceptance criteria

1. `pnpm --dir mcp-server start` speaks MCP over stdio; with stdin at EOF it exits 0 and has
   written **0 bytes** to stdout.
2. `tools/list` returns exactly the five tools above, in a fixed order, with the listed
   annotations; every input schema is flat (no object- or array-typed property).
3. A test asserts the budget: `instructions` ≤ 500 chars, every tool description ≤ 400,
   every argument description ≤ 120.
4. `list_agents` returns every agent of the workspace, enabled or not, in the concise shape.
5. `run_agent_on_pr` on a run that finishes within `RUN_WAIT_MS` returns in one call
   `status: "done"`, the verdict, score and findings of that run.
6. `run_agent_on_pr` on a run still going after `RUN_WAIT_MS` returns `status: "running"`,
   the `run_id` and a hint naming `get_findings`; a `failed`/`cancelled` run returns the
   status and the run's `error`.
7. `run_agent_on_pr` on a disabled agent refuses and says to enable it in DevDigest.
8. Errors lead forward, as `isError: true` results:
   - unknown repo → lists the known repos;
   - unknown PR or PR without an `id` → says to open/import the PR in DevDigest;
   - unknown agent → says to call `list_agents`;
   - no run on the PR → says to call `run_agent_on_pr`;
   - API 429 → says to retry in a minute;
   - API unreachable → names the URL tried and says to start DevDigest (`./scripts/dev.sh`).
9. `get_findings` selects the run by `run_id`, else the latest run of `agent`, else the
   latest run on the PR, and returns the same shape as `run_agent_on_pr`.
10. Findings dismissed in DevDigest (`dismissed_at` set) are never returned. The rest are
    sorted by severity, filtered by `min_severity` and capped by `limit`; `total` counts
    the visible, filtered set.
11. `get_conventions` returns only `status = accepted` conventions, filtered by `category`
    when given; an empty list says the repo has no accepted conventions yet and that a
    scan runs from the DevDigest UI.
12. `get_blast_radius` — superseded by `docs/plans/blast-radius.plan.md` (AC11): it is a
    real tool now, not a stub.
13. The `mcp-server` tests are hermetic: the HTTP API is faked, the MCP server is driven
    through an in-memory client — no network, no Docker.
14. `.mcp.json` registers the server; `/mcp` in Claude Code shows `devdigest` connected, and
    `/context` shows its startup cost (record the number in `mcp-server/INSIGHTS.md`).
15. `git diff --stat main -- server client reviewer-core e2e` is empty.

## Contracts touched

- Existing routes read: `GET /repos`, `GET /repos/:id/pulls`, `GET /agents`,
  `POST /pulls/:id/review`, `GET /pulls/:id/runs`, `GET /pulls/:id/reviews`,
  `GET /repos/:id/conventions`.
- Types reused (`import type`): `Repo`, `PrMeta`, `Agent`, `RunRequest`,
  `ReviewRunResponse`, `RunSummary`, `ReviewRecord`, `FindingRecord`, `ConventionCandidate`.
- No route, contract or table changes.

## Out of scope

- Any change to `server/`, `client/`, `reviewer-core/`, `e2e/`.
- Running several agents in one call.
- The real blast radius (next lesson; it will need `RepoIntelService.getBlastRadius`).
- Streamable HTTP transport, auth, remote hosting.
- The MCP Tasks extension and progress notifications — Claude Code support is unverified.
- MCP resources and prompts.
- Importing a PR, triggering a conventions scan or cancelling a run from MCP.

## Open questions

- `GET /repos/:id/pulls` syncs from GitHub on every call when a token is set — slow for a
  lookup. Accepted while the backend is off-limits; a DB-only by-number route is the fix
  later.
- `import type` from Zod-3 contracts under a Zod-4 resolution: if `z.infer` breaks at type
  level, fall back to local response types in `mcp-server/src/types.ts`.
- Whether Claude Code shows the model `structuredContent` or only the text block —
  returning both covers either case.
- `RUN_WAIT_MS` = 100 s is a guess; revisit after timing real runs.
