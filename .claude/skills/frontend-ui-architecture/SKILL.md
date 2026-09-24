---
name: frontend-ui-architecture
description: >-
  UI architecture and code organization for React and Next.js codebases — where components,
  constants, helpers, hooks and business logic belong, how to split a component, how to draw the
  server/client boundary, and how to enforce import rules. Use this whenever the task is about
  structure rather than behavior: deciding where a new file goes, naming a folder, "should this be
  a hook or a plain function", "where do I put this constant", reviewing a PR for layering or
  boundary violations, setting up or reorganizing a project's folders, splitting a component that
  grew too large, moving logic out of a component, choosing between feature folders and flat
  folders, deciding whether something needs 'use client', or writing/updating a project's own
  architecture conventions. Also use it when someone asks "where should this live?", "is this the
  right place for this?", "how should I structure this?", or proposes a `utils/`, `helpers/`,
  `services/` or `lib/` folder. This skill deliberately does NOT cover render performance,
  memoization, bundle size or Core Web Vitals — it answers placement and boundary questions only.
version: 1.0.0
---

# UI architecture for React / Next.js

Architecture questions rarely have one right answer, and the most common failure mode is stating a
personal preference as if the framework required it. This skill exists to keep that from happening:
it separates the rules that are actually specified by React, Next.js or TypeScript from the rules
that are merely popular, and it names the places where no authority exists at all.

Read `README.md` in this skill's directory for the full source list. Every claim below traces to a
source there.

## How to use this

Three levels of authority. Keep them apart when you speak to the user, because conflating them is
how a preference becomes a fake requirement.

- **SPECIFIED** — React/Next.js/TypeScript documentation, RFCs, or a tool's own rule docs say so.
  Violating it breaks the build, breaks the runtime, or creates a security hole. State it as fact.
- **CONVENTION** — widely used, sometimes near-universal, but no official source backs it.
  Recommend it, say it is a convention, and defer to whatever the project already does.
- **UNSPECIFIED** — nothing authoritative exists. Say so, then help the project decide and write
  it down. Do not invent a rule and present it as best practice.

When a codebase already has a consistent answer, that answer wins over anything in the CONVENTION
or UNSPECIFIED tiers. Consistency is worth more than any particular choice, and Next.js says as
much: "choose a strategy that works for you and your team and be consistent across the project."

## The rules worth knowing by heart

These come up constantly. The rest is in `references/`.

**Folder names mean nothing to the framework.** `components/`, `lib/`, `utils/`, `hooks/` are
"generalized placeholders, their naming has no special framework significance" (Next.js). So there
is no such thing as the correct name for a folder — only a consistent one.

**Colocation is the default; distance must be earned.** Put code next to what uses it, and promote
it upward only when a second consumer appears. In `app/`, colocation is safe: a folder is not
routable until it contains `page`/`route`, so project files can live inside route segments.

**Split components by responsibility and data shape, not by layer.** React's criteria are "a
component should ideally only be concerned with one thing" and "each component matches one piece of
your data model". There is no official line-count rule, and no official source anywhere recommends
a standing container/presentational split — modern React routes shared stateful logic to custom
hooks instead. See `references/component-splitting.md`.

**`'use client'` is a boundary in the module graph, not a label saying where code runs.** One
directive at the entry to a client subtree is enough; everything it imports ships to the browser.
The architectural consequence is that the directive belongs as close to the interactive leaf as you
can put it. See `references/app-router.md`.

**Logic that needs React goes in a hook; logic that doesn't goes in a plain module.** "Custom Hooks
let you share stateful logic but not state itself." If a function calls no hooks, drop the `use`
prefix — `getSorted`, not `useSorted` — because the plain function can be called conditionally and
tested without a renderer. See `references/logic-placement.md`.

**Server/client is the one import boundary with real teeth.** `server-only` / `client-only` fail
the build; lint rules and path aliases do not. Anything secret-bearing or database-touching belongs
behind that boundary, in one module, not spread across components. See `references/boundaries.md`.

**Derived values are neither state nor constants.** "When something can be calculated from the
existing props or state, don't put it in state. Instead, calculate it during rendering." A lot of
"where should this live" questions dissolve once you notice the value does not need to live
anywhere.

## Answering a placement question

When asked where something belongs, work in this order. Most questions resolve at step 2 or 3.

1. **Is it forced?** A few placements are non-negotiable: route segment config must be exported
   constants in the route file; Server Functions called from Client Components must sit in a
   dedicated `'use server'` file; the root layout owns `<html>`/`<body>`; secrets and DB access
   must be server-only. If the answer is forced, say so and stop.
2. **What kind of thing is it?** This matters more than which folder it lands in. Pure function,
   stateful hook, server-only data access, React context, framework config, and derived value each
   have a natural home, and getting the *kind* right usually makes the folder obvious. If it is a
   pure function today, keep it pure — that decision outlives the folder.
3. **Who uses it?** One component → beside that component. Two components in one feature → the
   feature's own shared spot. Genuinely app-wide → a top-level module. Promote on the second real
   consumer, not in anticipation of one.
4. **Does the project already answer this?** Look for the existing pattern and follow it. Read a
   sibling feature before inventing a shape.
5. **Still open?** Say it is a project decision, recommend one option with a reason, and offer to
   record it in the project's conventions file so the next person does not re-litigate it.

## Where the real debates are

Do not pretend these are settled. If a task depends on one, surface the trade-off and let the user
pick — the details and citations are in the reference files.

| Question | State of play |
|---|---|
| Feature folders vs flat `components/` | Genuinely contested. bulletproof-react, Feature-Sliced Design and Redux all say feature folders; Josh Comeau rejects them because "categorization is actually really hard". Next.js lists both and endorses neither. Scale is the likely hidden variable; no source names a threshold. |
| Barrel files (`index.ts`) | The disputants are describing different objects. A one-line barrel re-exporting a single component is cheap; a feature-wide barrel re-exporting dozens of modules is what the tree-shaking objection is actually about. Both positions can be right. |
| `utils/` vs `helpers/` vs `lib/` vs `services/` | UNSPECIFIED. No primary source distinguishes them; `services/` appears in no source at all. Pure local convention. |
| Where constants live | UNSPECIFIED. Searched deliberately: React, Next.js and the TypeScript handbook are all silent. |
| `src/` vs project root | Cosmetic per Next.js. One hard datum: `.env.*` files stay at the project root even with `src/`. |
| Component size | No primary source gives a line count. Any "under N lines" rule is invented — use responsibility and scattered state updates as the signal instead. |
| Where TanStack Query key factories live | Partly open. Official docs settle client construction and prefetch placement but not key-factory placement. |

## Working on an existing codebase

Architecture advice is most damaging when it arrives as a refactor nobody asked for. Two habits
keep it useful.

**Hold new code to the rule; leave existing code alone unless asked.** When you find code that
contradicts a SPECIFIED rule — say a `'use client'` at the top of a page, pulling the whole subtree
into the client bundle — apply the rule to what you are writing now, name the existing case once so
the user knows it exists, and stop there. Migrating it is a separate decision with its own cost,
and it is the user's to make. Recording it as known debt is usually the right-sized action; a
sweeping rewrite almost never is.

**Read before prescribing.** A codebase's actual conventions are evidence about constraints you
cannot see from the outside. If every component folder in the project has `constants.ts` and
`helpers.ts` beside it, that is the answer to "where do constants go" for this project, and
"official guidance says nothing here" is the honest framing — not "this is wrong".

## Reference files

Read the one that matches the question rather than all of them.

| File | Covers |
|---|---|
| `references/project-layout.md` | Folder strategies, colocation, `src/`, private folders, route groups, the feature-vs-flat debate, where shared code goes |
| `references/component-splitting.md` | Split criteria, container/presentational and why it is not recommended, composition across the RSC boundary, compound components |
| `references/logic-placement.md` | Hooks vs plain modules vs reducers vs server modules, the write path, and testability as the driver behind all of it |
| `references/constants-and-naming.md` | Constants, env/config, route segment config, the `utils`/`helpers`/`lib`/`services` question, enforced naming rules |
| `references/data-and-state.md` | Where fetching belongs, server cache vs UI state, minimal state, TanStack Query placement in the App Router |
| `references/boundaries.md` | Barrel files, `server-only`/`client-only`, ESLint boundary rules, TypeScript paths vs project references |
| `references/app-router.md` | File conventions, `'use client'` placement, providers, layouts and what they may contain |

## Quality bar for your own answers

A good architecture answer is short, names its authority tier, and leaves the codebase more
consistent than it found it. Signs you have drifted: you are citing a folder name as a
requirement; you are recommending a structure the project does not already use without saying why
the change is worth it; you are quoting a rule you cannot point to a source for; or you have turned
a one-file question into a reorganization. When you catch yourself doing any of these, say plainly
which tier the advice sits in and let the user decide.
