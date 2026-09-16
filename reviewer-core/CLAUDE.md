# `@devdigest/reviewer-core` — the review engine

Pure logic: **diff → prompt → LLM → grounded findings**. No DB, no GitHub, no
filesystem. The only side effect is an LLM call through an injected `LLMProvider`.

## Read when

- Pipeline stages and the grounding gate → `./README.md`
- Implementing a feature → `./.spec/<feature>.spec.md` (write the spec first if missing)
- Starting any work here → `./INSIGHTS.md` first; at the end of the task run
  `engineering-insights` to append what is worth keeping (append-only)
- "Why is it built this way" → `./.doc/<topic>.md`

## Commands

`pnpm test` (vitest) · `pnpm typecheck`. `build` is a type-check — the package
never emits JS; consumers import the TypeScript source through a path alias.

## Conventions

- Keep the package pure. A new dependency on the DB, GitHub, the filesystem or
  `process.env` belongs in the server, behind an adapter.
- Anything from outside the system (diff, PR body, repo map) is fenced with
  `wrapUntrusted()` + `INJECTION_GUARD` before it reaches the prompt.
- LLM output is parsed through `llm/structured.ts` (Zod → JSON Schema,
  parse-with-repair). Never trust raw text.
- `groundFindings()` is mandatory and mechanical: a finding without a real diff
  line citation is dropped, and the score is recomputed from the survivors.
- Optional prompt slots (`skills`, `memory`, `specs`, `callers`) are omitted
  silently when absent — `assemblePrompt` must stay safe with any slot empty.
- Every test runs without network: inject a fake `LLMProvider`.

## Do not touch

`src/index.ts` is the public surface consumed by the server — changing an export
is a breaking change for `@devdigest/api`.
