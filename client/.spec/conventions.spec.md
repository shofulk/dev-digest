# Conventions — `client`

## Goal

One surface per repo — `/repos/[repoId]/conventions` — where a maintainer runs a scan,
watches it progress, triages every proposed house rule against the real code that proves it,
edits the ones worth keeping, and turns the selected set into a `repo-conventions` skill
optionally linked to a reviewing agent, all without leaving the page.

Server contract: `server/.spec/conventions.spec.md`.

## Background

- `client/messages/en/conventions.json` already exists with the page, empty-state and card
  copy (`page.*`, `card.*`). Reuse it and add the keys the triage filters, the scan progress,
  the inline editor and the Create-skill modal need. `card.acceptAsSkill` predates the
  three-state triage and is superseded by the accept / reject pair.
- `activeKeyFor()` already maps `/conventions` to a sidebar key
  (`src/components/app-shell/helpers.ts:31`) — the route was anticipated, the nav entry was
  never shipped.
- `src/lib/hooks/agent-skills.ts` already exports `useAgentSkills`, `useSetAgentSkills` and
  `useUpdateAgentSkill`. `useSetAgentSkills` posts the **whole** ordered set and would wipe
  an agent's other links — it is the wrong hook for this feature (see criterion 29).
- `src/lib/hooks/skills.ts` covers the Skills Lab; the extracted-skill create call is new.
- `Markdown`, `EmptyState`, `ErrorState`, `CircularScore` and the modal / drawer primitives
  already exist and are reused; no new dependency ships with this feature.

## Acceptance criteria

### A. Route and shell

1. `src/app/repos/[repoId]/conventions/page.tsx` is a **thin** route entry: it reads the
   route param and renders `_components/ConventionsView/`. No data fetching, no state, no
   layout, no copy in `page.tsx` — the `frontend-ui-architecture` rule for a route file.
2. The page renders inside `AppShell` with the breadcrumb `Skills Lab › Conventions` and the
   heading `Conventions in <repo name>`, falling back to `page.repoFallback` while the repo
   is still loading.
3. The three load states are distinct: skeletons while loading, `ErrorState` with retry on
   failure (`page.loadError`), and `EmptyState` with the `page.empty.*` copy plus the
   `Run extraction` CTA when the repo has no candidates yet.
4. The header action is `Run extraction` on an empty board and `Re-scan` once candidates
   exist, disabled and labelled `page.scanning` while a scan is in flight.

### B. Scanning

5. `Run extraction` calls `POST /repos/:id/conventions/scan` through
   `useScanConventions()` in `src/lib/hooks/conventions.ts` and receives `{ scan_id }`.
   It is a **mutation**, never a query: it costs a model call and must never fire on mount,
   on focus, or on a retry.
6. The page then subscribes to `GET /conventions/scans/:id/events` and shows live progress —
   `sampling` (n files), `proposing` (model id), `verifying` — in place of the button label.
7. On the terminal `done` event the list cache is seeded from the event's
   `ConventionExtractResult` payload; no extra `GET /repos/:id/conventions` round-trip is
   needed to render the result.
8. The scan summary line is rendered from the same payload: files sampled, `proposed`,
   `dropped_ungrounded`, `dropped_duplicate`, model and `cost_usd`. A thin result must read
   as *the gate worked* — "12 proposed · 2 dropped, ungrounded · 1 duplicate · 9 kept" — not
   as a failure.
9. An `error` event renders inline with the server's message (`page.extractionFailed`) and
   leaves the existing candidates on screen untouched.
10. Navigating away and back re-attaches to the stream by `scan_id` and still shows the
    result, because the stream is replay-first.

### C. Triage

11. Candidates render as cards in `_components/ConventionCard/`. A card shows: the rule, a
    category chip, the evidence as `path:line` with the verified snippet in a monospace
    block, a confidence bar with its numeric value, and the accept / reject / edit / delete
    controls.
12. The evidence `path:line` is a link to that exact line on GitHub for a repo with a known
    remote, and plain text otherwise.
13. `Accept` and `Reject` each send `PATCH /conventions/:id` with the new `status` and apply
    optimistically, rolled back on error. Accepting one card never mutates another.
14. Filter chips — `All` / `Pending` / `Accepted` / `Rejected` — each with a live count,
    filter the list client-side. Counts come from the full list, not the filtered view.
15. `Delete` asks for confirmation and states plainly that a deleted rule **can** be
    re-proposed by the next scan, while a rejected one cannot. That difference is the whole
    reason both controls exist.
16. Inline editing turns `rule`, `rationale` and `category` into editable fields on the card
    and saves them with the same `PATCH /conventions/:id`. Evidence and confidence are
    **read-only** in the UI — they are the server-side gate's output, not an opinion.
17. Editing has explicit save and cancel; cancel restores the previous values and sends
    nothing. Save is disabled while unchanged and while in flight.
18. Each card carries a selection checkbox, independent of `status`, and the selection is
    what the Create-skill action uses (criterion 20). Selecting defaults to the accepted set
    so the common path is one click.

### D. Create skill

19. `Create skill` is enabled only when at least one candidate is selected, and its label
    carries the count.
20. It calls `POST /repos/:id/conventions/skill`, which **persists nothing**, and opens
    `_components/CreateSkillModal/` prefilled from the returned `ConventionSkillDraft`:
    name, description, type, enabled, and the assembled markdown body.
21. Every field in the modal is editable before anything is saved, including the whole body.
    The modal states that nothing exists until `Create skill` is pressed, and cancelling or
    closing leaves the workspace unchanged — the draft request wrote no row.
22. The modal shows which candidates the body came from (`convention_ids` count) and the
    `evidence_files` the rules were grounded in.
23. Confirm posts the edited fields to `POST /skills/extracted`. The created skill is
    `source: 'extracted'` and arrives **enabled** — unlike an imported file, the user
    accepted every rule inside it one at a time.
24. The modal carries an **optional** agent select over the workspace's agents, defaulting to
    none. Creating a skill without linking is a complete, valid outcome.
25. When an agent is chosen, the modal makes a **second** call after the create succeeds:
    `POST /agents/:id/skills` in its additive single-link form (`{ skill_id }`). If the
    create succeeds and the link fails, the skill is kept and the link error is shown with a
    retry — the create is never rolled back.
26. On success the modal closes with a confirmation offering a link to the new skill in the
    Skills Lab (`/skills?skill=<id>`).
27. A draft request that `422`s (nothing accepted) renders the server's message; the modal
    does not open.

### E. Cross-cutting

28. No component calls `fetch`. Every request goes through `src/lib/api.ts` via
    `src/lib/hooks/conventions.ts`: `useConventions`, `useScanConventions`,
    `useConventionScanEvents`, `usePatchConvention`, `useDeleteConvention`,
    `useConventionSkillDraft`. The extracted-skill create is `useCreateExtractedSkill` in
    `src/lib/hooks/skills.ts` and the additive link is `useLinkAgentSkill` in
    `src/lib/hooks/agent-skills.ts`.
29. `useLinkAgentSkill` is new and **additive**. `useSetAgentSkills` is not used here: it
    replaces the agent's whole ordered set and would silently unlink every other skill the
    agent has. That is the regression this criterion guards.
30. No literal user-facing copy in a component; everything comes from
    `client/messages/en/conventions.json`.
31. Types come from `@devdigest/shared` (`ConventionCandidate`, `ConventionCategory`,
    `ConventionStatus`, `ConventionExtractResult`, `ConventionSkillDraft`). No local
    duplicate of a contract shape, and **no value import from the barrel** — import the
    contract file directly (`@devdigest/shared/contracts/knowledge`); the barrel's `.js`
    specifiers 500 the dev server while typecheck and vitest stay green
    (`client/INSIGHTS.md`, 2026-09-17).
32. The sidebar gains a `Conventions` entry under `SKILLS LAB` with the `g c` shortcut and a
    matching `SHORTCUTS` row. See **Decisions**.

## Components touched

```
src/app/repos/[repoId]/conventions/page.tsx            thin route entry
src/app/repos/[repoId]/conventions/_components/ConventionsView/
                                                       header, scan + progress, summary,
                                                       filter chips, selection, card list
  _components/ConventionCard/                          rule, category, evidence, confidence,
                                                       accept/reject/edit/delete, select
  _components/CreateSkillModal/                        editable draft + optional agent link
src/lib/hooks/conventions.ts                           list / scan / events / patch / delete / draft
src/lib/hooks/skills.ts                                + useCreateExtractedSkill
src/lib/hooks/agent-skills.ts                          + useLinkAgentSkill (additive)
src/vendor/ui/nav.ts                                   + Conventions under SKILLS LAB, + `g c`
client/messages/en/conventions.json                    + filters, scan progress, summary,
                                                       edit, delete-confirm, modal keys
```

Each folder follows the existing colocation rule — `Component.tsx`, `styles.ts`,
`constants.ts`, `helpers.ts`, `index.ts` and a `.test.tsx` beside it. Filtering, counting and
the scan-summary formatting are **pure helpers**, not component code; the
`frontend-ui-architecture` skill governs placement.

## Tests

`pnpm --dir client test` (vitest + jsdom, `fetch` mocked — no API needed):

- `helpers`: status filtering, the per-status counts over the full list, summary formatting
  including a `null` `cost_usd`. Pure, no DOM.
- `ConventionCard`: renders the verified snippet and `path:line`; accept and reject each send
  one patch with the right status and do not touch a sibling card; edit saves `rule` /
  `rationale` / `category` and cancel sends nothing; evidence and confidence expose no
  editable control; delete confirms before posting.
- `ConventionsView`: the three load states; `Run extraction` fires the mutation exactly once
  and never on mount; progress events render in order and `done` seeds the list without a
  second GET; an `error` event keeps the existing cards; filter chips narrow the list and the
  counts stay computed from the full set.
- `CreateSkillModal`: opens only after the draft request resolves and is prefilled from it;
  cancelling performs **no** write; confirm posts the *edited* fields to `/skills/extracted`;
  with no agent selected exactly one request is made; with an agent selected the link is a
  second, additive call and a failed link leaves the created skill in place.
- `Create skill` is disabled with an empty selection.

A green `typecheck` + `test` does **not** prove the app boots — load
`/repos/<id>/conventions` in `pnpm dev` and run one real scan before calling this done
(`client/INSIGHTS.md`).

## Decisions

- **One board per repo, not a global conventions page.** A convention is a property of a
  repository, the evidence is a path inside its checkout, and the scan endpoint is already
  `/repos/:id/...`. A cross-repo list would have to qualify every path and would make the
  scan button ambiguous.
- **One merged `<repo>-conventions` skill per creation, not one per category.** The board
  supports selection, so a user who wants several narrower skills can create them one
  selection at a time. That is a workflow, not a second code path.
- **Selection is separate from `status`.** Accept/reject is triage — a durable judgement the
  server stores and re-scans respect. Selection is ephemeral and local: which of the accepted
  rules go into *this* skill. Collapsing them would mean rejecting a good rule just to keep
  it out of one skill.
- **The scan is a mutation with an SSE stream, not a polled query.** It costs a model call,
  so React Query's refetch-on-focus and retry behaviour would be a bill, not a convenience.
  The stream is replay-first, so a remount re-attaches rather than re-scans.
- **Evidence and confidence are not editable.** The whole feature's claim is that everything
  shown is real code re-read from the file. An editable snippet would let a paraphrase be
  saved as proof and would make the gate decorative.
- **Delete and Reject are both kept.** Reject is permanent suppression — a rejected rule is
  never re-proposed. Delete is a clean-up that the next scan may undo. The confirmation copy
  says so, because the two are otherwise indistinguishable on a card.
- **The agent link is a second client call.** `agent_skills` belongs to `modules/agents`; a
  server-side link from the conventions module would be a cross-module reach. Two requests
  from the client cost one round-trip and no architectural debt.
- **It uses the additive `POST /agents/:id/skills`, never `useSetAgentSkills`.** The set form
  replaces the agent's whole ordered list; using it here would delete the agent's other
  skills as a side effect of linking one.
- **Editing `src/vendor/ui/nav.ts` is a deliberate, recorded exception** to the repo's "do not
  touch `vendor/`" rule. `Sidebar.tsx` imports `NAV` directly and takes no override prop, and
  `@devdigest/ui` has no source in this repo — the mirror *is* the source here. One line,
  recorded because the rule says otherwise.

## Out of scope

- Editing a convention's evidence, or re-running the gate from the UI.
- A scan history / previous-result view, and scan cancellation — the server mints a synthetic
  `scan_id` with no cancel endpoint.
- Bulk accept / reject across the whole board, and keyboard triage shortcuts.
- Per-category skill creation as a distinct flow, and appending to an **existing** skill —
  creation always produces a new skill.
- Editing the created skill's body afterwards: that happens in the Skills Lab.
- Reordering or enabling the linked skill on the agent; the modal links it and stops.
- Frequency counts, counter-examples and contradiction warnings on a card — those depend on
  server work listed as out of scope in `server/.spec/conventions.spec.md`.

## Open questions

- `confidence` is the model's self-report. The bar orders and informs, it never gates. When
  the server replaces it with a real occurrence count, the card's label changes and nothing
  else does.
- `card.acceptAsSkill` in the existing message file describes a one-click accept-and-create
  flow that the three-state triage replaces. Left in the file, unused, rather than deleted
  with the rest of the copy.
- Whether the board should surface rules accepted on *other* repos of the same workspace as
  "already a skill". Deferred with the contradiction check.
- The confidence bar and the category chip use the same palette as the findings severity
  chips; if a scan ever renders beside review findings, that will need disambiguating.
