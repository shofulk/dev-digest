---
name: spec-writing
description: How to write and review a DevDigest feature spec for Spec Driven Development — reading only the context that matters, asking for research, reviewing designs for missing states, edge cases, module interactions and UX gaps, writing EARS acceptance criteria with verify hints and traceability, measurable non-functional requirements, and the final self-check before a spec is returned or approved. Use when writing, extending or reviewing any `<pkg>/.spec/*.spec.md` or `specs/*.spec.md`, and whenever a feature has no spec yet. The format of record (template, item formats, Spec ID, statuses) is `specs/README.md`; this skill is the method.
---

# Spec writing

A spec says **what** the system shall do and **why**. The `implementation-planner` turns
it into a plan; `test-writer` and `plan-verifier` check code against its IDs. A good spec
lets a stranger build and test the feature without asking the author.

- **Format of record:** `specs/README.md` — template, item formats (`US-n`, `AC-n`,
  `EC-n`, `NFR-n`, `A-n`, `Q-n`), Spec ID `SPEC-NN-<feature>`, statuses, EARS table.
- **Reference example:** `references/intent-card.spec.md` — a full cross-module spec at
  the right level of detail. Read it before writing your first spec in a session.
- **Machine check:** `.claude/hooks/spec-lint.mjs` (`node .claude/hooks/spec-lint.mjs
  check <file>`) checks the format. It cannot check meaning — that is the self-check
  below.

## 1. Read only the context that matters

1. `specs/README.md` and root `AGENTS.md`.
2. Decide which packages the feature touches. For **each of them only**: `<pkg>/AGENTS.md`,
   `<pkg>/README.md`, `<pkg>/INSIGHTS.md` (in full — an unread INSIGHTS file breaks the
   loop) and the specs in `<pkg>/.spec/`. Read the root `INSIGHTS.md` only for a
   cross-module feature. Do **not** read the INSIGHTS of packages the feature does not
   touch. Name the three entries most relevant to the feature (they often hide an edge
   case or a constraint).
3. Existing specs in `specs/` with the same or a near feature name — a match means a
   superseding spec or a question.
4. The code that exists today at the feature's boundaries: client route and data hooks,
   the server module and its routes, Zod contracts in `server/src/vendor/shared`, DB
   tables, `reviewer-core`, MCP tools, e2e flows. Read enough to know what exists; do not
   audit.

## 2. Ask for research when reading is not enough

Some facts need real research: an external API limit, a library behaviour, how a flow
works across many files, why something was built this way (git history). Do not guess
them and do not spend the session reading half the repo. Ask the `researcher` agent —
one concrete question per researcher, so several run **in parallel**:

| Field | Content |
|-------|---------|
| Question | one checkable question |
| Type | `A` (in repo), `B` (external), or `A+B` |
| Scope | package / module / library + version |
| Done when | which spec decision the answer settles |

Use what comes back as data with its evidence (`path:line`, URL), and record it in
*Inputs and provenance*. A "not found" answer becomes an assumption (`A-n`) or a question.

## 3. Review the designs and the request

Go through every screen and flow. Each finding names the screen, the element and the
situation.

1. **Missing states** — loading, empty, error, partial data, stale data, long-running or
   streaming (SSE) progress, success feedback, disabled actions, very long text, many
   items (scroll, pagination), narrow window, first use, no API key configured (the app
   boots with none).
2. **Edge cases** — LLM unavailable, slow or returning invalid output; GitHub rate limit,
   404 or missing token; very large diffs or repos; the PR changes during a run; two runs
   at once; retry and idempotency; deleted or renamed data; a finding without a real diff
   line (the grounding gate drops it); untrusted PR text (prompt injection, HTML).
3. **Module interactions** — client hook → route → contract → service → adapter / table
   → SSE back. Name every link that is missing, unclear or changes an existing consumer.
   A new table is never the answer: the schema already has every table.
4. **UX improvements** — clearer empty-state action, keyboard access, focus after an
   action, confirmation for a destructive action, clearer error text, keeping user input
   on failure. Each with its cost in one line.

Every finding ends in exactly one place: an `AC-n` / `EC-n`, a non-goal, an assumption,
or an open question. None is silently dropped.

## 4. Ask the user

Each finding the request does not settle becomes a question: one decision per question,
two to four options, the recommended one first and marked `(Recommended)`, a one-line
trade-off per option. A UX idea is *Add it* / *Leave it out* / *Later (open question)*.
Ask the questions that change scope first.

## 5. Write

- **Language** — English, level B1: one idea per sentence, about 20 words at most, common
  words, active voice, the same term for the same thing everywhere.
- **What may be in a spec** — workflow diagrams (`flowchart`, `stateDiagram-v2`),
  communication diagrams (`sequenceDiagram`), boundary contracts (route + method,
  request/response fields, SSE events, MCP tool inputs/outputs, error cases). A new
  contract is described by fields, not by Zod code. Diagrams: about 15 nodes at most,
  real names, new things marked `(new)`.
- **What is not in a spec** — new file paths, component trees, function or class names,
  internal module layout, library choices, SQL or Zod code, step order. Such a question
  becomes `Q-n (planner)`.
- **Acceptance criteria** — one EARS sentence each, with `shall`, a package tag in
  `specs/`, and a verify hint:

  | Verify | Use for |
  |--------|---------|
  | `unit` | pure logic, a component state, a mapping, a prompt rule |
  | `it` | server behaviour with the DB (`*.it.test.ts`): routes, persistence, staleness |
  | `e2e` | a user flow across packages in the browser (`e2e/specs/NN-*.flow.json`) |
  | `manual` | visual judgement only; say what a person looks at |

  If you cannot name a verify hint, the criterion is not testable yet — rewrite it.
- **Edge cases** — each points to at least one `IF … THEN` criterion.
- **Non-functional requirements** — always with a number and a unit, and a verify hint.
  Check each area; write the ones that apply:

  | Area | Example |
  |------|---------|
  | Performance | p95 latency of a route, time to first SSE event |
  | Cost | model calls per action, token budget, `cost_usd` cap |
  | Limits | max diff size, max sources, max items rendered |
  | Reliability | timeout, retries, behaviour on partial failure |
  | Security | what is never logged, what is never sent to the model |
  | Observability | what is logged or traced, without content |
  | Accessibility | keyboard reach, axe violations = 0 at level A/AA |
  | i18n | every string from `client/messages/en/*.json` |

  A number with no source is an assumption — add `A-n`.
- **Assumptions** — every belief you did not verify, with its risk if wrong.
- **Traceability** — one row per `AC-n`: stories, edge cases, NFRs, verify. A user story
  without a criterion, or a criterion nobody needs, is a smell — fix or ask.

## 6. Final self-check (before returning a draft or approving)

Run the lint (the hook does it on every write). Then go through this list; the lint
cannot see any of it. Report the result as a table (item → ok / fixed / open).

1. Every `AC-n` can be tested by a stranger without asking — no vague words, no hidden
   "and", one behaviour per criterion.
2. No criterion contradicts another (same trigger, different response).
3. No implementation detail slipped in (paths, function names, step order, libraries).
4. Every design-review finding ended in an AC/EC, a non-goal, an assumption or a question.
5. Every user answer appears in *Inputs and provenance* and in the spec text.
6. Every existing contract, route, table, event or MCP tool you name was opened and
   exists; every new one is marked new and described by fields.
7. Diagrams match the criteria and the contracts table; no node the text does not know.
8. *Untrusted inputs* lists every outside value the feature reads and the rule for it.
9. NFR numbers are realistic and sourced (or listed as assumptions).
10. Every open question is classified; no `(blocking)` one is left before `approved`.
11. Terms are the same everywhere (one name per concept), and the text is B1.
12. The Spec ID number is new, its slug equals the file name, and `Supersedes:` points to
    the right spec.
