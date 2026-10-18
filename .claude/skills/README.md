# Skills

Reusable AI skills that provide specialized knowledge and workflows. Canonical location is `.claude/skills/` with a symlink at `.cursor/skills/ → ../.claude/skills` for Cursor compatibility. Shared with the team via version control.

## Catalog

| Skill | Scope | Description |
|-------|-------|-------------|
| [drizzle-orm-patterns](drizzle-orm-patterns/SKILL.md) | Backend | Drizzle schema, queries, relations, transactions, migrations |
| [postgresql-table-design](postgresql-table-design/SKILL.md) | Backend | Postgres schema design, data types, indexing, constraints |
| [next-best-practices](next-best-practices/SKILL.md) | Frontend | Next.js App Router, RSC boundaries, data fetching, optimization |
| [zod](zod/SKILL.md) | Full-stack | Zod schema validation, parsing, error handling, type inference |
| [typescript-expert](typescript-expert/SKILL.md) | Full-stack | Type-level programming, performance, tooling, migrations |
| [pr-self-review](pr-self-review/SKILL.md) | Process | Pre-PR gate — routes these skills onto the diff, blocks a PR with a critical finding |

### From plugins

These come with the `sdd-engineering` plugin and its dependencies (root `AGENTS.md`
*Plugins*), not from this folder. Name them with the plugin prefix. They load in Claude
Code only; Cursor sees the project skills above.

| Skill | Scope | Description |
|-------|-------|-------------|
| `engineering-paved-path:onion-architecture` | Backend | Ring rules — where a file goes, what it may import, how it is enforced; DevDigest's ring map is in root `AGENTS.md` *Backend rings* |
| `engineering-paved-path:fastify-best-practices` | Backend | Fastify routes, plugins, JSON-schema validation, error handling |
| `engineering-paved-path:frontend-ui-architecture` | Frontend | Where components, hooks, constants and logic live; server/client boundary |
| `engineering-paved-path:react-best-practices` | Frontend | React anti-patterns, state management, hooks rules |
| `engineering-paved-path:react-testing-library` | Frontend | React Testing Library with Vitest |
| `engineering-paved-path:nextjs-app-router` | Frontend | Next.js App Router conventions |
| `engineering-paved-path:security` | Full-stack | OWASP Top 10:2025, auth, injection, uploads, secrets |
| `sdd-engineering:mermaid-diagram` | Shared | Mermaid diagrams in markdown (flowcharts, sequence, ERD, …) |
| `sdd-engineering:spec-writing` | Process | Writing and reviewing feature specs — EARS + verify + traceability, final self-check |
| `sdd-engineering:run-plan` | Process | `/sdd-engineering:run-plan <spec-or-plan>` — runs an approved plan through lanes, the checks gate, the review round and fix rounds, then `/pr-self-review`; ends with `summary.md` and asks before committing |
| `sdd-engineering:workflow-retro` | Process | `/sdd-engineering:workflow-retro` — the run's retro and ledger row |

## What Are Skills?

Skills are modular packages that extend the AI agent with specialized knowledge and workflows. Unlike rules (always applied) or agents (invoked for specific tasks), skills are loaded on-demand when the agent determines they're relevant.

### Skills vs Rules vs Commands vs Agents

| Type | Scope | Loaded | Purpose |
|------|-------|--------|---------|
| **Rules** (`.mdc`) | Project conventions | Always or by file pattern | Persistent guardrails |
| **Commands** (`.md`) | User actions | On `/command` invocation | Slash commands |
| **Skills** (`.md`) | Domain knowledge | On-demand by agent | Specialized knowledge |
| **Agents** (`.md`) | Workflows | Via Task tool | Subagent orchestration |

## Creating New Skills

Each skill has:

- `SKILL.md` — Main skill file with rules and conventions (required)
- `examples.md` — Code examples showing good/bad patterns (recommended)
- `references.md` — Sources and rationale (optional)
