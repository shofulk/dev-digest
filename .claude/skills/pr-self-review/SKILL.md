---
name: pr-self-review
description: Reviews the local, unmerged change set before a pull request is opened — routes this repo's skills onto the files each one governs, runs the deterministic checks, and blocks PR creation and merge while a verified critical finding stands. Use before opening a PR, when asked to self-review or pre-review local changes, when a `gh pr create` / `gh pr merge` was blocked by the pr-gate hook, and whenever the user asks whether a branch is ready to merge.
---

# PR self-review

Review everything unmerged on this branch, decide one verdict, write it where the gate hook
can read it. Rationale for every rule below is in `docs/pr-self-review.plan.md` — this file is
the procedure, not the argument.

Reference files, read when the step says so:
`routing.md` (globs → skills → checks) · `severity.md` (what blocks) ·
`report-template.md` (the output shape).

**Arguments:** `--base <ref>` (default `origin/main`) · `--fix` (apply the mechanical fixes,
step 8) · `--override "<reason>"` (record an exception, step 9) · `--quick` (steps 1-3 only).

---

## Step 1 — Change set

```bash
git fetch origin main --quiet                    # a stale base reviews a diff that no longer exists
BASE=$(git merge-base HEAD origin/main)          # or the --base ref
git diff --name-status $BASE                     # committed on the branch
git diff --name-status HEAD                      # unstaged
git diff --name-status --cached                  # staged
git ls-files --others --exclude-standard         # untracked — new files count
```

Union of all four is the **file list**. Review input is `git diff -U15 $BASE` plus the full
text of every untracked file. If the branch is >20 commits or >7 days behind the base, record
a **major** `stale-base`.

Empty change set ⇒ stop, say so, write no state file.

Excluded from *content* review (still covered by the tripwires in step 3):
`*/pnpm-lock.yaml`, `server/src/db/migrations/**`, `*/dist/**`, `*/node_modules/**`.
A file with >1500 changed lines is recorded as `review-skipped` and named in the report.

## Step 2 — Context

1. Read the root `AGENTS.md` and the `AGENTS.md` of every touched package.
2. Invoke `engineering-insights` — read the `INSIGHTS.md` of every touched package, and
   carry the entries that bear on these files into the bucket prompts in step 4. A reviewer
   that has not read them re-reports known traps as findings.
3. If a touched feature has a `<pkg>/.spec/<feature>.spec.md`, read it — step 5 needs it.

## Step 3 — Deterministic pre-pass

Read `severity.md` §1 and run every check it lists for the touched packages: `typecheck`,
`lint`, `test`, `pnpm --dir server arch`, and the repo tripwires (hand-edited migrations,
`vendor/**` edited outside the source, lockfile drift, broken `CLAUDE.md` shells, secrets,
grounding-gate weakening, unregistered modules).

These have **fixed severities** — no judgement, no negotiation. A critical here does not stop
the run: the buckets still run so the user gets one complete report, but the verdict is
already decided.

A check that *cannot run* (deps missing, `gh` unauthed) is `inconclusive`, never `pass` —
see step 7.

`--quick` stops here.

## Step 4 — Route and fan out

Read `routing.md`. Intersect each bucket's globs with the file list; **a bucket with no
matching file does not run.** Then assert routing integrity: every skill named in the table
must resolve as a loadable skill — one that does not is a **major** `routing-drift`, because
it means a bucket silently reviewed less than it claims.

Spawn every matched bucket in parallel, one sub-agent each (no cap). Each bucket:

- loads its skills **before** judging, and names them in its result;
- sees only its slice of the diff, plus the `INSIGHTS.md` entries from step 2;
- returns at most **8 findings**, ranked, plus `droppedCount`. The cap forces ranking, and
  ranking is where the signal is;
- returns JSON, nothing else:

```json
{ "bucket": "backend-arch", "skillsLoaded": ["onion-architecture"], "droppedCount": 3,
  "findings": [{ "file": "server/src/modules/x/service.ts", "line": 42,
    "quotedLine": "import { db } from '../../db'",
    "severity": "critical|major|minor", "category": "layer-violation",
    "claim": "one sentence", "failingScenario": "concrete inputs → wrong outcome",
    "skill": "onion-architecture", "fix": "one sentence" }] }
```

**Grounding gate — non-negotiable.** Drop any finding whose `line` is not in the change set,
or whose `quotedLine` does not match the file at that line. A finding about untouched code is
not a finding; at most it is one `context` note at the end of the report. This is the same
rule the product itself enforces, for the same reason.

A bucket that errors is retried once, then recorded `inconclusive`.

## Step 5 — Intent axis

Alongside the buckets: read the branch commits, the linked issue if there is one
(`gh issue view`), and any spec from step 2, then report the delta — scope asked for and not
delivered (**major**), scope delivered nobody asked for (**major**), behaviour contradicting
the spec (**critical**). Flag in the same pass: stray `console.log`, `.only(` in tests,
commented-out blocks, debug files, TODOs without a ticket.

If `gh` is not authenticated, this axis is `skipped` — recorded, not blocking.

Also here, per `TESTING.md`: a **new seam** (route, adapter, contract, engine path) with no
test in the suite that owns it is a **major**. A changed seam with a stale test is a
**major**. Nothing else — this is not a coverage gate.

## Step 6 — Merge, verify, suppress

1. Dedupe on `(file, line, category)`; keep the highest severity and merge the claims.
2. **Verify every critical** in a fresh sub-agent that gets the finding plus the *whole file*
   and must answer `CONFIRMED` (with a concrete failing scenario) or `PLAUSIBLE`. Only
   `CONFIRMED` criticals gate; `PLAUSIBLE` is demoted to major with the doubt stated. A wrong
   critical is the failure mode that gets the whole gate deleted — this step is not optional.
3. Apply `.pr-review/suppress.json` if present (`{rule, path, reason, addedBy, addedAt}`): a
   suppressed finding is still reported, demoted to **minor**, with its reason quoted. No
   wildcard paths. A suppression older than 90 days is itself a **major**.
4. Cap `minor` findings at 10 in the report.

## Step 7 — Verdict

| Verdict | When |
|---|---|
| `blocked` | ≥1 CONFIRMED critical |
| `inconclusive` | no confirmed critical, but a bucket or a check could not run |
| `pass` | no confirmed critical, everything that should run ran |

`inconclusive` blocks too, but it is a different sentence: *nothing is known about this
branch*, and its fix list is "make the check runnable". Never report it as `blocked` — that
teaches people the gate lies. A Docker-down integration suite is `skipped`, not
`inconclusive`; it is normal local life.

## Step 8 — Write the output

```bash
STATE=$(.claude/hooks/pr-gate.sh state-path)     # one source of truth for the path
```

Write `$STATE`:

```json
{ "verdict": "pass|blocked|inconclusive|override", "head": "<git rev-parse HEAD>",
  "base": "<sha>", "critical": 0, "major": 3, "minor": 7, "ranAt": "<iso>",
  "message": "<one line for the hook to print>", "skipped": ["…"],
  "buckets": ["…"], "findings": [ … ] }
```

The full finding list lives in the state file so the next run can print **new / resolved /
unchanged** instead of a fresh wall of text.

Then write the report `${STATE%.json}.md` from `report-template.md`, and print a short chat
summary that points at it — the report is the artifact, the chat is the pointer.

**Never echo a secret.** A secret-scan hit prints `file:line` and the pattern name only,
never the matched value, and never anything out of `~/.devdigest/secrets.json`. This holds in
the report, the state file and the chat.

On `pass`, also write `${STATE%.json}.pr.md`: a draft PR title and body (what changed, why,
how it was verified, what was left out) with a self-review section listing the accepted majors
and the skills that ran. `gh pr create --body-file` takes it as-is.

**`--fix`** applies only the deterministic, reversible fixes — `lint --fix`, re-sync the
vendor mirrors from `server/src/vendor/shared`, revert a hand-edited migration and
`db:generate`, `install --lockfile-only`, restore a `CLAUDE.md` shell. Never an LLM finding:
those are proposals, not facts. Then re-run step 3 only and print exactly what changed.

## Step 9 — Close the loop

When `blocked`, do not stop at the report. Walk the criticals one at a time and offer: **fix
now** (anything `--fix` covers), **suppress with a reason**, **override**, or **leave it**.
The alternative — read report, edit, re-invoke the whole skill — is a loop long enough that
people stop running the gate.

`--override "<reason>"` writes `verdict: "override"` with the reason, which the hook warns
about, the report records, and the PR body quotes. Rare, explicit, auditable. Refuse to
write an override with an empty or placeholder reason.

Finally: if a critical was overridden or suppressed, the rubric was wrong. Run
`engineering-insights` and record it in the root `INSIGHTS.md`; if the same rule misfires
twice, tighten it in `severity.md`. The gate should get quieter over time.

---

## What this gate does not do

State it in the report footer, every run: this blocks `gh pr create|merge|ready` from Claude
Code, and `git push` if `.git/hooks/pre-push` is installed
(`ln -sf ../../.claude/hooks/pre-push .git/hooks/pre-push`). It does **not** stop the GitHub
web UI, another machine, or `--no-verify`. The gate that actually binds would be CI, and it
does not exist yet. A gate that overstates its power is worse than one that states its limits.
