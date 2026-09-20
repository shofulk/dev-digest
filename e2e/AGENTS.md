# `@devdigest/e2e` — deterministic browser suite

Vercel **agent-browser** (Rust + CDP CLI). No Playwright, no LLM, no API key.

## Read when

- How a flow runs, available commands, the shared session → `./README.md`
- Adding or changing a flow → `./.spec/<feature>.spec.md` if one exists
- Starting any work here → `./INSIGHTS.md` first (flaky flows especially); at the end of
  the task run `engineering-insights` to append what is worth keeping (append-only)
- "Why is it built this way" → `./.doc/<topic>.md`
- Full test strategy → `../TESTING.md`

## Commands

`pnpm test` (`tsx run.ts`, against an already-running stack) ·
`pnpm e2e:hermetic` (`../scripts/e2e.sh` — boots its own stack) · `pnpm typecheck` ·
`pnpm lint`

## Conventions

- A flow is `specs/NN-name.flow.json`: a name plus an ordered `steps` list, run in
  one shared browser session by `run.ts`. Numbering is the run order.
- `wait --text` / `wait --url` **are** the assertions — a non-zero exit fails the
  step. Do not add assertion logic to `run.ts`.
- `{BASE}` is substituted from `E2E_BASE_URL` (default `http://localhost:3000`).
  Never hardcode a URL in a spec.
- Every `cmd` is passed verbatim to `agent-browser`; keep specs declarative JSON,
  with helpers in `lib/`.
- Flows must be deterministic: they run against seeded data and must never depend
  on an LLM call or on network beyond the local stack.

## Do not touch

Seeded fixtures the flows assert on (e.g. PR `#482`) come from
`server/src/db/seed.ts` — changing the seed breaks these specs.
