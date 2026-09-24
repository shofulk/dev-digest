# Skills — implementation plan

Order of work for the skills feature. The contracts live in the specs and are not repeated
here:

- `server/.spec/skills.spec.md` — storage, versions, import, prompt assembly, stats, seed
- `client/.spec/skills.spec.md` — Skills Lab (list + 5-tab editor), import drawer, agent
  Skills tab

**What a skill is:** a reusable markdown block of reviewer instructions, stored in the DB,
edited and versioned in the UI, linked to any number of agents, and injected into the prompt
in the user's order. Text only — no tools, no code, no execution.

## What already exists

Roughly half of this feature is carved out of the starter rather than missing:

| Piece | State |
|---|---|
| `skills`, `skill_versions`, `agent_skills` tables | exist, empty |
| `Skill` / `SkillType` / `SkillSource` / `AgentSkillLink` contracts | exist |
| `GET\|POST /agents/:id/skills` | served (`modules/agents/routes.ts:145`) |
| `reviewer-core` `skills: string[]` → `## Skills / rules` | done (`reviewer-core/src/prompt.ts:106`) |
| `PromptAssembly.skills` in the trace + its UI block | done (`TraceBody.tsx:76`) |
| `findings.accepted_at` / `dismissed_at` (accept rate) | exist (`schema/reviews.ts:48`) |
| `/skills` sidebar active-key mapping | done (`app-shell/helpers.ts:33`) |
| `messages/en/skills.json` | written, unused |

Missing: the `skills` module, `agent_skills.enabled`, per-run skill attribution, the
resolution step in `run-executor.ts` (today every trace is written `skills: null`), the UI,
the seed.

## Migrations

Yes — one, and it is **generated, never hand-written**. `src/db/migrations/**` is drizzle-kit
output; the source of truth is `src/db/schema/*.ts`. Edit the schema, then:

```
pnpm --dir server db:generate   # writes 0012_*.sql
pnpm --dir server db:migrate    # applies it (the server never migrates on boot)
```

Four changes ride in that one migration: `agent_skills.enabled`, `skill_versions.note`,
`agent_runs.skills_used`, and `skills_workspace_idx`. **No new table** — the tables were all
shipped empty by design. `SkillSource += 'imported_file'` needs no migration at all: the
column is `text(… { enum })`, a TypeScript-level enum with no database CHECK.

## Phases

Each phase ends green on `pnpm --dir <pkg> test && typecheck && lint`; the server phases also
on `pnpm --dir server arch` (the warning count must not rise).

**0 — Spec sync.** Fold the confirmed decisions into the specs: honest zeros (no
synthetic runs), Diff + Restore in Versions, `SKILLS LAB` sidebar section, and the
`disabled globally` row in the agent's Skills tab.

**1 — Schema + contracts.** The four schema changes above + `db:generate`/`db:migrate`. New
and extended contracts in `server/src/vendor/shared` only (`SkillListItem`, `SkillStats`,
`SkillVersionEntry`, `AgentLinkedSkill`, `SkillImportPreview`, `Skill.tokens`,
`AgentSkillLink.enabled`), mirrored into `client/src/vendor/shared`.

**2 — Skills module: CRUD + versions + tokens.**
`src/modules/skills/{routes,service,repository,constants}.ts` registered in
`modules/index.ts`. Body-change versioning with a note, restore-as-new-version, the
synthesised current row in the history, `POST /skills/tokens`. `skills.it.test.ts` with a
two-workspace fixture.

**3 — Import.** `pnpm --dir server add fflate`. `import.ts` as a **pure** function
(bytes + filename → preview | error) with the whole unit suite against it, then the two
routes on top. Caps, zip-slip, executable entries dropped and reported.

**4 — Agent linking.** `enabled` through `modules/agents`: the ordered `items` body, the
single-link `PUT`, and the `setSkills` fix that preserves `enabled` across a reorder
(delete-then-insert loses it today, `modules/agents/repository.ts:229`).

**5 — Prompt assembly.** `modules/_shared/agent-skills.ts` resolves ordered enabled bodies;
`run-executor.ts` passes them to `reviewPullRequest`, writes `agent_runs.skills_used`, and
logs the per-skill and summary lines. Extend `reviews.it.test.ts`. **This is the phase the
whole feature is for** — everything before it is plumbing.

**6 — Stats.** `stats.ts`: the per-skill endpoint and the two grouped queries behind the list
rows. Needs phase 5, because every number is attributed through `skills_used`.

**7 — Seed.** `docs/agent-prompts/test-quality-reviewer.md` + its mirror in
`seed-prompts.ts`; the Test Quality Reviewer agent; `test-coverage-gaps`,
`test-corner-cases`, `no-over-mocking` linked to it in that order; `api-contract-gate`
linked to General Reviewer, disabled. Idempotent.

**8 — Client: Skills Lab shell.** Hooks, two-pane layout with `?skill=&tab=`, card list with
badges and footer stats, create modal, delete, global toggle, sidebar entry (the documented
`vendor/ui/nav.ts` exception).

**9 — Client: Config + Preview tabs.** Fields, the gutter body editor with filename chip /
`unsaved` badge / debounced exact token count, the change-note save, the rendered preview.

**10 — Client: Versions tab.** History rows, the client-side line diff, restore.

**11 — Client: Stats tab.** Four tiles, the agents panel, the category donut (recharts,
already a dependency), attribution captions, zero-state.

**12 — Client: import drawer.** File step → preview step → confirm, ignored entries with
reasons, nothing written before confirm.

**13 — Client: agent Skills tab.** Checkbox, drag + `Alt+↑/↓` reorder, link/unlink,
`N of M enabled`, `skillCount` on `AgentCard`.

**14 — Demo assets + docs.** `docs/skills/flaky-test-patterns.zip` — a skill archive that
deliberately contains an `install.sh` and a binary, so the import preview has something to
ignore on camera. Update `server/README.md` and `client/README.md` route maps, and both
`INSIGHTS.md` files via the `engineering-insights` skill.

Phases 1–5 are strictly sequential; 6 and 7 need 5 and 4. 8–13 need 1–4 and can be built
against the running API; 10/11 need 2/6, and 13 needs 4.

## Control experiments

Two PRs prepared in a scratch repo, each run twice — skills off, then on. The delta is the
deliverable; the trace's prompt-assembly section shows the skills block and the added tokens.

1. **Test Quality.** A PR adding a function with an error branch plus a test that covers only
   the happy path. Without skills, Test Quality Reviewer passes it. With `test-coverage-gaps`
   + `test-corner-cases` enabled, it flags the uncovered branch and the boundary case.
2. **API contract.** A PR changing a route's response shape (a field renamed, a status
   changed) with callers untouched. Without skills, General Reviewer passes it. With
   `api-contract-gate` enabled, it reports the breaking change.

Same agent, same model, same diff both times — only the checkbox moves. Run each side twice
and keep the pair that reproduces; a single run of a stochastic model proves nothing.

## Final checklist

- [ ] `pr-self-review` exists with auto-invoke off, is run by hand, and visibly pulls both
      the frontend and the backend skills for the touched files.
- [ ] A skill is created and edited entirely in the UI, and the edit shows up as a new
      version with its note.
- [ ] Test Quality Reviewer has its skills linked; at least one of them arrived through the
      import path.
- [ ] An enabled skill appears in the run log and the trace as its own block; a disabled one
      leaves no trace and no prompt bytes.
- [ ] The import went through a preview, and the archive's executable entries were listed as
      ignored — never read, never run.
- [ ] Both control experiments reproduce.

## Trust note (for the recording)

A third-party skill is third-party instructions inside your agent's prompt. The product does
not pretend otherwise: an imported skill lands **disabled**, its full body is shown before it
is saved, its card is badged as an untrusted source, and only the executable parts of an
archive are refused — the text is the point. The gate is the person reading the preview.
