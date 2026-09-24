# `.doc/` — `e2e`

Design rationale and runbooks: **why** the code looks the way it does. Loaded on
demand, so these files may be long — the length limit that applies to
`AGENTS.md` does not apply here.

- One topic per file: `<topic>.md`, kebab-case (`grounding-gate.md`,
  `di-container.md`).
- Start each file with a one-line summary, then the decision, the alternatives
  considered, and why they were rejected.
- Add a pointer here in `../AGENTS.md` under **Read when** only if the topic is
  something an agent would otherwise get wrong.
- Do not restate `README.md`. Link to it.
