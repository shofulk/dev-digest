---
name: engineering-insights
description: Records non-obvious engineering findings in the INSIGHTS.md of the package the work touched, and reads that file before the work starts. Use at the start of any session or task that touches server/, client/, reviewer-core/ or e2e/, whenever a non-obvious cause, workaround, convention or dead end surfaces, and again when a task wraps up.
---

# Engineering insights

Durable session knowledge in this repo lives in per-package `INSIGHTS.md` files. Read the
right one before the work, append to it after. Never overwrite what is already there.

## Which file

| The work touched | File |
|---|---|
| `server/**` (including `src/modules/repo-intel/`) | `server/INSIGHTS.md` |
| `client/**` | `client/INSIGHTS.md` |
| `reviewer-core/**` | `reviewer-core/INSIGHTS.md` |
| `e2e/**` | `e2e/INSIGHTS.md` |
| `scripts/`, `docs/`, `docker-compose.yml`, repo root, or two or more packages at once | `INSIGHTS.md` (repo root) |

One finding belongs in one file. If it genuinely applies to two packages, write it in the
root file rather than duplicating it.

## Step 1 - Before the work (mandatory)

1. Decide which package the task touches, from the table above.
2. Read that `INSIGHTS.md` in full.
3. Read the skill that matches the topic, if one exists in `.claude/skills/` - for example
   `drizzle-orm-patterns` for schema work, `next-best-practices` for `client/`,
   `fastify-best-practices` for routes and plugins.
4. State in one line the three entries most relevant to the task at hand, so it is visible
   that the file was actually processed. If the file has no entries yet, say so.

Skipping this step is the failure mode that makes the whole loop worthless: an insight that
is never read is an insight that was never written.

## Step 2 - Capture as you go

The moment something non-obvious is *confirmed* - the fix works, an assumption is
disproved, a dead end is reached - note it as a draft in the reply. Do not write to the
file mid-task: findings mid-task are often still wrong.

## Step 3 - Wrap-up

At the end of the task or session, for each draft candidate:

1. Run it through the worth-writing test below.
2. Re-read the target `INSIGHTS.md` and `grep -i '<key term>'` it. If the finding is
   already there, do not write it again - say it is already covered.
3. Append only what survived both checks, following **Never overwrite**.

**If nothing substantial surfaced, write nothing.** An empty wrap-up is a valid outcome;
noise costs more than silence.

## Worth-writing test

All four must hold:

1. It cost time to discover, and the code does not say it out loud.
2. It will recur - the next session in this package would trip on it.
3. The entry is actionable cold: an agent reads it and knows what to do or avoid, without
   re-investigating.
4. It is not architecture (`README.md`), not design rationale (`.doc/`), not a feature
   contract (`.spec/`), not something a linter or type-checker already catches, and not
   already in `INSIGHTS.md`.

## Vague vs useful

| Noise | Insight |
|---|---|
| "Be careful with migrations." | "`relation "..." does not exist` on boot means `pnpm --dir server db:migrate` was skipped - the server never migrates on boot." |
| "SSE can be flaky." | "Register the SSE plugin before `modules/index.ts`; registering it after yields a silent 404 on the stream route with nothing in the logs." |
| "Watch out for async in tests." | "`*.it.test.ts` spins up a testcontainers Postgres; every other test must run with no Docker and no network, so DB-backed cases need that suffix or they hang in CI." |

If it would be obvious to anyone reading the code, do not write it.

## Never overwrite

`INSIGHTS.md` is append-only. Mechanically:

- Write with `Edit` only. `old_string` is the target section's marker line alone - for
  example `<!-- newest first: what-doesnt-work -->` - and `new_string` is that same marker
  followed by the new entry. No existing entry line ever appears in `old_string`.
- Never use `Write` on an `INSIGHTS.md` that exists; that replaces the whole file. `Write`
  is allowed only to create a package's `INSIGHTS.md` for the first time.
- `Read` the file before editing (Step 1 already requires it).
- One finding, one `Edit`. Several findings mean several separate edits.
- Nothing is ever edited away. A finding that turns out to be wrong or outdated is retired
  by a **new** dated entry carrying `**Supersedes:** YYYY-MM-DD entry - <what changed>`.
- Deleting, merging or rewriting entries is a separate task on an explicit request from the
  user, never a side effect of feature work.
- After writing, verify that only lines were added. For a tracked file:
  `git diff --numstat -- <file>` must report zero deletions; if it does not,
  `git checkout -- <file>` and redo the append. For a file git does not track yet,
  `git diff` proves nothing - compare `wc -l` before and after instead, and confirm every
  pre-existing entry heading is still present with `grep -c '^### '`.

## Entry rules

- Newest entry on top of its section, directly under the marker.
- Every entry starts `### YYYY-MM-DD - <symptom or claim, as it first looked>`.
- Every entry ends with `**Evidence:** path/to/file.ts:42` - a real path, not a guess.
- In `Recurring Errors & Fixes`, `**Cause:**` / `**Signal:**` / `**Fix:**` are required.
  Elsewhere, one to three lines plus evidence is enough.

## Hygiene

Around 200 entries, or a visible drop in signal, is the cue to prune or split by domain.
Raise it with the user; do not prune silently.
