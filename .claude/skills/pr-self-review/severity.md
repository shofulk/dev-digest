# Severity — what blocks a PR and what does not

Three levels. Only **critical** gates. Read by `pr-self-review` steps 3, 6 and 7.

---

## §1 Deterministic pre-pass — fixed severities

No judgement here: the check either failed or it did not. Run only what the change set
touches. `<pkg>` is any of `server`, `client`, `reviewer-core`, `e2e`.

| # | Check | How | Severity on failure |
|---|---|---|---|
| 1 | Types | `pnpm --dir <pkg> typecheck` | **critical** |
| 2 | Lint | `pnpm --dir <pkg> lint` | **major** (**critical** if eslint cannot start) |
| 3 | Tests | `pnpm --dir <pkg> test` | **critical** |
| 4 | Backend rings | `pnpm --dir server arch` | **critical** on an `error` rule, **major** on `warn` |
| 5 | Migrations | `server/src/db/migrations/**` changed without a matching `server/src/db/schema/**` change | **critical** — migrations are generated; change the schema and run `db:generate`. Key on `schema/**`, never on `schema.ts`: that file is only the barrel that re-exports the domain files |
| 6 | Vendor mirrors | any `*/src/vendor/**` changed outside `server/src/vendor/shared/**` | **critical** |
| 7 | Mirror drift | `server/src/vendor/shared/**` changed but `client/src/vendor/shared/**` (and any other mirror) not updated to match | **critical** |
| 8 | Lockfiles | a `pnpm-lock.yaml` changed with no `package.json` change in the same package, or a lockfile appearing at the repo root | **critical** |
| 9 | CLAUDE.md shells | a `CLAUDE.md` that deviates from the sanctioned shell — an H1 title, the pointer paragraph saying the canonical file is `AGENTS.md`, and the `@AGENTS.md` import, and nothing else — or a deleted shell | **critical**. The five shells in the repo **are** the sanctioned shape; flagging them is the false positive this row exists to avoid |
| 10 | Secrets | `sk-`, `ghp_`, `gho_`, `github_pat_`, `-----BEGIN * PRIVATE KEY-----`, an assigned `.env` value, or any write of a secret to the DB or to git | **critical** — report `file:line` + pattern name, **never the value** |
| 11 | Grounding gate | a finding kept without citing a real diff line, or a score taken from the model instead of recomputed from survivors, anywhere in `reviewer-core/` or the findings path | **critical** |
| 12 | New tables | a `pgTable(` added under `server/src/db/schema/**` | **major**; **critical** if it duplicates an existing table — the schema already contains every table, fill one |
| 13 | Module registration | a new `server/src/modules/<name>/` not registered in `modules/index.ts` | **major** |
| 14 | Direct SDK use | an SDK imported outside `server/src/adapters/**` (octokit, openai, `@anthropic-ai/sdk`, simple-git, `@ast-grep/napi`) | **critical** — everything external goes through an adapter from the DI container |
| 15 | Spec contradiction | a touched feature's `<pkg>/.spec/<feature>.spec.md` says otherwise | **critical** |
| 16 | skills-lock | `skills-lock.json` hand-edited, or a first-party skill added to it | **major** |
| 17 | Stale base | branch >20 commits or >7 days behind the base | **major** |
| 18 | Routing drift | a skill named in `routing.md` does not resolve | **major** |

A check that **cannot run** — deps not installed, eslint missing, `gh` unauthed — is not a
failure of the code. Record it as `inconclusive` with the one-line remedy. The exception is
Docker being down: `*.it.test.ts` self-skip, which is recorded as `skipped` and still allows
`pass`.

---

## §2 Judged findings

**critical — blocks.** *Would merging this need a revert or a hotfix?*

- a documented "Do not touch" rule broken (§1 catches most, not all);
- a security hole reachable from external input: injection, missing authz on a route,
  unvalidated input parsed as trusted, a path traversal, a secret leaving the machine;
- data loss or a destructive/irreversible migration;
- a layer violation the ring rules mark as an error — inner ring naming an outer one;
- the grounding gate weakened, in code or in prompt;
- a broken build, a broken boot path, or a test made to pass by weakening its assertion.

**major — must be answered, does not block.**

- a real defect with a bounded blast radius;
- a convention violation from a routed skill (hook rules, RSC boundary, Drizzle/Zod misuse);
- a new seam with no test in the suite that owns it, or a changed seam with a stale test;
- scope asked for and not delivered, or delivered and never asked for;
- debug residue: `console.log`, `.only(`, commented-out blocks, TODO without a ticket.

**minor — reported, never gated, capped at 10.** Naming, style, phrasing, a nit a reviewer
would mention but not hold a PR for.

---

## §3 Rules that keep the gate usable

1. **Grounded or dropped.** Every finding cites a line in the change set, and the quoted line
   matches the file at that number. Untouched code produces at most one `context` note.
2. **Verify before gating.** A candidate critical goes to a fresh sub-agent with the whole
   file: `CONFIRMED` (with a concrete failing scenario) gates, `PLAUSIBLE` is demoted to
   major with the doubt stated.
3. **Suppressions are demotions, not silence.** A `.pr-review/suppress.json` entry demotes to
   minor and quotes its reason; the finding still appears. No wildcard paths; over 90 days
   old, the suppression is itself a **major**.
4. **One critical, one fix.** A critical the report cannot state a fix for is under-specified
   — say what is unknown rather than blocking on a vague claim.
5. **Escalate by evidence, not by feeling.** "This looks risky" is a major at best. Critical
   needs the failing scenario written out.
