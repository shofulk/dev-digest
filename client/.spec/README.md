# `.spec/` — `client`

Feature contracts for features that touch **only** `client`, written **before** the
implementation. A spec is what the code is checked against, not a description of code
that already exists. A feature that touches two or more packages has one spec in the
root [`specs/`](../../specs/README.md) instead.

- One file per feature: `<feature>.spec.md`, kebab-case.
- Format of record — template, EARS acceptance criteria, Spec ID, statuses — is
  [`specs/README.md`](../../specs/README.md). New specs are written by the
  `spec-creator` agent in that format.
- Specs written before that format (Goal / Acceptance criteria / Out of scope / Open
  questions) stay as they are, as the record.
- An `approved` spec is frozen. A change is a new spec with `Supersedes:`.
