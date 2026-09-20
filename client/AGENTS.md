# `@devdigest/web` — Next.js 15 studio, `:3000`

## Read when

- UI route map, which route calls which endpoint → `./README.md`
- Implementing a feature → `./.spec/<feature>.spec.md` (write the spec first if missing)
- Starting any work here → `./INSIGHTS.md` first; at the end of the task run
  `engineering-insights` to append what is worth keeping (append-only)
- "Why is it built this way" → `./.doc/<topic>.md`
- Touching tests or CI → `../TESTING.md`

## Commands

`pnpm dev` (`:3000`) · `pnpm build` · `pnpm test` (vitest + jsdom, `fetch` mocked —
no API needed) · `pnpm typecheck` · `pnpm lint`

## Conventions

- Every call to the API goes through `src/lib/api.ts`; every component reads data
  through a hook in `src/lib/hooks/*`. No `fetch` inside a component.
- API base is `NEXT_PUBLIC_API_BASE` (default `http://localhost:3001`). Never
  hardcode the host.
- Server Components by default; add `'use client'` only where you need state,
  effects or TanStack Query.
- User-facing strings live in `messages/<locale>/*.json` (`next-intl`). No literal
  copy in components.
- Response shapes come from the Zod contracts in `src/vendor/shared`. Do not
  declare a local type that duplicates one.
- UI primitives come from `src/vendor/ui` (`@devdigest/ui`) before anything new.

## Do not touch

- `src/vendor/**` — mirrors of `@devdigest/shared` and `@devdigest/ui`. Edit the
  source in `server/src/vendor/shared`.
- `.next/` — build output.
