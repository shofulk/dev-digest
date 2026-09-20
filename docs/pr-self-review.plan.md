# Plan — `pr-self-review` skill

A first-party skill that reviews **local, unmerged changes** before a PR is opened,
routes the repo's existing skills onto the files each one actually governs, and
**blocks** PR creation / merge when a `critical` finding survives verification.

Status: **approved 2026-09-20 — every item in §12 and §13 accepted.** Implemented in
`.claude/skills/pr-self-review/`; this file stays as the rationale behind that skill.
Items marked **later** are not built yet and are listed in §14.

---

## 1. What it is, mechanically

| Piece | Path | Purpose |
|---|---|---|
| Skill | `.claude/skills/pr-self-review/SKILL.md` | The procedure. Invokable as `/pr-self-review`. |
| Routing table | `.claude/skills/pr-self-review/routing.md` | glob → skills + deterministic checks |
| Severity rubric | `.claude/skills/pr-self-review/severity.md` | what is `critical` vs `major` vs `minor` |
| Report template | `.claude/skills/pr-self-review/report-template.md` | shape of the written verdict |
| Gate hook | `.claude/hooks/pr-gate.sh` + `.claude/settings.json` | PreToolUse block on `gh pr create` / `gh pr merge` |
| Gate state | `.pr-review/<branch>.json` (gitignored) | verdict + HEAD sha the verdict was computed on |

First-party skill ⇒ **not** added to `skills-lock.json` (root `AGENTS.md`, "Do not touch").
`.claude/skills/README.md` gets one catalog row; nothing goes into any `CLAUDE.md`.

---

## 2. Trigger paths

1. **Manual** — `/pr-self-review` (optionally `/pr-self-review --base origin/main`).
2. **Before opening a PR** — Claude Code has no "PR event"; the real chokepoint is the
   shell call. A `PreToolUse` hook on `Bash` matches
   `gh pr create` / `gh pr merge` / `gh pr ready` and:
   - no `.pr-review/<branch>.json`, or its `head` ≠ current `HEAD`, or `verdict != "pass"`
     → **exit 2** with a message telling the agent to run `/pr-self-review` first;
   - fresh pass → exit 0, the command proceeds.
   This is what makes the block real rather than advisory: the state file is written **only**
   by a run that ended with zero surviving criticals, and it is invalidated by any new commit.
3. **Optional, later** — the same rubric as a CI job on the PR (`.github/workflows/`), so the
   gate survives someone pushing from outside Claude Code. Out of scope for v1; noted as a
   follow-up.

---

## 3. What "all open changes" means

Default change set, in this order:

```
BASE=$(git merge-base HEAD origin/main)   # origin/main is the default; --base overrides
git diff --stat $BASE                      # committed on the branch
git diff HEAD                              # unstaged
git diff --cached                          # staged
git ls-files --others --exclude-standard   # untracked (new files count)
```

Union of all four → the **file list**; per-file unified diff (`-U15`) → the **review input**.
Untracked files are included in full — a brand-new `routes.ts` is exactly where a layer
violation hides, and it would be invisible to `git diff` alone.

Hard caps to keep the run finite: skip files > 1500 changed lines with an explicit
`review-skipped` note in the report, and skip generated paths (`pnpm-lock.yaml`,
`server/src/db/migrations/**`, `*/dist/**`) from *content* review — they are still checked by
the tripwires in §5.

---

## 4. Routing — skills onto the diff

The heart of the request. A table in `routing.md`; the skill reads it, intersects the globs
with the file list, and only spawns the buckets that actually matched.

| Bucket | Matches | Skills loaded | Deterministic checks |
|---|---|---|---|
| **frontend** | `client/**` | `frontend-ui-architecture`, `react-best-practices`, `next-best-practices`, `vercel-react-best-practices` | `pnpm --dir client typecheck`, `lint`, `test` |
| **frontend-tests** | `client/**/*.test.tsx?` | `react-testing-library` | — |
| **backend-arch** | `server/src/**` | `onion-architecture` | `pnpm --dir server arch` (dependency-cruiser) |
| **backend-http** | `server/src/modules/*/routes.ts`, `server/src/plugins/**`, `server/src/app.ts` | `fastify-best-practices` | — |
| **backend-data** | `server/src/db/**`, `server/src/modules/*/repository*` | `drizzle-orm-patterns`, `postgresql-table-design` | `pnpm --dir server typecheck` |
| **contracts** | `server/src/vendor/shared/**`, any `*.schema.ts` | `zod` | vendor-mirror diff (§5) |
| **engine** | `reviewer-core/**` | `typescript-expert` | `pnpm --dir reviewer-core test` |
| **e2e** | `e2e/**` | read `e2e/AGENTS.md`, `TESTING.md` | — |
| **security** | routes, adapters, `platform/config.ts`, `secrets`, auth/input/upload paths anywhere | `security` | secret-scan tripwire |
| **types** | any `.ts`/`.tsx` | `typescript-expert` | per-package `typecheck` |
| **repo-hygiene** | always | root + touched `<pkg>/AGENTS.md` | tripwires (§5) |

Rules that keep the routing honest:

- **Every matched bucket must load its skills before judging.** A bucket that reports a
  finding without having read its skill is a bug in the run; the report records which skills
  each bucket loaded, so this is visible.
- A file may land in several buckets (a `routes.ts` hits backend-arch, backend-http, security,
  types). That is intended — different lenses, deduped at merge.
- **No match ⇒ no bucket.** A docs-only diff runs repo-hygiene and nothing else, and finishes
  in seconds. Cost scales with what actually changed.
- Before any bucket runs, the skill reads the touched packages' `INSIGHTS.md`
  (via `engineering-insights`) and passes the relevant entries into the bucket prompts —
  otherwise the reviewer re-discovers known traps and reports them as findings.

---

## 5. Deterministic pre-pass (runs first, cheap, catches most)

Sequenced before any LLM review; each failure is a finding with a fixed severity, so there is
nothing to argue about:

| Check | Severity on failure |
|---|---|
| `typecheck` for each touched package | **critical** |
| `lint` (`pnpm --dir <pkg> lint`, eslint) for each touched package | **major**, **critical** if it fails to run at all |
| `test` for each touched package (`*.it.test.ts` skipped when Docker is down — recorded, not silent) | **critical** |
| `pnpm --dir server arch` — dependency-cruiser `error` rules | **critical** (`warn` rules → major) |
| `server/src/db/migrations/**` edited by hand (no matching `schema.ts` change + `db:generate`) | **critical** |
| `*/src/vendor/**` edited outside `server/src/vendor/shared` | **critical** |
| vendor mirrors drifted from `server/src/vendor/shared` after a contracts change | **critical** |
| `pnpm-lock.yaml` changed with no `package.json` change (hand edit / hoist), or a root lockfile appearing | **critical** |
| any `CLAUDE.md` containing more than the `@AGENTS.md` shell, or a deleted shell | **critical** |
| secret-shaped string in the diff (`sk-`, `ghp_`, `gho_`, PEM headers, `.env` values), or a secret written to DB/git | **critical** |
| new table added to `db/schema.ts` (the schema already has every table) | **major**, critical if it duplicates an existing one |
| grounding gate weakened in `reviewer-core` / findings path (a finding kept without a real diff line, or a score trusted from the model) | **critical** |
| a new `src/modules/<name>/` not registered in `modules/index.ts` | **major** |
| `.spec/<feature>.spec.md` exists for a touched feature and the diff contradicts it | **major** |

If the pre-pass hits a `critical`, the LLM buckets still run (the user gets one complete
report, not a trickle), but the verdict is already decided.

---

## 6. Severity rubric

- **critical** — blocks the PR. Either a fixed-list item from §5, or: a documented "Do not
  touch" rule broken; a security hole reachable from an external input; data loss / a
  destructive migration; a layer violation dependency-cruiser marks `error`; broken build or
  tests. Rule of thumb: *would merging this need a revert or a hotfix?*
- **major** — must be answered, does not block: a real defect with a bounded blast radius, a
  convention violation, a missing test for a new seam.
- **minor** — style, naming, nit. Reported, never gated, capped at 10 in the report.

Anti-false-positive guard (important — a wrong `critical` is the failure mode that makes
people disable the gate): every candidate `critical` goes through a second, adversarial
verification pass in a fresh sub-agent that gets the finding plus the full file (not just the
diff hunk) and must answer "is this really true here, with a concrete failing scenario?".
Only `CONFIRMED` criticals count for the gate; `PLAUSIBLE` is demoted to major with the
doubt stated. This mirrors the repo's own grounding gate, and the reason is the same:
never trust an unverified model verdict.

---

## 7. Run shape

```
1. Resolve base + change set (§3)              — Bash
2. Read AGENTS.md (root + touched pkgs) + INSIGHTS.md (touched pkgs)
3. Deterministic pre-pass (§5)                 — Bash, sequential, fail-noted not fail-fast
4. Route (§4) → the matched buckets
5. Fan out: one sub-agent per bucket, in parallel, each:
      loads its skills → reviews only its slice → returns JSON findings
      {file, line, severity, category, claim, failing_scenario, skill}
6. Merge + dedupe by (file, line, category)
7. Verify every candidate critical in a fresh sub-agent (§6)
8. Verdict + report + gate state
```

Findings are returned as JSON so the merge/dedupe/gate step is mechanical, not prose parsing.

---

## 8. Output and the gate

Written to `.pr-review/<branch>.md` (gitignored, new `.gitignore` line), plus a short chat
summary — the report is the artifact, the chat is the pointer.

Report sections: verdict banner · change set (files, +/-, base sha) · buckets that ran and
the skills each loaded · findings grouped `critical → major → minor`, each with
`file:line`, the claim, the failing scenario, and the skill/rule it comes from · what was
skipped and why.

Gate state `.pr-review/<branch>.json`:

```json
{ "head": "<sha>", "base": "<sha>", "verdict": "pass|blocked",
  "critical": 0, "major": 3, "ranAt": "<iso>", "skipped": ["server-integration: docker down"] }
```

- `verdict: blocked` → the skill states plainly that the PR must not be opened or merged, and
  lists the criticals as the fix list. The hook enforces it for `gh pr create|merge|ready`.
- `verdict: pass` → the hook lets the PR command through.
- New commit after a pass ⇒ `head` mismatch ⇒ the gate re-arms automatically.
- **Override**: `/pr-self-review --override "<reason>"` writes `verdict: pass` with
  `override` + the reason, and the reason is echoed into the PR body. Rare, explicit,
  auditable — a gate with no escape hatch gets deleted instead of used.

---

## 9. Implementation steps

1. `routing.md`, `severity.md`, `report-template.md` — the tables above, as files.
2. `SKILL.md` — frontmatter (`name`, a `description` that triggers on "before opening a PR",
   "self review", "review my local changes") + the eight-step procedure, ≤ ~200 lines,
   delegating detail to the three reference files.
3. `.claude/hooks/pr-gate.sh` + `.claude/settings.json` `PreToolUse` entry (this is the only
   part that touches `settings.json`; use the `update-config` skill for it).
4. `.gitignore` += `.pr-review/`.
5. `.claude/skills/README.md` += catalog row. Do **not** touch `skills-lock.json`.
6. Root `AGENTS.md` → one line under **Session protocol**: before opening a PR, run
   `/pr-self-review`.

## 10. How we validate it before trusting it

- **Dry run on the live working tree.** The current branch has a real 16-file,
  ~1900-line diff (the `CLAUDE.md` → `AGENTS.md` migration, `server/package.json`,
  `server/pnpm-lock.yaml`, a new dependency-cruiser config). It must: route to
  repo-hygiene + backend-arch, *not* flag the AGENTS.md shells as a "Do not touch"
  violation (they are the sanctioned shape), and correctly pair the lockfile change with
  the `package.json` change. If it fails that, the tripwires are too blunt.
- **Seeded negatives.** Three throwaway branches, each with one planted critical (a ring
  violation, a hand-edited migration, a hardcoded token) — each must be caught and blocked.
- **One clean branch** — a docs-only change must pass in under a minute with zero findings.
  A gate that cries wolf on a typo fix is a gate nobody keeps.
- Then run `engineering-insights` and record what the dry runs taught in the root
  `INSIGHTS.md`.

## 11. Open decisions

1. ~~**Base branch**~~ — **decided: `origin/main`** (2026-09-20). `--base` still overrides
   per run, for the occasional PR against `upstream/main`.
2. ~~**Cost ceiling**~~ — **decided: run wide** (2026-09-20). Every matched bucket spawns; no
   cap. Wall-clock per bucket is recorded in the report, so if it ever hurts we trim from
   measurements rather than from a guess.
3. **Lint severity** — `lint` is now a per-package command (root `AGENTS.md`), so it is in the
   pre-pass as **major**. Promote eslint `error`-level rules to **critical** if the repo starts
   treating a red lint as unmergeable.
4. ~~**CI mirror**~~ — **decided: local only for now** (2026-09-20). §2.3 stays a follow-up;
   the local `PreToolUse` hook is the whole gate in v1.

---

## 12. Additions that make it worth running (beyond the gate)

A gate is a tax. These are what make people *want* to run it. Marked **v1** (build it now) or
**later** (after the first real runs tell us what hurts).

### 12.1 Diff-scoped grounding — **v1**

Every finding must cite a line **present in the change set**, and the quoted line must match
the file at the cited number. A finding about untouched code is dropped, not reported. Same
rule the product's own grounding gate enforces, for the same reason: a reviewer that drags in
pre-existing debt on every PR gets ignored within a week. Pre-existing problems adjacent to
the diff go into one `context` note at the end of the report, never into the gate.

### 12.2 `--fix` mode — **v1**

Most tripwire criticals are mechanically fixable, and listing them instead of fixing them is
busywork. `/pr-self-review --fix` applies only the deterministic, reversible ones:

| Finding | Fix |
|---|---|
| lint errors | `pnpm --dir <pkg> lint --fix` |
| vendor mirror drift | copy `server/src/vendor/shared` → the mirrors |
| migration edited by hand | revert the file, `db:generate` from the schema |
| lockfile drift | `pnpm --dir <pkg> install --lockfile-only` |
| `CLAUDE.md` shell broken | restore the three-line `@AGENTS.md` shell |

Never auto-fixes an LLM finding — those are proposals, not facts. After fixing it re-runs the
pre-pass (§5) only, and prints exactly what it changed.

### 12.3 The run writes the PR description — **v1**

It has already read the whole diff; make that pay off. On `pass`, emit a draft PR title +
body (what changed, why, how it was verified, what was deliberately left out) into
`.pr-review/<branch>.pr.md`, with a short "self-review" section listing the majors that were
accepted and the skills that ran. `gh pr create --body-file` picks it straight up — the gate
now *saves* a step instead of adding one.

### 12.4 Suppressions with a reason — **v1**

`.pr-review/suppress.json`: `{rule, path, reason, addedBy, addedAt}`. A suppressed finding is
still reported, demoted to `minor`, with its reason quoted. No wildcard `*` entries; a
suppression older than 90 days is surfaced as a `major` "expired suppression".
Without this, the first wrong `critical` on a legitimate pattern makes someone delete the
hook. With it, they add three lines and move on — and we can see what they suppressed.

### 12.5 Intent axis — was this the change that was asked for? — **v1**

The skill-routing covers *how the code is written*. It should also check *what was built*:
read the branch's commits, the linked issue (`gh issue view`), and any matching
`<pkg>/.spec/<feature>.spec.md`; report the delta — scope not delivered (**major**), scope
delivered that nobody asked for (**major**), behaviour contradicting the spec (**critical**).
Also flags scope-creep hygiene in the same pass: stray `console.log`, `.only(` in tests,
commented-out blocks, debug/scratch files, TODOs without a ticket.

### 12.6 Missing-test axis, per `TESTING.md` — **v1**

`TESTING.md` is typological, not coverage-driven, so this is a narrow check, not a coverage
gate: a **new seam** (a route, an adapter, a contract, an engine path) that ships with no test
in the suite that owns it is a **major**. A changed seam with a now-stale test is a **major**.
Anything else is silence.

### 12.7 Never echo a secret into the report — **v1**

The report is a file on disk. A secret-scan hit prints `file:line` and the pattern name only,
never the matched value, and never the contents of `~/.devdigest/secrets.json`. The same rule
applies to the chat summary.

### 12.8 Incremental re-runs — **later**

Cache per-file `(sha1(content), bucket) → findings` in `.pr-review/cache.json`. The second run
(the one after the fixes — there is always one) then re-reviews only the files that changed.
Cheap to add once the finding JSON of §7 exists.

### 12.9 Dogfood the product on itself — **later**

DevDigest *is* a PR reviewer. When the local stack is up, optionally run the change set
through `reviewer-core` / the local API with the built-in prompts in `docs/agent-prompts/`
and include the result as one extra bucket, clearly labelled. Two payoffs: a second opinion
for free, and every self-review becomes a live test of our own reviewer and its prompts.
Strictly opt-in (`--dogfood`) and never gate-blocking — the product's findings are input to
the report, not a verdict on the PR.

### 12.10 Make the run observable — **later**

Record per-bucket wall-clock, tokens and findings-kept/findings-dropped in the report footer,
and append an `overrides.log` line for every `--override` and every suppression added. Two
questions we will actually ask within a month: *what is slow?* and *is the gate being routed
around?* Neither is answerable retroactively unless we log from day one.

### 12.11 Feed false positives back into the skills — **later**

When a `critical` is overridden or suppressed, that is evidence the rubric is wrong. At the
end of such a run, prompt once: record it via `engineering-insights` in the root
`INSIGHTS.md`, and, if the same rule misfires twice, tighten the rule in `severity.md` or the
owning skill. The gate should get quieter over time, not louder.

---

## 13. Second layer — failure modes, honesty and the human loop

§12 is about value. This section is about the things that quietly break a gate after it ships.

### 13.1 Decide fail-open vs fail-closed, per layer — **v1**

The plan so far assumes every check can run. They cannot.

| Situation | Behaviour |
|---|---|
| A bucket sub-agent errors or returns unparseable JSON | retry once, then record the bucket as `inconclusive`; **verdict cannot be `pass`** with an inconclusive bucket |
| `pnpm` deps not installed / `typecheck` cannot start | `inconclusive`, with the one-line remedy printed (`pnpm --dir <pkg> install`) |
| Docker down ⇒ `*.it.test.ts` skipped | recorded as `skipped`, verdict may still be `pass` — this is normal local life |
| `gh` not authed (intent axis, §12.5) | that axis is `skipped`, not `blocked` |
| **The hook script itself errors** | **exit 0 — fail open**, print a warning |

That last row matters most. A broken `pr-gate.sh` that blocks every `gh` command is worse than
a missed review: the first thing anyone does is delete the hook, and then there is no gate at
all. The hook is allowed to be wrong in the permissive direction; the skill is not.

`inconclusive` is a third verdict alongside `pass`/`blocked`: it blocks, but its fix list is
"make the check runnable", not "fix your code". Conflating it with `blocked` teaches people
that the gate lies.

### 13.2 Refresh and check the base — **v1**

`git fetch origin main` before computing the merge-base — a stale `origin/main` means
reviewing a diff that no longer exists. If the branch is more than ~20 commits or 7 days
behind the base, report a **major** "stale base": the review is honest about what it reviewed,
and the conflicts are about to be someone's problem anyway.

### 13.3 Assert the routing table against reality — **v1**

`routing.md` names skills as strings. Rename or drop a skill and the bucket silently stops
loading it — the run still reports `pass`, now on a thinner review. So at startup: every skill
named in the routing table must resolve (project `.claude/skills/` or user-level). A missing
one is a **major** "routing drift", named in the report. Cheap check, prevents the worst class
of failure, which is a gate that passes for the wrong reason.

Same idea, other direction: a skill present in `.claude/skills/` that no routing row mentions
is listed once as a `context` note. Adding a skill should prompt the question "what files does
this govern?".

### 13.4 Verdicts must be reproducible — **v1**

Two runs on the same SHA producing different criticals kills trust faster than false positives
do. What makes it stable:

- the finding JSON of §7 with a fixed dedupe key `(file, line, category)`;
- the verification pass (§6) — the noisy tail is exactly what fails adversarial re-checking;
- the full finding set stored in `.pr-review/<branch>.json`, so a re-run prints
  **new / resolved / unchanged** against the previous run instead of a fresh wall of text.

That diff view is also what makes the second run (the one after fixes) readable in ten seconds.

### 13.5 Cap findings per bucket — **v1**

Eight per bucket, ranked, plus a count of what was cut. A cap forces ranking, and ranking is
where the signal is. An un-capped reviewer returns thirty-two observations of equal weight,
which is the same as returning none.

### 13.6 Interactive triage instead of a re-invocation — **v1**

When the run ends `blocked`, do not stop at a report. Walk the criticals one at a time and
offer: **fix now** (for anything §12.2 can do), **suppress with a reason** (§12.4),
**override** (§8), or **leave it**. The alternative — user reads report, edits files, re-runs
the whole skill — is a loop long enough that people skip the gate.

### 13.7 State keys must survive worktrees — **v1**

Only one worktree today, but `.emdash.json` is in `.gitignore`, so worktrees are expected.
`.pr-review/<branch>.json` collides when the same branch is checked out twice. Key the state
on `<branch>-<short sha of the worktree path>` and store `head` inside it, as already planned.

### 13.8 Be honest that the local gate is advisory — **v1 (one line in the report)**

The hook stops `gh pr create` from *this* Claude Code session. It does not stop `git push` +
"Create pull request" in the GitHub web UI, another terminal, or another machine. Two options,
in increasing strength:

1. also install a real `.git/hooks/pre-push` calling the same gate script (no hooks are
   installed today) — covers every local terminal, still bypassable with `--no-verify`;
2. the CI mirror (§2.3), which is the only thing that actually binds.

Recommendation: ship v1 with the Claude hook, add the `pre-push` hook in the same PR since it
is ten lines reusing `pr-gate.sh`, and say plainly in the report footer that the binding gate
is still CI, which we have not built. A gate that overstates its own power is worse than one
that states its limits.

### 13.9 Ground `severity.md` in this repo's own history — **later**

Abstract definitions of "critical" drift. Six real examples — a past revert, a hotfix, a
migration that had to be regenerated, a grounding-gate regression — anchor the rubric better
than a paragraph of criteria, and they double as the eval set for §10.

---

## 14. Not built in v1 (deliberate backlog)

Accepted, deferred — in this order:

1. §12.8 incremental re-runs (needs one real run to size the cache).
2. §12.9 dogfooding through `reviewer-core` (`--dogfood`, never gate-blocking).
3. §12.10 run telemetry — per-bucket wall-clock, tokens, overrides log.
4. §12.11 false-positive feedback into `severity.md` via `engineering-insights`.
5. §13.9 severity examples grounded in this repo's revert/hotfix history.
6. §2.3 the CI mirror — the only gate that actually binds. Until it exists, the report
   footer says so out loud (§13.8).
