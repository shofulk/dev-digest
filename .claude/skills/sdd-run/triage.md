# /sdd-run — triage of a review round

Turns the three reports of a round into one fix list. The main session does this itself,
in writing (`NN-fix-list.md`), before the retro and before any fix is dispatched.

## 1. Collect

One row per item: every architecture finding, every security finding (HIGH confidence;
the *needs verification* list is item 4 below), every plan-verifier row that is `not met`,
`partial` or `cannot verify`, every *Unplanned changes* line and every `bypass-candidate`.
Plan-verifier rows marked `awaiting manual` are not fix items: they are collected once into
the user's list, get no F ID, and are not re-raised in later rounds.

## 2. Decide, per item

| Item | Goes to | Fixed this run? |
|------|---------|-----------------|
| architecture `critical` / `major` | `implementer` fix | yes |
| architecture `minor` | — | no: listed under *Open minors* in `summary.md`; fixed only if the user asks |
| security finding | `implementer` fix | yes |
| plan item `not met` / `partial` — code missing or wrong | `implementer` fix | yes |
| plan item `partial` — only the test is missing or weaker than the Test-plan row | `test-writer` after | yes |
| plan item `cannot verify` — needs a stack, a probe, Docker | Phase 3 manual acceptance, then plan-verifier re-run | yes, as evidence |
| plan item `awaiting manual` — only the user or an absent browser channel can run it (visual check, axe/keyboard) | the user: listed in `summary.md` under what is not verified (`SKILL.md` Phase 6 step 5), with what to run and the expected result | no: not a fix item, does not keep the round from being clean, and is not re-raised; a later `Manual acceptance:` block with the user's result re-judges it |
| *Unplanned changes* line | revert in `implementer` fix, or the user accepts it | ask when it is not clearly noise |
| red test edited (hash mismatch) | `implementer` fix: restore the file, fix the code | yes |
| item says the **plan** is wrong (the AC, a step, a Verify) | stop → `implementation-planner` Update mode, input: the report path | no |
| `bypass-candidate` | reproduce through the full JSON dispatch (README *The fix loop*); reproduced → a security item | yes |

## 3. Check before you dispatch

- **Ground it.** A finding whose `file:line` is not in the change set, or whose evidence
  does not match the file, is rejected — record it under *Rejected* with what you saw.
- **Dedupe** on `(file, line, category)` across the three reports; keep the highest
  severity, merge the evidence.
- **Disagree with evidence, not opinion.** If the finding contradicts the plan, a skill or
  `AGENTS.md`, quote the rule and reject it under *Rejected*; the next re-review gets the
  quote. If you cannot settle it, ask the user.
- **Conflicts.** Two items that need opposite changes are one question for the user.

## 4. Security *needs verification*

Do not fix on suspicion. Read the cited source → sink; confirmed → a security item,
otherwise *Rejected* with the reason.

## 5. Fix list format

```markdown
# Fix list · round <r>

| ID | Source | Severity | file:line | Finding | Goes to | Expected after the fix |
|----|--------|----------|-----------|---------|---------|------------------------|
| F1 | architecture-reviewer #2 | major | `server/src/modules/x/service.ts:41` | … | implementer (server) | … |

## Rejected
- <source #n> — <why, with the quoted rule or the line you read>

## Open minors (not fixed unless the user asks)
- <source #n> — <finding>
```

IDs `F<n>` never repeat across rounds — a finding that survives a round keeps its ID, so
the retro and the budget question see it recur.
