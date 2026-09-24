# Constants, module naming, and the naming rules that are real

## Where constants live — UNSPECIFIED, and that is the finding

No official React, Next.js or TypeScript page says where application constants belong. This was
searched deliberately, not assumed: react.dev's purity page constrains *mutation* but says nothing
about placement; Next.js env-vars and route-segment-config cover framework config, not domain
constants; the Redux Style Guide has no rule on action-type constants or where to define them; the
TypeScript handbook's modules page is about mechanics only. [13][8][34][23][40]

**So: this is a project-level decision.** Say that, then state the project's own rule. Do not imply
authority you do not have.

What primary sources *do* constrain:

**SPECIFIED.** Module-level constants are fine; module-level *mutable* state read or written during
render is not. "**It minds its own business.** It does not change any objects or variables that
existed before it was called." The docs' bad example is exactly a module-level `let guest = 0`
incremented in a component. [13]

**SPECIFIED.** Locally created values may be mutated freely: "it's completely fine to change variables
and objects that you've *just* created while rendering… This is called **'local mutation'**." [13]

**SPECIFIED.** Derived values are neither state nor constants: "When something can be calculated from
the existing props or state, don't put it in state. Instead, calculate it during rendering." [11] Many
"where do I put this" questions dissolve here.

**CONVENTION.** The published options, which disagree with each other:

- bulletproof-react: a top-level `src/config` for "Global configurations", with feature-scoped values
  under `src/features/<name>/`. [21]
- FSD: `config` is a segment available inside `app` and `shared`. [22]
- Josh Comeau — the only source that places constants concretely: app-wide constants in a single
  `src/constants.ts`, and component-specific values beside the component
  (`ComponentName.helpers.ts`). [42]

## Framework config: the one place placement *is* forced

**SPECIFIED.** Route segment config must be exported module-level constants in the route file itself:
"The Route Segment Config options allow you to configure the behavior of a Page, Layout, or Route
Handler by **directly exporting the following variables**" — `dynamicParams`, `runtime`,
`preferredRegion`, `maxDuration`. [34]

**SPECIFIED and version-volatile.** The same page records that in v16.0.0 "`dynamic`, `dynamicParams`,
`revalidate`, and `fetchCache` removed when Cache Components is enabled", and `experimental_ppr` was
removed. [34] So this class of constant is framework-owned, colocated in the route file, and changes
between versions — **never abstract it into a shared constants module.**

## Env-derived config

**SPECIFIED.** The `NEXT_PUBLIC_` prefix is the split, and public values are frozen at build time:
"Non-`NEXT_PUBLIC_` environment variables are only available in the Node.js environment, meaning they
aren't accessible to the browser… Next.js can 'inline' a value, at build time, into the js bundle."
And: "After being built, your app will no longer respond to changes to these environment variables…
If you need access to runtime environment values, you'll have to set up your own API to provide them
to the client." [8]

**SPECIFIED, architectural consequence.** Dynamic lookups are **not** inlined — `process.env[varName]`
silently fails. [8] That is a concrete reason to funnel env reads through one typed config module
rather than scattering `process.env` reads across the codebase.

**SPECIFIED.** Secrets-bearing config is read in exactly one layer: "Secret keys should be stored in
environment variables, but only the Data Access Layer should access `process.env`. This keeps secrets
from being exposed to other parts of the application." [4]

## `utils/` vs `helpers/` vs `lib/` vs `services/` — UNSPECIFIED

**SPECIFIED (the absence).** "their naming has no special framework significance" [1]. There is **no
primary source** distinguishing these names. React, Next.js and TypeScript are all silent — the
TypeScript handbook explicitly "does NOT provide explicit guidance on barrel files or re-export
patterns" nor on path aliases. [40] Any distinction is local convention and must be labeled as such.

**SPECIFIED.** The one officially named layer is the **Data Access Layer** — and it is server-only by
definition, so it is not one of these four. [4]

**CONVENTION.** The three published vocabularies do not agree:

- bulletproof-react: `lib` = "Preconfigured libraries" (your wrappers around third-party deps),
  `utils` = "Shared utility functions", `config` = "Global configurations", `stores` = "Global state
  stores", per-feature `api/` for requests and hooks. **No `helpers/` at all.** [21]
- FSD segments: `ui`, `api`, `model`, `lib`, `config` — `lib` is a slice's infrastructure code,
  `model` holds domain logic. **No `utils` segment.** [22]
- Comeau, the only source distinguishing helpers from utils, draws it on genericity: `src/helpers/`
  for "project-specific functions", `src/utils.ts` for generic reusable ones,
  `ComponentName.helpers.ts` for one component's helpers. [42]

**`services/` has no source at all.** It appears in neither bulletproof-react nor FSD nor any primary
page. Treat it as pure local invention — which is fine, as long as nobody claims otherwise.

**The distinction that IS primary is orthogonal to all four names:** server-only vs client-safe. See
`boundaries.md`.

**What does not belong in a shared util module.** Two specified answers:

1. Anything server-only that the client could import — mark it with `server-only` instead of relying
   on a folder name. [2]
2. A function named `useX` that calls no hooks — it should be `getX`. [10]

## Naming rules that are actually enforced

Most naming advice is taste. These four are not.

**SPECIFIED, enforced by React.** "Hook names must start with `use` followed by a capital letter" and
"React component names must start with a capital letter." [10]

**SPECIFIED, the corollary.** Drop `use` from anything that calls no hooks — `getSorted`, not
`useSorted`. [10]

**SPECIFIED.** Name hooks after the concrete use case, not the lifecycle: `useChatRoom(...)` and
`useOnlineStatus()` are endorsed, `useMount(fn)` is marked 🔴. [10]

**SPECIFIED, Next.js, with teeth.** A Server Function passed as a prop to a Client Component must be
named `action` or end in `Action`: "The TypeScript plugin allows a Client Component prop typed as a
function when its name is `action` or ends in `Action`. The plugin flags other function props." [3]

**SPECIFIED.** Reducer actions are named after what happened, not what to set. [12]
