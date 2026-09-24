# Report template

Written to `${STATE%.json}.md` by step 8. Keep the order; drop a section only when it is
empty, except **Verdict**, **Change set** and **Limits**, which always appear.

````markdown
# PR self-review — <branch>

**Verdict: BLOCKED — 2 critical, 4 major, 6 minor**
<!-- or: PASS — 0 critical, 3 major · or: INCONCLUSIVE — 1 check could not run -->

Base `origin/main` @ `<base sha>` · HEAD `<sha>` · <N> files, +<A> / −<D> · <iso timestamp>

## Since the last run

new 2 · resolved 3 · unchanged 4
<!-- omit on a first run -->

## Critical — these block the PR

### 1. `server/src/modules/reviews/service.ts:42` — layer-violation
> `import { db } from '../../db'`

A ring-1 service imports the database directly. *(onion-architecture)*

**Fails when:** any call to `runReview` — the service cannot be unit-tested without a live
Postgres, and swapping the repository becomes a rewrite.
**Fix:** take the repository port through the constructor; resolve it in `container.ts`.
**Verified:** CONFIRMED by re-check against the whole file.

## Major — answer before merging

- `client/src/app/repos/page.tsx:88` — **data-fetching**: `useEffect` fetch races the route
  change; use the TanStack query already defined in `lib/hooks`. *(react-best-practices)*

## Minor — <N> shown, <M> more cut

- …

## Context — not in this diff, not gated

- …

## What ran

| Bucket | Files | Skills loaded | Findings (kept/dropped) |
|---|---|---|---|
| backend-arch | 7 | onion-architecture | 3 / 2 |

Deterministic checks: typecheck ✅ · lint ⚠️ 2 · test ✅ · arch ❌ 1 error

## Limits

Not reviewed: `server/pnpm-lock.yaml` (generated), `…` (>1500 lines).
Skipped: server-integration (Docker down).
Suppressed: 1 (`no-direct-sdk` in `adapters/git`, "wrapper is the adapter", 2026-08-02).

This gate blocks `gh pr create|merge|ready` from Claude Code, and `git push` when
`.git/hooks/pre-push` is installed. It does **not** cover the GitHub web UI, another machine,
or `--no-verify`. The binding gate would be CI, which does not exist yet.
````

## Rules for writing it

- **A finding is `file:line` + the quoted line + one claim + one failing scenario + one fix.**
  Anything longer is an essay; anything shorter is not actionable.
- Name the skill that produced each finding. It is how a wrong rule gets traced and fixed.
- Never print a secret value, a token, or anything out of `~/.devdigest/secrets.json` —
  `file:line` and the pattern name only.
- `INCONCLUSIVE` reports what could not run and how to make it runnable. It never dresses a
  missing dependency up as a defect in the code.
- The chat summary is three lines: verdict, the criticals in one clause each, the report path.

## `<STATE>.pr.md` — the draft PR body (written on `pass`)

```markdown
<type>(<scope>): <title>

## What
## Why
## How it was verified
<checks that ran, suites, what was left out and why>

## Self-review
Skills: <list>. Accepted majors: <n> — <one line each>.
<overrides and suppressions, quoted, if any>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```
