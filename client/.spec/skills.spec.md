# Skills — `client`

## Goal

Two surfaces. A **Skills Lab** page — a card list on the left, a four-tab skill editor on
the right (Config · Preview · Stats · Versions) — and a **Skills tab** in the agent
editor where skills are linked, enabled per agent and reordered, because that order is the
order of the blocks in the assembled prompt.

Server contract: `server/.spec/skills.spec.md`.

## Background

- `client/messages/en/skills.json` already exists, written for the full product — page,
  drawer, file import, list item, preview copy. Reuse it; add the keys the new tabs need.
  The URL-import and community keys stay unused (out of scope).
- `activeKeyFor` already maps `/skills` to the `skills` sidebar key
  (`src/components/app-shell/helpers.ts:33`) — the route was anticipated, the nav entry was
  not shipped.
- The agent editor renders a single `Config` tab from a `TABS` constant explicitly marked
  "later lessons add Skills/Evals/Stats/CI"
  (`src/app/agents/[id]/_components/AgentEditor/constants.ts`) — the same `Tabs` primitive
  the skill editor uses.
- `AgentCard` already renders a skill count when given one (`AgentCard.tsx:66`) — it is
  currently never passed.

## Acceptance criteria

### A. `/skills` — two panes

1. The route is a two-pane layout inside `AppShell`: a fixed-width left column (heading,
   `Add Skill` dropdown, search, card list) and the editor filling the rest. Breadcrumb
   `Skills Lab › Skills`.
2. A card renders: name in mono, enabled toggle, description clamped to two lines, a type
   badge (`rubric` / `convention` / `security` / `custom`, colour per type) and a source
   badge with icon (`Manual` / `Extracted` / `Community` / `Imported`), then a footer line
   `N agents · X% pull · Y% accept` from the list response.
3. The selected card is visually selected; selection lives in `?skill=<id>`, so a reload or
   a shared link restores both the skill and the tab.
4. Search filters name and description client-side, case-insensitive.
5. The card toggle writes `enabled` optimistically (rolled back on error) and does **not**
   change the selection.
6. `Add Skill` is a dropdown with exactly two items: **Create from scratch** and **Import
   from file**. The URL / community entries in the message file are not rendered.
7. Loading renders skeletons, failure `ErrorState` with retry, an empty workspace
   `EmptyState` with the create CTA. With no skill selected the right pane shows
   `page.selectPrompt`.
8. A skill whose `source` is not `manual` shows the untrusted badge on the card and the
   `preview.untrustedNotice` banner in the editor header area.

### B. Editor shell

9. The editor header carries the skill name in mono, the type badge and a `v{version}` chip.
   The design's `Run on evals` button is **not rendered** — evals are out of scope (see
   **Decisions**).
10. Tabs: `Config`, `Preview`, `Stats`, `Versions`, state in `?tab=`. An unknown `?tab=`
    falls back to `Config`.
11. Switching skills keeps the active tab.

### C. Config tab

12. Fields: `Name *`, `Description`, `Type` (select over the four `SkillType` values),
    `Skill body *`. A `v{version}` chip sits beside the section heading and the global
    `Enabled` toggle sits at its right.
13. The description field carries a hint saying the description is the skill's *interface* —
    it tells the agent when the skill applies — phrased in the imperative. Required copy.
14. The body editor is a monospace textarea with a line-number gutter, inside a framed panel
    whose header shows `<name>.md`, an `unsaved` badge while the form is dirty, and the live
    token count.
15. The token count is exact, not estimated: a debounced (400 ms) `POST /skills/tokens` on
    the current body. While in flight the previous count stays; on failure the count is
    hidden, never `NaN`.
16. Save is disabled while nothing changed and while a request is in flight. A save that
    changed the body asks for a one-line change note (the note the Versions tab shows),
    prefilled and skippable.
17. After a body save the `v{version}` chips increment and the `unsaved` badge clears.
18. Deleting a skill asks for confirmation and states that it will be unlinked from every
    agent.

### D. Preview tab

19. Renders the **saved or currently edited** body as markdown through the existing
    `Markdown` primitive, under the heading `Preview` and the line
    "Rendered as the reviewing agent receives it."
20. A dirty body previews the edited text, so the tab answers "what am I about to save".

### E. Stats tab

21. Four tiles: `USED BY` (N agents), `PULL FREQUENCY` (%), `ACCEPT RATE` (% with the
    existing `CircularScore`), `FINDINGS (30D)` (count) — from `GET /skills/:id/stats`.
22. `AGENTS USING THIS SKILL` lists the agents with an `Open` link to `/agents/:id?tab=skills`.
23. `FINDINGS BY CATEGORY` is a donut (recharts, already a dependency) with a legend of
    `category → count`. **Counts, not currency** — the mock's `$` figures are placeholder
    data.
24. Each rate tile carries a one-line caption naming the attribution: the numbers are per
    **run**, over 30 days. No tile implies a finding was caused by one skill.
25. A skill never used renders the tiles as zeros and the two panels as empty states, not as
    an error. The seed fabricates no runs, so this is the state the demo **starts** in and
    must read as "no data yet".

### F. Versions tab

26. Heading `Version history` with a `{n} versions` chip and the line explaining that every
    save snapshots the body, so a past review can be read against the exact text it ran on.
27. Each row: `v{n}` chip, note, date. The current version is badged `Current` and has no
    actions; every older row has `Diff` and `Restore`.
28. `Diff` opens a line-level diff of that version against the current body, additions and
    deletions marked by symbol **and** colour. The diff is computed client-side in
    `helpers.ts` (a small LCS line diff — **no new dependency**).
29. `Restore` confirms, posts the restore, and lands the user back on `Config` with the
    restored body current and the version chip bumped (restore creates a new version; it
    never rewrites history).

### G. Agent editor — Skills tab

30. `TABS` gains `skills` after `config` (`editor.tabs.skills`), at `/agents/:id?tab=skills`.
31. The tab lists **linked** skills in `order`: drag handle, checkbox (`enabled`), name in
    mono, type badge. Header reads `N of M enabled` with a filter input, plus the one-line
    hint that order matters — earlier skills appear earlier in the assembled prompt.
31a. A row whose skill has `skill_enabled = false` renders muted with a `disabled globally`
    caption linking to `/skills?skill=<id>`; its checkbox stays clickable (the per-agent flag
    is independent of the global one).
32. The checkbox writes `PUT /agents/:id/skills/:skillId` optimistically.
33. Rows reorder by drag (native HTML5 `draggable` — **no new dependency**) and, for keyboard
    and a11y, by `Alt+↑` / `Alt+↓` on a focused row. A reorder posts the whole ordered set
    carrying each row's current `enabled`, so a reorder never silently re-enables a skill.
34. An `Add skill` control links an existing workspace skill (a searchable select over the
    unlinked ones); a row menu unlinks.
35. An agent with no linked skills renders an `EmptyState` linking to `/skills`.
36. `AgentCard` on `/agents` receives `skillCount`, so the existing `card.skillCount` copy
    finally renders.

### H. Import

37. Import opens a drawer: a file input accepting `.md`, `.markdown`, `.zip`, then a
    **preview step** — name, description, type, the extracted body, and, for an archive, the
    ignored entries with their reason.
38. Nothing is saved until the user confirms. Cancelling or closing leaves the workspace
    unchanged: the preview request is `POST /skills/import/preview`, only the confirm posts
    `/skills/import`.
39. Name, description and type are editable in the preview step.
40. The drawer states that the body becomes the agent's instructions and that an imported
    skill arrives **disabled** until vetted.
41. Ignored entries are labelled by reason; the executable ones say plainly they were not
    read and not run.
42. A rejected import (too large, zip-slip, no markdown) renders the server's message inline;
    the drawer stays on the file step.

### I. Cross-cutting

43. The sidebar gains a `SKILLS LAB` section with `Skills` above `Agents` (icon `Sparkles`,
    `g s`) plus the matching `SHORTCUTS` row. See **Decisions**.
44. No component calls `fetch`; every request goes through `src/lib/api.ts` via a hook in
    `src/lib/hooks/skills.ts`. No literal user-facing copy in a component.
45. Types come from `@devdigest/shared` (`Skill`, `SkillListItem`, `SkillStats`,
    `SkillVersionEntry`, `AgentLinkedSkill`, `SkillImportPreview`). No local duplicate of a
    contract shape. A **value** import from the barrel is forbidden — import the contract
    file directly (`@devdigest/shared/contracts/knowledge`); the barrel's `.js` specifiers
    500 the dev server while typecheck and vitest stay green (`client/INSIGHTS.md`,
    2026-09-17).

## Components touched

```
src/app/skills/page.tsx                            thin route entry
src/app/skills/_components/SkillsLabView/          two-pane layout, selection, ?skill=/?tab=
  _components/SkillList/                           search + cards
    _components/SkillCard/                         badges, toggle, footer stats
  _components/SkillEditor/                         header + Tabs + tab bodies
    _components/ConfigTab/                         fields + BodyEditor + save/note
      _components/BodyEditor/                      gutter, filename chip, unsaved, tokens
    _components/PreviewTab/
    _components/StatsTab/                          tiles, agents panel, category donut
    _components/VersionsTab/                       history rows, DiffDialog, restore
  _components/CreateSkillModal/
  _components/ImportSkillDrawer/                   file step → preview step → confirm
src/app/agents/[id]/_components/AgentEditor/
  constants.ts                                     + { key: "skills" }
  _components/SkillsTab/                           rows, checkbox, reorder, link/unlink
src/app/agents/_components/AgentsListView/         pass skillCount to AgentCard
src/lib/hooks/skills.ts                            useSkills, useSkill, useSkillStats,
                                                   useSkillVersions, useSkillVersionBody,
                                                   useRestoreSkillVersion, useSkillTokens,
                                                   useCreate/Update/DeleteSkill,
                                                   useImportPreview, useImportSkill,
                                                   useAgentSkills, useSetAgentSkills,
                                                   useUpdateAgentSkill
src/vendor/ui/nav.ts                               + SKILLS LAB section, + `g s`
client/messages/en/skills.json                     + editor/tabs/stats/versions/diff keys
client/messages/en/agents.json                     + editor.tabs.skills + SkillsTab copy
```

Each folder follows the existing colocation rule — `Component.tsx`, `styles.ts`,
`constants.ts`, `helpers.ts`, `index.ts`, and a `.test.tsx` beside it. The
`frontend-ui-architecture` skill governs placement; the line diff and the reorder function
are pure helpers, not component code.

## Tests

`pnpm --dir client test` (vitest + jsdom, `fetch` mocked — no API needed):

- `SkillCard`: badges per type/source; untrusted badge only for a non-`manual` source; the
  toggle fires the mutation and does not change selection.
- `SkillList` / `SkillsLabView`: search filtering; the three states; the add dropdown offers
  exactly the two in-scope items; `?skill=`/`?tab=` round-trip.
- `ConfigTab` + `BodyEditor`: save disabled when unchanged; dirty shows `unsaved`; the token
  request is debounced and its failure hides the count instead of rendering `NaN`; a body
  save sends the note.
- `PreviewTab`: previews the **edited** body, not the saved one.
- `StatsTab`: a never-used skill renders zeros and empty panels; the donut gets counts.
- `VersionsTab`: `Current` row has no actions; diff marks additions and deletions; restore
  confirms before posting.
- `SkillsTab` (agent): `N of M enabled` counts links, not workspace skills; checkbox posts
  the single-link patch; `Alt+↓` reorders and the resulting POST carries every row's
  `enabled` (the regression guard for criterion 33); empty state.
- `ImportSkillDrawer`: choosing a file calls only the *preview* endpoint; ignored entries
  render with their reason; cancel performs no write; confirm posts the edited fields.
- `helpers`: filter, reorder and the line diff, pure, no DOM.

A green `typecheck` + `test` does **not** prove the app boots — load `/skills` and
`/agents/:id?tab=skills` in `pnpm dev` before calling this done (`client/INSIGHTS.md`).

## Decisions

- **The body editor is a textarea with a gutter, not a code editor.** The mock shows
  syntax-coloured markdown; CodeMirror/Monaco is a heavy dependency for a field that is
  saved, previewed on the next tab, and rendered by the agent as plain text. Line numbers,
  monospace, filename chip, `unsaved` badge and the exact token count all ship; colouring
  does not.
- **The `$` figures in the Stats donut are mock data.** Findings are counted, not priced;
  cost per skill is not attributable with what we store.
- **No evals here at all.** The design's `Evals` tab and `Run on evals` button are dropped,
  not rendered disabled: evals are a separate lesson with their own tables, and a dead
  control in the header is noise on camera. The tab strip is four tabs wide; adding the
  fifth later is one entry in `TABS`.
- **The sidebar entry means editing `src/vendor/ui/nav.ts`, which `AGENTS.md` lists under
  "do not touch".** `Sidebar.tsx` imports `NAV` directly and takes no override prop, and
  `@devdigest/ui` has no source in this repo — the mirror *is* the source here. A deliberate
  one-line exception, recorded because the rule says otherwise.
- **Drag reorder uses native HTML5 drag**, not `dnd-kit`. Six rows do not justify a
  dependency, and the keyboard path (`Alt+↑/↓`) is the accessible one either way.
- **The editor is a pane, not a route.** `skills.json` carries `detail.*` copy for a
  `/skills/:id` page; the design puts the editor beside the list, so `/skills/:id` is not
  built and that copy stays unused. Deep-linking is served by `?skill=&tab=`.

## Out of scope

Evals — no tab, no `Run on evals`. Import from URL, the community catalog, skill
extraction. Editing a skill body from inside the agent's Skills tab — that tab links,
toggles and orders; the body is edited in the Skills Lab.
