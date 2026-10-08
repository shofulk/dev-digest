# `specs/` — cross-module specs

This folder holds specs for features that touch **two or more packages** — for example a
new server route and the client screen that uses it. A feature that touches one package
keeps its spec in that package: `<pkg>/.spec/<feature>.spec.md`. A cross-module feature
has **one** spec here and no per-package specs next to it.

This file is also the **format of record** for every spec in the repo — here and in
every `<pkg>/.spec/`.

## Role in the chain

```
feature request + designs ─► spec-creator ─► spec (draft ─► approved) ─► implementation-planner ─► plan ─► implementer
```

The `spec-creator` agent writes the spec. The `implementation-planner` takes the approved
spec as its input and writes the plan. The spec fixes behaviour, boundaries and
contracts; the plan decides files, modules, step order and code.

## Rules

- A spec is written **before** the code. It says what the system shall do and why — not
  how it is built. Usually it has no implementation details.
- A spec **may** contain:
  - workflow diagrams (user flow, feature states — Mermaid `flowchart`, `stateDiagram-v2`);
  - communication diagrams between services and packages (Mermaid `sequenceDiagram`);
  - contracts at the boundary — route and method, request/response fields, SSE events,
    MCP tool inputs/outputs, error cases. Described by fields, not by Zod code.
- A spec does **not** contain: new file paths, component trees, function or class names,
  internal module layout, library choices, SQL or Zod code, step order. Only if the user
  asks for a technical constraint, it is written as a requirement with its reason.
- Diagrams stay small (about 15 nodes at most), use real names, and support the EARS
  criteria — they never replace them.
- One file per feature: `<feature>.spec.md`, kebab-case.
- Plain English, level B1: short sentences, common words, active voice, one term for one
  thing. Code names stay as in the code.
- Name the existing contracts the feature touches — routes, Zod schemas in
  `server/src/vendor/shared`, tables, SSE events, MCP tools. That makes the spec checkable.
- Every requirement has a source in *Inputs and provenance*.

## Spec ID and status

- `Spec ID: SPEC-NN-<feature>` — a global number across the whole repo (`specs/` and
  every `<pkg>/.spec/`) plus the feature slug, the same as the file name. Example:
  `client/.spec/intent-card.spec.md` → `SPEC-07-intent-card`. Search by number or by
  name. Next number = highest existing + 1. A spec that supersedes one of the same
  feature keeps the slug with a new number. Specs written before this format have
  no ID.
- `Status:`
  - `draft` — being written; may change.
  - `approved` — the user said yes; **frozen**. A change is a new spec with
    `Supersedes:`. An approved spec has no `(blocking)` open question.
  - `implemented` — the feature shipped. The main session sets it after `plan-verifier`
    reports every `AC-n` of the spec as met. `spec-creator` never sets it.
- `Supersedes: <path> (SPEC-NN-<feature>)` when the spec replaces an earlier decision;
  otherwise `none`.

`.claude/hooks/scope-guard.sh write spec` enforces this for `spec-creator`: a new spec is
born `draft`, and only a `draft` file can be edited. `.claude/hooks/spec-lint.mjs` checks
the format below on every spec it writes — including the `[NEEDS CLARIFICATION: Q-n]`
markers — and blocks the switch to `approved` while the spec has a format error.

## Template

```markdown
# Spec: <feature name>
Spec ID: SPEC-NN-<feature>
Status: draft | approved | implemented
Supersedes: none | <path> (SPEC-NN-<feature>)

## Problem and user
## Goals / Non-goals
## User stories
## Acceptance criteria (EARS)
## Module interactions          <- only in specs/ (cross-module)
## Edge cases
## Non-functional requirements
## Assumptions
## Inputs and provenance
## Untrusted inputs
## Open questions
## Traceability
```

All sections, in this order. No section is removed. A section with nothing to say says
`None.` and why. `## Module interactions` is required in `specs/` and absent in
`<pkg>/.spec/`: a communication diagram and the boundary contracts — which route the
client calls, which contract carries the data, which table is read or written, which SSE
events flow, what the MCP server exposes.

### Item formats

Every item has a stable ID. IDs never change and are never reused inside one spec;
`implementation-planner`, `test-writer` and `plan-verifier` cite them.

| Section | Format |
|---------|--------|
| User stories | `- **US-1** As a <user>, I want <goal>, so that <benefit>. → AC-1, AC-2` |
| Acceptance criteria | `- **AC-1** [client] WHEN <trigger>, the <part> shall <response>. *Verify: e2e*` |
| Edge cases | `- **EC-1** <situation>. → AC-5` |
| Non-functional requirements | `- **NFR-1** <area>: <requirement with a number and unit>. *Verify: it*` |
| Assumptions | `- **A-1** <what we take as true without proof>. Risk if wrong: <one line>.` |
| Open questions | `- **Q-1** (blocking \| non-blocking \| planner) <question>` |

- **Package tag** `[server]`, `[client]`, `[reviewer-core]`, `[e2e]`, `[mcp-server]` —
  required on every `AC-n` in `specs/`, optional in `<pkg>/.spec/`.
- **Verify hint** — how the criterion is checked: `unit`, `it` (DB-backed server test),
  `e2e`, `manual`, or several joined by `+` (`unit + e2e`). It says what kind of check,
  never which file or test name.
- **Traceability** — one table row per acceptance criterion:

  ```markdown
  | AC | Stories | Edge cases | NFR | Verify |
  |----|---------|------------|-----|--------|
  | AC-1 | US-1 | — | — | e2e |
  | AC-5 | US-2 | EC-1, EC-3 | NFR-2 | unit + e2e |
  ```

  Every user story points to at least one `AC-n`. Every edge case points to at least one
  `IF … THEN` criterion. Every ID in the table exists in its section.
- **Open questions** — `blocking` must be answered before `approved`; `non-blocking` may
  stay; `planner` is a how-question left for `implementation-planner`.
- **`[NEEDS CLARIFICATION: Q-n]`** — the inline marker of an unsettled point. A draft
  puts it in the exact item (`AC-n`, `EC-n`, `NFR-n`, a contract row, a sentence) whose
  text depends on the answer, so an open question is visible where it matters, not only
  in *Open questions*. Every marker cites a `(blocking)` `Q-n`, and every `(blocking)`
  `Q-n` has at least one marker. When the user answers, the text is rewritten, every
  marker of that question is removed, the `Q-n` item goes (its number is not reused) and
  the answer is recorded in *Inputs and provenance*. An `approved` spec has no marker;
  the `implementation-planner` refuses to plan from a spec that still has one.

## Acceptance criteria: EARS

EARS (Easy Approach to Requirements Syntax; Mavin et al., Rolls-Royce, IEEE RE'09)
separates the condition from the system response. Each criterion is one sentence with
`shall`, and can be checked without asking the author.

| Pattern | Form |
|---------|------|
| Ubiquitous | The `<part>` shall `<response>`. |
| Event-driven | WHEN `<trigger>`, the `<part>` shall `<response>`. |
| State-driven | WHILE `<state>`, the `<part>` shall `<response>`. |
| Unwanted behaviour | IF `<unwanted condition>`, THEN the `<part>` shall `<response>`. |
| Optional feature | WHERE `<feature is enabled>`, the `<part>` shall `<response>`. |

| Vague | Checkable |
|-------|-----------|
| "Must work well on big repos" | WHEN the repository is larger than the indexing limit, the reviewer shall build the overview only from deterministic facts, without reading every file in full. |
| "Must not fail if the model is down" | IF the structured model call fails, THEN the reviewer shall show the deterministic overview with the reason for the degradation. |
| "Should suggest where to start reading" | The reviewer shall order the reading path by file rank in the import graph. |

Words that cannot be tested are not allowed in criteria and NFRs: *fast*, *quickly*,
*nice*, *properly*, *user-friendly*, *intuitive*, *easy*, *robust*, *seamless*,
*appropriate*, *as needed*, *etc.*

How to write a good spec — design review checklist, examples, self-check — is the
`spec-writing` skill (`.claude/skills/spec-writing/`).
