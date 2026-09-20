# Skills — `server`

## Goal

A **skill** is a reusable block of reviewer instructions (markdown) that lives in the
database, is edited by the user, versioned on every save, and linked to any number of
agents. At review time the enabled skills of an agent are resolved to bodies, concatenated
in the user's order, and injected into the prompt as the `## Skills / rules` section —
visible afterwards in the run trace and the run log as its own block, and attributable
afterwards in the skill's own stats.

A skill is **text only**. It carries no code, no tools, no file access, no execution. The
one thing it can do is change what the model is told.

## Background

Most of this feature is already half-built by the Part-0 starter and must be *filled*, not
invented:

- Tables `skills`, `skill_versions`, `agent_skills` exist (`src/db/schema/skills.ts`,
  `src/db/schema/agents.ts`) and are empty.
- Contracts `Skill`, `SkillType`, `SkillSource`, `AgentSkillLink` exist
  (`src/vendor/shared/contracts/knowledge.ts`).
- The agent side of the link table is already served:
  `GET|POST /agents/:id/skills` (`modules/agents/routes.ts:145`).
- `reviewer-core` already accepts `skills?: string[]` (**resolved bodies, not slugs**) and
  renders them into `## Skills / rules`, recording the block in
  `PromptAssembly.skills` (`reviewer-core/src/prompt.ts:106`).
- The trace UI already renders `prompt_assembly.skills` when it is non-null
  (`client/.../TraceBody.tsx:76`).
- `findings.accepted_at` / `dismissed_at` already exist (`src/db/schema/reviews.ts:48`), so
  an accept rate is computable — what is missing is *which skills a run used*.

Missing: the `skills` module (CRUD, versions, import, tokens, stats), the per-agent
`enabled` flag, per-run skill attribution, the resolution step in `run-executor.ts` (today
every trace is written `skills: null`, `modules/reviews/run-executor.ts:429`), the seed.

## Schema changes

Four, all in `src/db/schema/*.ts`, all landing in **one generated migration**
(`pnpm --dir server db:generate` → `0012_*.sql`, then `db:migrate`). No SQL is written by
hand; `src/db/migrations/**` stays generated output.

| Change | Why |
|---|---|
| `agent_skills.enabled boolean not null default true` | per-agent toggle (the checkbox in the agent's Skills tab) |
| `skill_versions.note text` (nullable) | the change note the Versions tab shows per version |
| `agent_runs.skills_used jsonb` (`$type<string[]>`, nullable) | which skills that run actually included — the only honest basis for the Stats tab |
| `skills_workspace_idx` on `skills.workspace_id` | every list read filters on it; Postgres indexes no FK column on its own (`server/INSIGHTS.md`, 2026-09-17) |

No new table. `SkillSource` gains `imported_file`, which needs **no** migration: the column
is `text(... { enum })`, a TypeScript-level enum with no database CHECK.

## Acceptance criteria

### A. Storage & CRUD

1. `GET /skills` returns every skill of the caller's workspace, newest first, optionally
   narrowed by `?q=` (name/description, case-insensitive) and `?type=`. Each row carries the
   card's footer numbers: `agent_count`, `pull_rate`, `accept_rate` (see F).
2. `GET /skills/:id` returns one skill; a skill of another workspace is `404`, never `403`
   and never a leak.
3. `POST /skills` creates a skill from `{ name, description, type, body, enabled? }`.
   `source` is `manual`, `version` is `1`, `enabled` defaults to `true`.
4. `PUT /skills/:id` patches `name`, `description`, `type`, `body`, `enabled`, `note`.
5. A `PUT` that **changes `body`** snapshots the *previous* body into `skill_versions` at the
   *previous* version with the supplied `note`, then increments `skills.version`. A `PUT`
   that changes only `name` / `description` / `type` / `enabled` does **not** bump it.
6. `DELETE /skills/:id` deletes the skill and, by FK cascade, its versions and every
   `agent_skills` link. Agents that linked it keep working with one fewer skill.
7. Every route is workspace-scoped through `getContext` exactly as `modules/agents` is; the
   integration test proves it with a **second workspace** fixture.
8. `POST /skills/tokens` `{ body }` → `{ tokens }`, counted with the existing tokenizer
   adapter (`src/adapters/tokenizer`). It touches no table — it exists so the editor can
   show an exact live count for an **unsaved** body. A tokenizer failure returns `null`,
   never a 500.

### B. Versions

9. `GET /skills/:id/versions` returns the history newest first —
   `{ version, note, created_at, is_current }` — with the **current** body's row synthesised
   from `skills` itself, so the list matches the "5 versions" the UI shows for a `v5` skill.
   A version's `note` and `created_at` describe **that version** — the note supplied when it
   was produced and the moment it became current. Storage keeps the note on the snapshot of
   the version it *replaced* (criterion 5), so the read side shifts it one step: v(n)'s note
   comes from the snapshot of v(n-1). v1 has no note.
10. `GET /skills/:id/versions/:version` returns that version's body.
11. `POST /skills/:id/versions/:version/restore` makes an old body current the same way an
    edit does: snapshot the current body, bump the version, set `note` to
    `Restored v<n>`. Restoring never deletes or rewrites history — `v5` restored from `v3`
    becomes `v6`.
12. Diffing is a **read** concern: the client fetches two bodies and diffs them. The server
    ships no diff endpoint and no diff algorithm.

### C. Import

13. `POST /skills/import/preview` accepts `{ filename, content_base64 }` and returns a
    `SkillImportPreview` — it **writes nothing to the database**.
14. A `.md` / `.markdown` payload is taken whole as the body, **minus its YAML front
    matter**: those scalars are consumed for `name` / `description` / `type` (criterion 16),
    so leaving them in the body would render as an artifact in the preview and reach the
    model as prompt bytes. A payload without front matter is kept byte-for-byte.
15. A `.zip` payload is unpacked in memory. The **core** of the skill is, in order:
    `SKILL.md` at the archive root, else `README.md` at the root, else the shallowest,
    alphabetically-first `*.md`. Everything else is listed in `ignored` with a reason and is
    **never read into the body, never written to disk, never executed**.
16. `name` and `description` are derived from YAML front matter (`name:`, `description:`
    top-level scalars only — no YAML dependency, no anchors, no nesting), falling back to the
    first `# heading` and the first paragraph after it, falling back to the file name.
17. The parser refuses, with a `400` carrying a human-readable reason and no partial state:
    a payload over 1 MiB (`.md`) or 5 MiB (`.zip`); an archive over 10 MiB uncompressed,
    over 200 entries, or containing a nested archive; any entry path that is absolute or
    escapes the root (`..`) — zip-slip; an archive with no markdown file at all.
18. `POST /skills/import` creates the skill from the **confirmed, possibly user-edited**
    fields of the preview. `source` is `imported_file` and `enabled` is **`false`** — an
    imported skill is inert until the user vets it and turns it on.
19. Nothing in the import path shells out, spawns a process, or touches the filesystem.
    Entries such as `*.sh`, `*.js`, `*.py`, `Makefile`, `install*` and any binary are
    reported in `ignored` with `reason: "executable"` and dropped.

### D. Linking to an agent

20. `GET /agents/:id/skills` returns the linked skills **ordered by `order`**, each carrying
    `{ skill_id, order, enabled, name, description, type, version, skill_enabled }` — one
    request, no N+1 on the client. `skill_enabled` is the skill's own global flag, so the UI
    can show a globally-disabled skill as such (the second gate, `link.enabled &&
    skill.enabled`, stays legible).
21. `POST /agents/:id/skills` accepts `{ items: [{ skill_id, enabled? }] }` — the whole
    ordered set, array index becomes `order`. The existing `{ skill_ids }` and
    `{ skill_id }` bodies keep working (`skill_ids` means "all enabled").
22. Replacing the set **preserves** the `enabled` flag of a link that is still present.
    (Today `setSkills` deletes then re-inserts — `modules/agents/repository.ts:229` — which
    would silently re-enable every skill; that is the regression this criterion guards.)
23. `PUT /agents/:id/skills/:skillId` patches `{ enabled?, order? }` of one link, so the
    checkbox in the UI is one small request.
24. Linking a skill from another workspace is `404`.

### E. Prompt assembly — the payoff

25. Before a review, `run-executor` resolves the agent's skills to bodies: linked **and**
    `agent_skills.enabled` **and** `skills.enabled`, ordered by `order`, then name.
26. Each resolved body is prefixed with `### <skill name>` so the assembled block is
    readable in the trace and each skill is attributable.
27. The resolved bodies are passed as `skills` to `reviewPullRequest`. With ≥1 resolved
    skill, `run_traces.trace.prompt_assembly.skills` is non-null and contains every included
    skill's name; with 0, it stays `null` and the user prompt has **no** `## Skills / rules`
    section — byte-identical to today's prompt.
28. The run records `agent_runs.skills_used` = the ordered ids it actually included (`[]`
    when none, never `NULL` for a completed run). Failed and cancelled runs may leave it
    `NULL`.
29. The run log gets one `info` line per included skill —
    `skill: <name> v<version> (~<n> tokens)` — and one summary line,
    `skills: <k> of <m> linked enabled → ~<n> tokens`. A disabled or unlinked skill produces
    **no** log line and **no** prompt bytes. This pair (log line + trace block) is the
    on-camera proof.
30. A tokenizer failure degrades to omitting the `~n tokens` suffix, never to failing the run.
31. Skill bodies are injected as **instructions**, not as `<untrusted>` data — that is what a
    skill is for. The mitigations are editorial, not syntactic: imported skills arrive
    disabled, the preview shows the exact body before it is saved, and the UI marks a
    non-`manual` source as untrusted. This is a deliberate, documented trade-off.

### F. Stats

All stats are **attributed per run** through `agent_runs.skills_used`, over a 30-day window,
scoped to the workspace. A skill that has never been in a run returns zeros, never `NaN` and
never `null` tiles.

32. `GET /skills/:id/stats` returns:
    - `agent_count` — agents currently linking the skill (any `enabled`).
    - `pull_rate` — runs whose `skills_used` contains the skill ÷ runs of the agents that
      link it, in the window. Inclusion is deterministic today, so this reads ~100% unless
      the skill was toggled off inside the window; it is an honest *"included in"* number,
      not a retrieval score.
    - `accept_rate` — `accepted / (accepted + dismissed)` over the findings of the reviews of
      those runs.
    - `findings_30d` — findings produced by those runs.
    - `agents` — `[{ id, name }]`, the "Agents using this skill" list.
    - `by_category` — `[{ category, count }]` over the same findings, the donut's data.
33. Attribution is at **run** granularity, not finding granularity: a finding is counted for
    every skill that was in that run's prompt. The response says so in its doc comment, and
    the UI labels the tiles accordingly — we are not claiming a finding was caused by one
    skill.
34. `GET /skills` computes `agent_count`, `pull_rate` and `accept_rate` for the whole list in
    **two** queries (one grouped over links, one grouped over runs+findings), never one
    query per card.

### G. Seed

35. The seed adds one agent, **Test Quality Reviewer** (prompt in
    `docs/agent-prompts/test-quality-reviewer.md`, mirrored into `src/db/seed-prompts.ts`
    like the other three), with `strategy: 'single-pass'` and `ci_fail_on: 'critical'`.
36. The seed adds four skills, all `source: 'manual'`, `enabled: true`, `version: 1`:
    `test-coverage-gaps` (rubric), `test-corner-cases` (rubric), `no-over-mocking`
    (convention), `api-contract-gate` (custom).
37. The first three are linked to Test Quality Reviewer in that order; `api-contract-gate`
    is linked to the existing General Reviewer with `enabled: false`, so the API-contract
    control experiment is one checkbox away.
38a. The seed fabricates **no** runs, findings or reviews. A fresh workspace shows zeros in
    every stat until real reviews run — honest zeros, not demo data.
38. `flaky-test-patterns` is deliberately **not** seeded — it ships as
    `docs/skills/flaky-test-patterns.zip` and is imported live through the UI.
39. The seed is idempotent: re-running it neither duplicates a skill nor re-enables one the
    user turned off (match on `workspace_id` + `name`, insert only when absent — the existing
    agent pattern, `src/db/seed.ts:218`).

## Contracts touched

`src/vendor/shared/contracts/knowledge.ts` (the **only** place they are edited; every
`vendor/` copy is a mirror):

- `SkillSource` — add `imported_file` (labelled "Imported" in the UI, like `imported_url`).
- `Skill` — add `created_at: z.string()` and `tokens: z.number().int().nullish()` (exact
  count of the saved body; `null` when the tokenizer is unavailable).
- `SkillListItem` = `Skill` + `{ agent_count, pull_rate, accept_rate }` — the `GET /skills`
  row that feeds the card footer.
- `SkillVersionEntry` = `{ version, note: z.string().nullish(), created_at, is_current }`.
- `SkillStats` = `{ agent_count, pull_rate, accept_rate, findings_30d, agents: [{id,name}],
  by_category: [{category, count}] }`.
- `AgentSkillLink` — add `enabled: z.boolean()`.
- `AgentLinkedSkill` = `AgentSkillLink` + `{ name, description, type, version, skill_enabled }`.
- `SkillImportPreview` = `{ name, description, type, body, source, truncated: boolean,
  ignored: Array<{ path, reason: 'executable' | 'binary' | 'not-markdown' | 'nested-archive' }> }`.
- `RunSummary` / `RunTrace` are **not** extended with `skills_used`; the trace already
  carries the assembled block. Any future field on `RunStats` must be **nullish**, never
  nullable (`server/INSIGHTS.md`, 2026-09-17).

Request bodies (`CreateSkillBody`, `UpdateSkillBody`, `ImportPreviewBody`,
`ConfirmImportBody`, `SetAgentSkillsBody`, `TokensBody`) live in the module and drive both
validation and serialization — never a hand-written second response shape.

## Code layout

```
src/modules/skills/
  routes.ts        /skills, /skills/:id, /skills/:id/versions[/:v][/restore],
                   /skills/:id/stats, /skills/import/preview, /skills/import, /skills/tokens
  service.ts       versioning on body change, restore, import confirm, token count
  repository.ts    skills + skill_versions data access, workspace-scoped
  stats.ts         the two grouped stat queries (list) + the per-skill one
  import.ts        PURE: bytes + filename → SkillImportPreview | ImportError
  constants.ts     size/entry caps, executable extensions, core-file precedence, 30d window
src/modules/_shared/agent-skills.ts
                   resolveAgentSkills(db, agentId) → ordered {id, name, version, body}[]
                   read by modules/reviews; keeps reviews from importing the skills service
```

Registered with one import + one entry in `modules/index.ts`. `modules/agents` keeps
ownership of the agent side of the link table and gains the `enabled` handling.
`pnpm --dir server arch` must not raise the warning count (`server/INSIGHTS.md`, 2026-09-20).

## Dependencies

One new runtime dependency: **`fflate`** (zip inflate, pure JS, no native build) — Node has
no zip support built in, only gzip. `pnpm --dir server add fflate`; the lockfile that run
rewrites is committed as-is.

## Tests

Hermetic (no Docker, no network):
- `test/skills-import.test.ts` — markdown passthrough; front-matter and heading derivation;
  zip core-file precedence; executables and binaries land in `ignored`, never in the body;
  zip-slip, entry-count, size and nested-archive refusals; an archive with no markdown.
- `test/agent-skills-resolve.test.ts` — ordering, the `link.enabled && skill.enabled` gate,
  the `### <name>` prefix, the empty case returning `[]`.
- `test/skills-stats.test.ts` — the rate arithmetic on fixture rows: zero runs → zeros, no
  accepted/dismissed finding → `accept_rate: 0`, never a divide-by-zero.

DB-backed:
- `test/skills.it.test.ts` — CRUD; version-on-body-change and the *absence* of a bump on a
  metadata-only patch; the note; restore producing `v6` from `v3`; version history including
  the synthesised current row; delete cascading to links; cross-workspace 404s from a
  two-workspace fixture; link set/reorder **preserving** `enabled` (criterion 22); the
  single-link `PUT`.
- `test/skills-stats.it.test.ts` — stats over seeded runs/findings, including a run of an
  agent that links the skill but had it disabled (counts in the denominator, not the
  numerator).
- `test/reviews.it.test.ts` (extend) — a run whose agent has two enabled skills and one
  disabled writes a trace whose `prompt_assembly.skills` names exactly the two and a
  `skills_used` of exactly those two ids; a run with no enabled skill writes `null` / `[]`.
- `test/routes-smoke.test.ts` — the new routes are registered.

## Out of scope

Evals against a skill — no route, no contract, no UI. `eval_cases.owner_kind = 'skill'`
exists and stays empty; that is a separate lesson. Import from URL
and the community catalog. Skill extraction from a repo (`source: 'extracted'`). The CI
runner's filesystem skills (`.devdigest/skills/<slug>.md`, `contracts/eval-ci.ts:157`) —
unchanged; only the studio path resolves skills from the DB. Semantic selection of skills per
diff — every enabled linked skill is always included. Cost attribution per skill.

## Open questions

- Changing an agent's skill links does not bump `agents.version`, yet
  `AgentVersionConfig.skills` snapshots the ordered ids. Left as-is: links are edited far
  more often than config, and a version per checkbox would drown the history. The snapshot
  therefore reflects the links as of the last *config* change.
- `pull_rate` is ~100% by construction until skills are selected dynamically. Kept because
  the tile is in the design and the number is real; it becomes meaningful in the retrieval
  lesson.
- `skills.evidence_files` stays unused (it belongs to the extraction lesson).
- No per-skill token budget. Four skills of ~400 tokens are fine; a workspace that links
  twenty will notice, and the summary log line is the only warning.
