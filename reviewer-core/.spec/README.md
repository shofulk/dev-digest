# `.spec/` — `reviewer-core`

Feature contracts, written **before** the implementation. A spec is what the code
is checked against, not a description of code that already exists.

- One file per feature: `<feature>.spec.md`, kebab-case.
- Required sections: **Goal** (one sentence) · **Acceptance criteria**
  (checkable, numbered) · **Out of scope** · **Open questions**.
- Name the contracts the feature touches (routes, Zod schemas, tables) — that is
  what makes the spec checkable.
- When the feature ships, the spec stays as the record. Corrections are edits to
  the spec, not notes appended to it.
