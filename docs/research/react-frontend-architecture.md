# React / Next.js frontend architecture — research notes

> **Date:** 2026-09-20\
> **Scope:** frontend *architecture* only — code organization, layering, boundaries. Explicitly
> NOT performance optimization.\
> **Next.js docs version at fetch time:** 16.3.5 (each page reported its own `lastUpdated`, noted
> inline where it matters).

## How to read this

Every assertion below is tagged:

- **[PRIMARY]** — official documentation or the author of the pattern: react.dev, nextjs.org/docs,
  React reference docs, Dan Abramov's own writing, TanStack Query official docs, ESLint/plugin
  official rule docs.
- **[COMMUNITY]** — widely-cited but opinionated: bulletproof-react, Feature-Sliced Design, the
  Redux Style Guide (official to Redux, but a *style guide*, i.e. opinion by its own framing), Kent
  C. Dodds, TkDodo's blog (he is a TanStack Query maintainer, but the blog is not the docs).

Every source listed in `## Sources` was **actually fetched** in this session unless the entry says
otherwise. Fetch failures are recorded there too, and those sources are not cited as evidence.

Where sources contradict each other, the contradiction is stated in
`## Disagreements and open questions` rather than averaged away.

**Second pass (same date).** Sections were extended in place, `## 9. Testability as an architectural
driver` was added, and the `##
Sources` list grew (entries 28–44 plus new failure records). Two outcomes change how earlier
material should be used: the Dan Abramov retraction was **downgraded** from `[PRIMARY]` to
`[COMMUNITY, reported]` because no non-mirror source could be fetched (§2 records every attempt),
and the absence of primary guidance on constants (§3) and on `utils`/`helpers`/`lib`/`services` (§4)
is now an **established** absence — searched deliberately, including the TypeScript handbook —
rather than an unsearched gap. Entries marked "added in second pass" are additions; nothing from the
first pass was shortened or restructured.

---

## 1. Where components live and how a project is laid out

**[PRIMARY] Next.js takes no position on layout.** "Next.js is **unopinionated** about how you
organize and colocate your project files."
([Project structure and organization](https://nextjs.org/docs/app/getting-started/project-structure#organizing-your-project))
The same page names only three strategies and then says: "The simplest takeaway is to choose a
strategy that works for you and your team and be consistent across the project."

**[PRIMARY] The three sanctioned strategies** are, verbatim from
[Examples](https://nextjs.org/docs/app/getting-started/project-structure#examples):

1. "Store project files outside of `app`" — `app/` is kept "purely for routing purposes".
2. "Store project files in top-level folders inside of `app`".
3. "Split project files by feature or route" — globally shared code at the `app` root, specific code
   pushed down "into the route segments that use them".

**[PRIMARY] Folder names like `components/` and `lib/` have no framework meaning.** "In our examples
below, we're using `components` and `lib` folders as generalized placeholders, their naming has no
special framework significance and your projects might use other folders like `ui`, `utils`,
`hooks`, `styles`, etc."
([same page](https://nextjs.org/docs/app/getting-started/project-structure#examples))

**[PRIMARY] Colocation inside `app/` is safe by default** — routability is opt-in, not implicit. "a
route is **not publicly accessible** until a `page.js` or `route.js` file is added to a route
segment… This means that **project files** can be **safely colocated** inside route segments in the
`app` directory without accidentally being routable."
([Colocation](https://nextjs.org/docs/app/getting-started/project-structure#colocation))

**[PRIMARY] Private folders (`_folder`) are an organizational tool, not a requirement.** "Since
files in the `app` directory can be safely colocated by default, private folders are not required
for colocation." They are still useful for "Separating UI logic from routing logic", editor sorting,
and "Avoiding potential naming conflicts with future Next.js file conventions."
([Private folders](https://nextjs.org/docs/app/getting-started/project-structure#private-folders))
Practical corollary from the same page: if you *don't* use private folders you must know the special
file names to avoid collisions.

**[PRIMARY] Route groups `(group)` organize without touching the URL.** "This indicates the folder
is for organizational purposes and should **not be included** in the route's URL path." Listed uses:
"Organizing routes by site section, intent, or team", enabling nested layouts at the same segment
level, scoping a `loading.tsx` to one route, and multiple root layouts.
([Route groups](https://nextjs.org/docs/app/getting-started/project-structure#route-groups))

**[PRIMARY] `src/` is optional and purely cosmetic-organizational.** "Next.js supports storing
application code (including `app`) inside an optional `src` folder. This separates application code
from project configuration files which mostly live in the root of a project."
([`src` folder](https://nextjs.org/docs/app/getting-started/project-structure#src-folder))
Version-sensitive gotcha from the env-vars guide: "If you are using a `/src` directory, `.env.*`
files should remain in the root of your project."
([Environment variables](https://nextjs.org/docs/app/guides/environment-variables#good-to-know))

**[COMMUNITY] Colocation is the default heuristic; distance must be earned.** "Place code as close
to where it's relevant as possible" — alternatively "Things that change together should be located
as close as reasonable." The argument is maintainability (separated things "get out of sync or out
of date quicker") and applicability (people notice what is next to what they edit). Kent explicitly
carves out what does *not* colocate: cross-system docs, integration tests, and E2E tests, which
"don't really care how the `src/` is organized at all."
([Kent C. Dodds — Colocation](https://kentcdodds.com/blog/colocation))

**[COMMUNITY] Feature folders over type folders.** bulletproof-react's structure is
`src/{app,components,config,features,hooks,lib,stores,testing,types,utils}`, with each feature
owning its own `api/ assets/ components/ hooks/ stores/ types/ utils/`.
([bulletproof-react project-structure](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md))

**[COMMUNITY] Redux says the same thing in stronger words.** "we recommend that most applications
should structure files using a 'feature folder' approach (all files for a feature in the same
folder)… While older Redux codebases often used a 'folder-by-type' approach with separate folders
for 'actions' and 'reducers', keeping related logic together makes it easier to find and update that
code."
([Redux Style Guide](https://redux.js.org/style-guide/#structure-files-as-feature-folders-with-single-file-logic))

**[COMMUNITY] Feature-Sliced Design formalizes layout into layers → slices → segments.** Layers, top
to bottom: `app`, `processes` (deprecated), `pages`, `widgets`, `features`, `entities`, `shared`.
Slices partition a layer by business domain; segments (`ui`, `api`, `model`, `lib`, `config`)
partition a slice by technical purpose. `app` and `shared` have no slices — they go straight to
segments.
([Feature-Sliced Design overview](https://feature-sliced.design/docs/get-started/overview))

**[COMMUNITY, dissenting — added in second pass] A well-known voice argues the exact opposite: flat,
organized by function, not by feature.** Josh Comeau keeps "all of his components in a flat
components directory", one folder per component (`src/components/ComponentName/` holding
`ComponentName.tsx`, `index.ts`, optional `ComponentName.helpers.ts` / `.types.ts`). He rejects
type-based grouping ("Atomic Design's approach of organizing components by type
(`/components/atoms`, `/components/molecules`) as a bad idea, since it means developers will waste
time trying to figure out which box each component fits into") **and** feature grouping: "real life
isn't nicely segmented like this, and categorization is actually *really hard*", naming unclear
feature boundaries and the cost of relocating code as products evolve.
([Josh Comeau — Delightful React File/Directory Structure](https://www.joshwcomeau.com/react/file-structure/))
This is a direct, named contradiction of bulletproof-react / FSD / Redux — see `## Disagreements`.

---

## 2. How components should be split

**[COMMUNITY-VERIFIED, NOT PRIMARY-VERIFIABLE FROM HERE] The author of container/presentational is
reported to have retracted it — but the retraction could not be confirmed against a non-mirror
source.** The quote as it appears on the mirror: "I wrote this article a long time ago and my views
have since evolved. In particular, I don't *suggest* splitting your components like this anymore."
The mirror also reports that he considers the pattern fine when it emerges naturally, that he has
seen it applied dogmatically, and that Hooks now give the same separation of stateful logic "without
an arbitrary division".
([readmedium mirror](https://readmedium.com/smart-and-dumb-components-7ca2f9a7c7d0) — **fetched**)

Second-pass verification attempts, all recorded honestly:

- Canonical `medium.com/@dan_abramov/smart-and-dumb-components-7ca2f9a7c7d0` — **HTTP 403, not
  fetchable from this environment** (both passes).
- Wayback Machine snapshot of that URL — **this environment cannot fetch `web.archive.org` at all**
  ("Claude Code is unable to fetch from web.archive.org"). Not a 404: a tooling limit.
- `overreacted.io` — the post was **not** re-hosted there; a domain-scoped search of overreacted.io
  surfaces only his RSC-era writing, no presentational/container post.
-
  [patterns.dev — Container/Presentational Pattern](https://www.patterns.dev/react/presentational-container-pattern/)
  (**fetched**) does **not** quote him and does not mention the retraction; it links his original
  article in References only. What it does say on its own authority: "Modern React strongly favors
  **Hooks over container components** for separating logic from views. Custom Hooks can replace
  class-based containers entirely."

**Therefore, for skill purposes:** do **not** state "Dan Abramov retracted this" as a
primary-sourced fact on the strength of this research. Two claims survive at different strengths:

1. **[COMMUNITY, well-attested]** The retraction is widely and consistently reported, and a mirror
   of his article carries the text. Cite it as *reported*, with the mirror, or re-verify against
   Medium from an environment that can reach it.
2. **[PRIMARY, independently sufficient]** The pattern is not needed, and this does **not** depend
   on the retraction at all: react.dev's own component-splitting criteria are responsibility and
   data shape (below), and react.dev routes shared stateful logic to custom hooks — "Custom Hooks
   let you share *stateful logic*"
   ([Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks#custom-hooks-sharing-logic-between-components)).
   No official React or Next.js page anywhere in this corpus recommends a container/presentational
   layer. A skill can rest on this and never touch the disputed quote.

**[PRIMARY] The official split criterion is single responsibility, applied like function
extraction.** "use the same techniques for deciding if you should create a new function or object.
One such technique is the separation of concerns, that is, a component should ideally only be
concerned with one thing. If it ends up growing, it should be decomposed into smaller
subcomponents."
([Thinking in React](https://react.dev/learn/thinking-in-react#step-1-break-the-ui-into-a-component-hierarchy))

**[PRIMARY] The data model is the recommended seam, not "smart vs dumb".** "If your JSON is
well-structured, you'll often find that it naturally maps to the component structure of your UI…
Separate your UI into components, where each component matches one piece of your data model."
([Thinking in React](https://react.dev/learn/thinking-in-react#step-1-break-the-ui-into-a-component-hierarchy))
This is a *structural* criterion (shape of data) rather than a *layering* criterion (fetches vs
renders) — which is exactly the criterion Abramov retracted.

**[PRIMARY] Composition, not configuration, is how logic and UI are recombined across the RSC
boundary.** Passing rendered output as `children` is the official escape hatch: "Passing rendered
output as `children` lets a Server Component nest inside a Client Component without importing the
Server Component's code into the client graph." The docs name the roles: "The **owner** is the
component whose source contains the JSX for a child… The **parent** directly contains the child in
the rendered tree."
([The Server and Client Boundary — Crossing the boundary](https://nextjs.org/docs/app/guides/server-and-client-boundary#crossing-the-boundary))

**[PRIMARY] Compound components (`Menu.Item`) break across the boundary.** "The pattern breaks when
a static member crosses the boundary. A Server Component that imports a Client Component receives a
client reference instead of the function. As a result, `Menu.Item` is `undefined`… To use its pieces
from a Server Component, expose them as named exports instead of static properties."
([same page](https://nextjs.org/docs/app/guides/server-and-client-boundary#crossing-the-boundary))
This is a hard architectural constraint on the configuration-style compound API in RSC apps.

**[PRIMARY] Size heuristic for state logic, not for line count.** React gives no line-count rule.
The signal it names is scattered update logic: "Components with many state updates spread across
many event handlers can get overwhelming… you can consolidate all the state update logic outside
your component in a single function, called a *reducer*."
([Extracting State Logic into a Reducer](https://react.dev/learn/extracting-state-logic-into-a-reducer))

**Practical reading:** the primary sources support "split by responsibility / data shape / where the
boundary must be", and explicitly do *not* support a standing container-vs-presentational layer.

---

## 3. Where constants live

This is the thinnest question for primary sources — no official page is titled "where constants go".
What primary docs *do* constrain:

**[PRIMARY] Module-scope values must not be mutated during render.** "**It minds its own business.**
It does not change any objects or variables that existed before it was called." The docs' bad
example is exactly a module-level `let guest = 0` incremented in a component.
([Keeping Components Pure](https://react.dev/learn/keeping-components-pure#purity-components-as-formulas))
So module-level constants are fine; module-level *mutable* module state read/written during render
is not.

**[PRIMARY] Locally created values may be mutated freely.** "it's completely fine to change
variables and objects that you've *just* created while rendering… This is called **'local
mutation'**."
([same page](https://react.dev/learn/keeping-components-pure#local-mutation-your-components-little-secret))

**[PRIMARY] Derived values are not constants and not state.** "When something can be calculated from
the existing props or state, don't put it in state. Instead, calculate it during rendering."
([You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect#updating-state-based-on-props-or-state))

**[PRIMARY] Env-derived config is split by the `NEXT_PUBLIC_` prefix, and public ones are frozen at
build time.** "Non-`NEXT_PUBLIC_` environment variables are only available in the Node.js
environment, meaning they aren't accessible to the browser… Next.js can 'inline' a value, at build
time, into the js bundle." And: "After being built, your app will no longer respond to changes to
these environment variables… If you need access to runtime environment values, you'll have to set up
your own API to provide them to the client."
([Environment variables](https://nextjs.org/docs/app/guides/environment-variables#bundling-environment-variables-for-the-browser))
Dynamic lookups are **not** inlined (`process.env[varName]` silently fails) — an architectural
reason to funnel env reads through one typed config module rather than scattering `process.env`
reads.

**[PRIMARY] Secrets-bearing config should be read in exactly one layer.** "Secret keys should be
stored in environment variables, but only the Data Access Layer should access `process.env`. This
keeps secrets from being exposed to other parts of the application."
([Data security — Data Access Layer](https://nextjs.org/docs/app/guides/data-security#data-access-layer))

**[COMMUNITY] A `config/` folder for global configuration, per-feature constants inside the
feature.** bulletproof-react puts `src/config` ("Global configurations") at the top level while
feature-scoped code (including its `types`/`utils`) lives under `src/features/<name>/`.
([bulletproof-react](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md))
FSD names `config` as a segment available inside `app` and `shared`.
([FSD overview](https://feature-sliced.design/docs/get-started/overview))

**[COMMUNITY] The only published source in this corpus that places constants concretely** puts
app-wide constants in a single `src/constants.ts`, project-specific functions in `src/helpers/`, and
generic ones in `src/utils.ts`, with component-specific values living beside the component
(`ComponentName.helpers.ts`).
([Josh Comeau — file structure](https://www.joshwcomeau.com/react/file-structure/))

**[PRIMARY, second pass] There is one place where Next.js *requires* config to be a module-level
named constant: route segment config.** "The Route Segment Config options allow you to configure the
behavior of a Page, Layout, or Route Handler by **directly exporting the following variables**" —
`dynamicParams`, `runtime`, `preferredRegion`, `maxDuration`.
([Route Segment Config](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config),
version 16.3.5, `lastUpdated` 2026-04-30) Version-sensitive: the same page's history records that in
`v16.0.0` "`dynamic`, `dynamicParams`, `revalidate`, and `fetchCache` removed when Cache Components
is enabled", and `experimental_ppr` was removed. So this class of constant is framework-owned,
colocated in the route file, and **version-volatile** — never abstract it into a shared constants
module.

**[COMMUNITY] Redux's nearest constant-adjacent rule is about what must *not* become global state,**
not about constants: "**Most form state shouldn't go in Redux**. In most use cases, the data is not
truly global, is not being cached, and is not being used by multiple components at once."
([Redux Style Guide — Avoid Putting Form State In Redux](https://redux.js.org/style-guide/#avoid-putting-form-state-in-redux))
Also relevant to naming module-level action identifiers: "**We recommend trying to treat actions
more as 'describing events that occurred', rather than 'setters'**."
([Model Actions as Events, Not Setters](https://redux.js.org/style-guide/#model-actions-as-events-not-setters))

**Established absence (searched, not assumed).** Re-checked in the second pass specifically for
primary guidance on where constants live: react.dev's purity page (constrains mutation, says nothing
about placement), Next.js env-vars and route-segment-config (cover config, not domain constants),
the Redux Style Guide (no rule on action-type constants or where to define them — confirmed by
direct re-read), and the TypeScript handbook's modules theory page (module mechanics only).
**Conclusion: no official React, Next.js, or TypeScript guidance exists on where application
constants belong. This is a project-level decision** — a skill should say so and then state the
project's own rule, rather than implying authority.

---

## 4. `utils/` vs `helpers/` vs `lib/` vs `services/`

**[PRIMARY] None of these names mean anything to the framework.** Next.js states the folder names in
its own examples are "generalized placeholders, their naming has no special framework significance".
([Project structure](https://nextjs.org/docs/app/getting-started/project-structure#examples))
There is therefore **no primary source** that distinguishes `utils` from `helpers` from `lib`. Any
such rule in a skill must be marked as a local convention, not as guidance from React or Next.js.

**[PRIMARY] There *is* one officially named layer: the Data Access Layer.** "For new projects, we
recommend creating a dedicated **Data Access Layer (DAL)**. This is an internal library that
controls how and when data is fetched, and what gets passed to your render context." It "should:
Only run on the server. Perform authorization checks. Return safe, minimal **Data Transfer Objects
(DTOs)**." ([Data security](https://nextjs.org/docs/app/guides/data-security#data-access-layer)) The
docs also say to pick one of three approaches (HTTP APIs / DAL / component-level) and "avoiding
mixing them… This makes it clear for both developers working in your code base and security auditors
what to expect."

**[PRIMARY] What does NOT belong in a shared util module: anything server-only that could be
imported by the client.** The official mechanism is a marker import, not a naming convention: "you
can mark a module with the `server-only` package… This ensures that proprietary code or internal
business logic stays on the server by causing a build error if the module is imported in the client
environment." The mirror is `client-only`.
([Preventing environment poisoning](https://nextjs.org/docs/app/getting-started/server-and-client-components#preventing-environment-poisoning))
Note: installing them is "optional" in Next.js; Next handles the imports internally.

**[PRIMARY] What does NOT belong in `utils/`: a function named `useX` that doesn't call hooks.** "If
your function doesn't call any Hooks, avoid the `use` prefix. Instead, write it as a regular
function *without* the `use` prefix" — the docs' example turns `useSorted` into `getSorted`, because
the plain function "can be called conditionally, which is not allowed for actual Hooks."
([Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks#when-to-use-custom-hooks))

**[COMMUNITY] The clearest published split** is bulletproof-react's: `lib` = "Preconfigured
libraries" (your wrappers around third-party deps, e.g. the configured axios/query client), `utils`
= "Shared utility functions", `config` = "Global configurations", `stores` = "Global state stores",
plus per-feature `api/` for "API requests and hooks". `helpers/` does not appear at all.
([bulletproof-react](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md))
FSD's equivalent segment vocabulary is `ui`, `api`, `model`, `lib`, `config` — where `lib` is
"infrastructure code" of a slice and `model` holds the domain logic.
([FSD overview](https://feature-sliced.design/docs/get-started/overview))

**[COMMUNITY, second pass] The only source found that distinguishes `helpers/` from `utils/` at
all** draws it on genericity: `src/helpers/` for "project-specific functions", `src/utils.ts` for
generic, reusable utilities, and `ComponentName.helpers.ts` for helpers belonging to one component.
([Josh Comeau — file structure](https://www.joshwcomeau.com/react/file-structure/)) Note that
bulletproof-react has no `helpers/` at all, and FSD has no `utils` segment — the three published
vocabularies do not agree with each other.

**`services/`: no source.** Neither bulletproof-react, nor FSD, nor any primary page in this corpus
uses a `services/` folder. The nearest officially named thing is the Data Access Layer, which is
server-only by definition. Treat `services/` as pure local invention.

**Established absence (searched, not assumed).** Second pass added the TypeScript handbook to the
search: its modules theory page is about mechanics — "Any system that solves this problem by giving
files their own scope while still providing a way to make bits of code available to other files can
be called a 'module system'" — and **"does NOT provide explicit guidance on barrel files or
re-export patterns"** nor on path aliases.
([TypeScript Handbook — Modules: Theory](https://www.typescriptlang.org/docs/handbook/modules/theory.html))
**Conclusion: the `utils` / `helpers` / `lib` / `services` split has no primary source anywhere —
React, Next.js and TypeScript are all silent. It is a naming convention, and a skill must present it
as the project's choice.** The one distinction that *is* primary and enforceable is orthogonal to
all four names: server-only vs client-safe (see §7).

---

## 5. Where business / domain logic lives

**[PRIMARY] In RSC apps, read-path domain logic belongs in a server-only module, not in the
component.** The docs contrast the DAL with "Component-level data access", which they scope to
"quick prototypes and iteration" and then show failing: "EXPOSED: This exposes all the fields in
userData to the client because we are passing the data from the Server Component to the Client."
([Data security](https://nextjs.org/docs/app/guides/data-security#component-level-data-access))

**[PRIMARY] Write-path: keep `"use server"` actions thin and delegate.** "you can apply the same
pattern to mutations. This keeps authentication, authorization, and database logic in a dedicated
`server-only` module, while `"use server"` actions stay thin."
([Data security — Using a Data Access Layer for mutations](https://nextjs.org/docs/app/guides/data-security#using-a-data-access-layer-for-mutations))

**[PRIMARY] Every Server Function is a public endpoint; authorization cannot be inherited from the
page.** "By default, when a Server Action is created and exported, it is reachable via a direct POST
request, not just through your application's UI… A page-level authentication check does not extend
to the Server Actions defined within it. Always re-verify inside the action."
([Data security](https://nextjs.org/docs/app/guides/data-security#authentication-and-authorization))
Also: "Read authentication from cookies or headers rather than accepting tokens as function
parameters."
([`use server`](https://nextjs.org/docs/app/api-reference/directives/use-server#authentication-and-authorization))

**[PRIMARY] Server Functions callable from Client Components must live in a dedicated `'use server'`
file.** "To use Server Functions in Client Components you need to create your Server Functions in a
dedicated file using the `use server` directive at the top of the file."
([`use server`](https://nextjs.org/docs/app/api-reference/directives/use-server#using-server-functions-in-a-client-component))
Inline `'use server'` inside a component is supported but creates a closure whose captured variables
are "sent to the client and back to the server when the action is invoked" (encrypted, but the docs
say "We don't recommend relying on encryption alone").

**[PRIMARY] Mutations must never happen during render.** "Mutations (e.g. logging out users,
updating databases, invalidating caches) should never be a side-effect, either in Server or Client
Components."
([Data security](https://nextjs.org/docs/app/guides/data-security#avoiding-side-effects-during-rendering))
The client-side analogue from React: "In React, **side effects usually belong inside event
handlers.**"
([Keeping Components Pure](https://react.dev/learn/keeping-components-pure#where-you-can-cause-side-effects))

**[PRIMARY] Custom hooks are for *stateful* logic that must live in React; pure logic should be a
plain module.** "Custom Hooks let you share *stateful logic* but not *state itself.*" And: "Whenever
you write an Effect, consider whether it would be clearer to also wrap it in a custom Hook… if
you're writing one, it means that you need to 'step outside React' to synchronize with some external
system." Plus the size/shape rule: "**Keep your custom Hooks focused on concrete high-level use
cases**" — no generic `useMount(fn)` wrappers. And "You don't need to extract a custom Hook for
every little duplicated bit of code. Some duplication is fine."
([Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks#custom-hooks-sharing-logic-between-components))

**[PRIMARY] Update logic belongs in a pure reducer once it spreads.** A reducer "lets you cleanly
separate the *how* of update logic from the *what happened* of event handlers", and "is a pure
function that doesn't depend on your component. This means that you can export and test it
separately in isolation." It may be declared outside the component or moved to its own file.
Constraint: "Reducers must be pure… They should not send requests, schedule timeouts, or perform any
side effects."
([Extracting State Logic into a Reducer](https://react.dev/learn/extracting-state-logic-into-a-reducer#comparing-usestate-and-usereducer))
Recommendation is conditional, not blanket: "We recommend using a reducer if you often encounter
bugs due to incorrect state updates in some component… You don't have to use reducers for
everything."

**[PRIMARY] Server Components cannot hold logic that needs state or effects.** "Server Components
are not sent to the browser, so they cannot use interactive APIs like `useState`."
([Server Components](https://react.dev/reference/rsc/server-components)) And: "`useState`,
`useEffect`, and event handlers require code that runs in the browser… Server Component code never
reaches the browser, so it cannot use these client-side APIs."
([Server and Client Boundary](https://nextjs.org/docs/app/guides/server-and-client-boundary#state-and-interactivity))

**[COMMUNITY] Redux's version of the same rule:** "try to put as much of the logic for calculating a
new state into the appropriate reducer, rather than in the code that prepares and dispatches the
action (like a click handler). This helps ensure that more of the actual app logic is easily
testable."
([Redux Style Guide](https://redux.js.org/style-guide/#put-as-much-logic-as-possible-in-reducers))

### Added in second pass — React's own statements on the server/client split

**[PRIMARY] React, not just Next.js, says Server Function arguments are untrusted input.**
"Arguments to Server Functions are fully client-controlled. For security, always treat them as
untrusted input, and make sure to validate and escape arguments as appropriate." And: "In any Server
Function, make sure to validate that the logged-in user is allowed to perform that action."
([react.dev — `use server`](https://react.dev/reference/rsc/use-server)) This makes "validate +
authorize inside the function, every time" a *React-level* architectural rule, not a Next.js
deployment detail — which is the strongest argument for a single module that owns those checks.

**[PRIMARY] `'use server'` does not mark server components, and there is no directive that does.**
"A common misunderstanding is that Server Components are denoted by `"use server"`, but there is no
directive for Server Components. The `"use server"` directive is used for Server Actions."
([React 19 release post](https://react.dev/blog/2024/12/05/react-19), December 5 2024) Directive
placement is identical to `'use client'`: "`'use server'` must be at the very beginning of their
function or module; above any other code including imports."
([react.dev — `use server`](https://react.dev/reference/rsc/use-server))

**[PRIMARY] Not every Server Function is a Server Action — the names denote different things.**
"Until September 2024, we referred to all Server Functions as 'Server Actions'. If a Server Function
is passed to an action prop or called from inside an action then it is a Server Action, but not all
Server Functions are Server Actions."
([react.dev — Server Functions](https://react.dev/reference/rsc/server-functions)) Same page:
"Server Functions allow Client Components to call async functions executed on the server."

**[PRIMARY] Server Function argument/return serializability differs from component props.** Allowed:
primitives, iterables, `Date`, **`FormData`**, plain objects, other Server Functions, Promises. Not
allowed: React elements/JSX, non-Server functions, classes and class instances.
([react.dev — `use server`](https://react.dev/reference/rsc/use-server)) Note the asymmetry with
Client Component props, where JSX **is** allowed and `FormData` is not listed
([`use client`](https://react.dev/reference/rsc/use-client)) — a real constraint when deciding
whether a boundary crossing should be a prop or a function call.

**[PRIMARY] The RSC RFC states the capability split as a table, and it is the cleanest layering rule
in the corpus.** Server Components **may** "Use `async/await` with databases/services" and render
other Server Components, native elements, or Client Components; they **may not** use
`useState`/`useReducer`, effects, browser-only APIs, or "Import or call Client Components directly".
Client Components may use all standard React features and "Receive already-rendered Server
Components as children"; they **may not** "Import Server Components or call server hooks/utilities".
([RFC 0188 — React Server Components](https://github.com/reactjs/rfcs/blob/main/text/0188-server-components.md))

**[PRIMARY] The RFC names a third category most codebases forget: shared components.** "Developers
may also create components and hooks that work on both the server and the client… so long as the
components meet all the constraints of both Server and Client Components." Such code must forgo
state, effects, browser APIs, server data access, and importing either component type — and the RFC
notes this is common in practice: "Many components simply transform some props based on some
conditions, without using state or loading additional data." **Architectural consequence:** a
`shared/` layer is only legitimate if it is the *intersection* of both environments, not the union.

**[PRIMARY] The intended model, in the React team's own framing.** "This lets you mix build-time,
server-only, and interactive components in a single React tree", with the annotated example: "You're
on the server, so you can talk to your data layer. API endpoint not required… Add any amount of
rendering logic. It won't make your JavaScript bundle larger… Pass the data down to the components
that will run in the browser."
([Creating a React App — the React team's full-stack architecture vision](https://react.dev/learn/creating-a-react-app#which-features-make-up-the-react-teams-full-stack-architecture-vision))
The same section stresses that "Server Components and Suspense are React features rather than
Next.js features."

---

## 6. Data fetching & state placement as an architectural concern

**[PRIMARY] Default: fetch in the Server Component that needs the data; prop-drilling is not the
sharing mechanism.** "Identical `fetch` requests in a React component tree are memoized by default,
so you can fetch data in the component that needs it instead of drilling props."
([Fetching Data](https://nextjs.org/docs/app/getting-started/fetching-data#with-the-fetch-api)) For
non-`fetch` sources: "For data access that does not use `fetch`, such as an ORM or database query,
wrap the function in `React.cache`. Multiple components can then call the function within the same
request while sharing one result."
([same page](https://nextjs.org/docs/app/getting-started/fetching-data#reusing-data-with-reactcache))
Scope caveat: `React.cache` "is scoped to the current request only."

**[PRIMARY] RSC removes the separate loading layer.** "With RSC, a Server Component can fetch data
while rendering. A separate data-loading step does not need to pass initial props to the component
tree."
([Server and Client Boundary — How data enters the tree](https://nextjs.org/docs/app/guides/server-and-client-boundary#how-data-enters-the-tree))
This is the architectural break from `getServerSideProps`-era layering.

**[PRIMARY] Client-side fetching has two sanctioned shapes.** "There are two ways to fetch data in
Client Components, using: 1. React's `use` API 2. A community library like SWR or React Query."
([Fetching Data — Client Components](https://nextjs.org/docs/app/getting-started/fetching-data#client-components))
The `use` shape is: start the request in a Server Component, pass the *pending promise* as a prop,
read it with `use()` inside a `<Suspense>` boundary. "Because the request starts before the client
runs, the Client Component does not need to fetch the same data after mount. You may still need to
start a fetch in the browser when the requested data depends on client-only state or user
interaction."
([Server and Client Boundary](https://nextjs.org/docs/app/guides/server-and-client-boundary#how-data-enters-the-tree))

**[PRIMARY] Effects are the wrong place for fetching in a framework app.** "Keep in mind that modern
frameworks provide more efficient built-in data fetching mechanisms than writing Effects directly in
your components." If you do, you must handle races with an `ignore` flag in cleanup.
([You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect#fetching-data))

**[PRIMARY] Colocate the preload next to its consumer.** "Keep the preload function next to the
component that consumes the data. This makes the dependency easier to find if you move or remove the
component."
([Fetching Data — Preloading data](https://nextjs.org/docs/app/getting-started/fetching-data#preloading-data))
This is the clearest primary-source statement of query colocation in the App Router.

**[PRIMARY] `searchParams` vs `useSearchParams` is a placement decision, not a taste one.** "Use the
`searchParams` prop when you need search parameters to **load data for the page**… Use
`useSearchParams` when search parameters are used **only on the client**."
([Layouts and Pages](https://nextjs.org/docs/app/getting-started/layouts-and-pages#what-to-use-and-when))

**[PRIMARY] Keep client state minimal and derived.** "Think of state as the minimal set of changing
data that your app needs to remember… Figure out the absolute minimal representation of the state
your application needs and compute everything else on-demand." The three disqualifiers: unchanged
over time / passed in from a parent / computable from existing state or props.
([Thinking in React — Step 3](https://react.dev/learn/thinking-in-react#step-3-find-the-minimal-but-complete-representation-of-ui-state))

**[PRIMARY] TanStack Query: keys are the dependency array of the cache.** Keys "must be serializable
using `JSON.stringify`, and **unique to the query's data**"; "If your query function depends on a
variable, include it in your query key"; "Adding dependent variables to your query key will ensure
that queries are cached independently, and that any time a variable changes, *queries will be
refetched automatically*." Object key order does not matter; array order does. The docs themselves
point at "Effective React Query Keys" and the community Query Key Factory package for organizational
strategy.
([Query Keys](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys))

**[COMMUNITY] Query keys and query functions belong together, per feature, behind a factory.** "I
keep my Query Keys next to their respective queries, co-located in a feature directory"; "Structure
your Query Keys from *most generic* to *most specific*"; "I recommend one Query Key factory per
feature".
([TkDodo — Effective React Query Keys](https://tkdodo.eu/blog/effective-react-query-keys))

**[COMMUNITY] Server cache is a different kind of state and must not be copied into local state.**
"React Query is an async state manager"; "it assumes that the frontend application doesn't 'own' the
data"; the main knob is `staleTime` — "As long as data is fresh, it will always come from the cache
only." Queries should be wrapped in a custom hook per query rather than called ad hoc.
([TkDodo — React Query as a State Manager](https://tkdodo.eu/blog/react-query-as-a-state-manager))

**[COMMUNITY] The same server-cache/UI-state split, stated independently.** Kent distinguishes
"Server Cache - State that's actually stored on the server" from UI state and warns that "mixing
them creates problems"; his placement rule is "Keep state as close to where it's needed as
possible", lift only to the lowest common ancestor, and split contexts by domain rather than one
global object.
([Application State Management with React](https://kentcdodds.com/blog/application-state-management-with-react))

**[COMMUNITY] Shape global state by data type, not by screen.** "Root state slices should be defined
and named based on the major data types or areas of functionality in your application, not based on
which specific components you have in your UI… A good state structure might look like `{auth, posts,
users, ui}`. A bad structure would be something like `{loginScreen, usersList, postsList}`." Plus:
"keep the actual data in the Redux store as minimal as possible, and *derive* additional values from
that state as needed."
([Redux Style Guide](https://redux.js.org/style-guide/#organize-state-structure-based-on-data-types-not-components))

### Added in second pass — TanStack Query in the App Router, from the official docs

**[PRIMARY to TanStack] The QueryClient must not be a module-level singleton on the server.** The
official Advanced SSR guide's `getQueryClient()` shape is explicitly environment-branched: "Server:
always make a new query client" / "Browser: make a new query client if we don't already have one",
and the reason is stated as request isolation — "`cache()` is scoped per request, so we don't leak
data between requests".
([TanStack Query — Advanced Server Rendering](https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr))
This *answers* part of what the first pass left open: the shared client belongs behind a factory
function, not in a module that both graphs import.

**[PRIMARY to TanStack] Server Components are a prefetch site, not a render site, for Query.** "From
the React Query perspective, treat Server Components as a place to prefetch data, nothing more." The
guide warns against rendering query results at both levels because of ownership/sync problems on
revalidation.
([same page](https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr))

**[PRIMARY to TanStack] `HydrationBoundary` is a Client Component and the per-route boilerplate
cannot be abstracted away in RSC.** "HydrationBoundary is a Client Component, so hydration will
happen there"; and "In the SSR guide, we noted that you could get rid of the boilerplate of having
`<HydrationBoundary>` in every route. This is not possible with Server Components."
([same page](https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr)) This is a
structural cost you must accept per route, not a smell to refactor.

**Still open after the second pass:** the official guide settles *client construction* and *prefetch
placement*, but it does **not** say where `queryKey` factories or query hooks should live in an App
Router tree, and it discourages sharing one query hook across both environments. TkDodo's
colocate-per-feature advice remains the only concrete placement guidance and predates RSC. See
`## Disagreements`.

---

## 7. Cross-cutting: barrel files, import boundaries, naming

### Barrel files (`index.ts`)

**[COMMUNITY, against]** bulletproof-react argues against them outright: barrels "can cause issues
for Vite to do tree shaking and can lead to performance issues" — import files directly instead.
([bulletproof-react](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md))

**[COMMUNITY, for]** FSD's slice/layer model depends on a *public API per slice* — the import rule
is enforceable only because a slice exposes a single entry point and callers never reach inside.
([FSD overview](https://feature-sliced.design/docs/get-started/overview))

**[PRIMARY, adjacent]** No official React or Next.js page endorses or forbids barrel files. The one
official constraint nearby is the compound-component failure: static members do not survive the RSC
boundary, so "expose them as named exports instead of static properties."
([Server and Client Boundary](https://nextjs.org/docs/app/guides/server-and-client-boundary#crossing-the-boundary))
**[COMMUNITY, for — second pass] The strongest pro-barrel voice found is Josh Comeau, and his barrel
is deliberately minimal.** One `index.ts` per component folder that "does nothing except re-export
other stuff from its sibling files"; the motive is import ergonomics plus not being "flooded with
index files" in the IDE: "This is essentially a redirection. When we try to import this file, the
bundler will be 'forwarded' to `./FileViewer.tsx`."
([Josh Comeau — file structure](https://www.joshwcomeau.com/react/file-structure/)) Note this is a
*single-component* barrel, not a feature-wide `index.ts` re-exporting dozens of modules — the two
are often conflated in barrel arguments, and bulletproof-react's tree-shaking objection bites the
second much harder than the first.

See `## Disagreements`.

### Import boundaries and dependency rules

**[COMMUNITY] Unidirectional layering.** bulletproof-react: code flows "shared -> features -> app";
shared is importable anywhere, features import only from shared, app imports from both. And: "It
might not be a good idea to import across the features. Instead, compose different features at the
application level." Enforcement is named explicitly: use `import/no-restricted-paths`.
([bulletproof-react](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md))

**[COMMUNITY] FSD states the rule as a one-liner:** "modules on one layer can only know about and
import from modules from the layers strictly below." Slices additionally "cannot import from other
slices on the same layer".
([FSD overview](https://feature-sliced.design/docs/get-started/overview))

**[PRIMARY] `import/no-restricted-paths` exists for exactly this, and its motivating example is the
server/client split.** "Some projects contain files which are not always meant to be executed in the
same environment. For example consider a web application that contains specific code for the server
and some specific code for the browser/client. In this case you don't want to import server-only
files in your client code." Config: `zones[]` of `{ target, from, except?, message? }` plus
`basePath`. "The rule matches resolved file paths rather than literal import strings."
([eslint-plugin-import — no-restricted-paths](https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/no-restricted-paths.md))

**[PRIMARY] Core ESLint `no-restricted-imports`** is the coarser tool: restrict by exact `paths` or
glob/regex `patterns`, with `importNames` / `allowImportNames` / `allowTypeImports` to allow or
block individual exports.
([ESLint — no-restricted-imports](https://eslint.org/docs/latest/rules/no-restricted-imports))

**[PRIMARY] The strongest boundary in a Next.js app is not lint — it is `server-only` /
`client-only`, which fails the build.** "if you try to import the module into a Client Component,
there will be a build-time error."
([Preventing environment poisoning](https://nextjs.org/docs/app/getting-started/server-and-client-components#preventing-environment-poisoning))
Audit checklist from the security guide: "Verify that database packages and environment variables
are not imported outside the Data Access Layer."
([Data security — Auditing](https://nextjs.org/docs/app/guides/data-security#auditing))

**[PRIMARY, second pass] What the `server-only` build error actually is — and it is a package trick,
not compiler magic.** RFC 0227 specifies the mechanism: the packages ship two entry points selected
by the `react-server` export condition, and the wrong-environment entry simply throws. For
`server-only`: "In this case `index.js` throws an error, so if you import this from a Client
Component - even in SSR - you get an error." For `client-only`: "In this case `error.js` throws an
error, so if you import this from a Server Component - you get an error." The same RFC defines the
condition: "The `'react-server'` condition applies only React Server Component environments."
([RFC 0227 — Server Module Conventions](https://github.com/reactjs/rfcs/blob/main/text/0227-server-module-conventions.md))
It also specifies what `'use client'` does to the import: "When a Component with a `"use client"`
directive (similar to `"use strict"`) is imported in a 'React Server' environment its exports gets
replaced with a special 'Reference' object." React 19 confirms the condition is now the supported
library-authoring path: libraries "can now target React 19 as a peer dependency with a
`react-server` export condition". ([React 19](https://react.dev/blog/2024/12/05/react-19))

**[PRIMARY, second pass] `eslint-plugin-boundaries` is the type-based alternative to path-based
zones.** Purpose: "Enforce architectural boundaries in your JavaScript and TypeScript projects" by
"defining dependency rules that match your project's architecture". Files are classified into
*element types* by glob, and rules are written between types rather than between directories:

```javascript
settings: {
  "boundaries/elements": [
    { type: "controller", pattern: "controllers/*" },
    { type: "model", pattern: "models/*" },
    { type: "view", pattern: "views/*" }
  ],
  "boundaries/files": [{ category: "test", pattern: "**/*.test.js" }]
}
```

([eslint-plugin-boundaries README](https://github.com/javierbrea/eslint-plugin-boundaries)) The rule
documentation has since moved to the JS Boundaries site, where the `boundaries/dependencies` rule is
documented as deny-by-default — "When no policies match a dependency, the default is to disallow
it", overridable with `default: "allow"` — with policies shaped
`{ from, to, allow, disallow, message }` and the note "You must provide at least one of `allow` or
`disallow` effect for each policy". It also supports captured-value templating, which is how "a
slice may import only from its own family" is expressed:

```javascript
"boundaries/dependencies": [2, {
  default: "disallow",
  policies: [
    { from: { element: { type: "component" } },
      allow: { to: { element: { type: "component",
        captured: { family: "{{ from.element.captured.family }}" } } } } }
  ]
}]
```

([JS Boundaries — dependencies rule](https://www.jsboundaries.dev/docs/rules/dependencies/)) **How
it differs from `import/no-restricted-paths`:** the latter matches resolved *file paths* in
`zones[]` of `{ target, from, except }` and is allow-by-default; `boundaries` classifies files into
named element types first and is deny-by-default, so the architecture is declared once and every
unlisted edge is an error. For a layered app (`shared → features → app`) the deny-by-default shape
is the one that fails closed when someone adds a new folder.

**[PRIMARY, second pass] TypeScript `paths` is import ergonomics, not a boundary.** "Note that this
feature does not change how import paths are emitted by `tsc`, so `paths` should only be used to
inform TypeScript that another tool has this mapping and will use it at runtime or when bundling."
([tsconfig reference — `paths`](https://www.typescriptlang.org/tsconfig/)) An alias can make a bad
import shorter; it cannot forbid one. Do not sell `@/features/...` aliases as enforcement.

**[PRIMARY, second pass] TypeScript project references *are* a real boundary — the strongest
non-runtime one available.** "Project references allows you to structure your TypeScript programs
into smaller pieces… you can greatly improve build times, **enforce logical separation between
components**, and organize your code in new and better ways." The enforcement is structural:
"Importing modules from a referenced project will instead load its *output* declaration file
(`.d.ts`)", so a project can only reach what a referenced project declares, and unreferenced
projects are unreachable. Requires `composite` (which requires `declaration`).
([TypeScript Handbook — Project References](https://www.typescriptlang.org/docs/handbook/project-references.html))
Relevance to this repo's own layout: this is the mechanism that makes "four standalone packages
sharing code through tsconfig path aliases" either enforced or merely conventional, depending on
whether references are configured.

### Naming conventions

**[PRIMARY] Only two naming rules are actually enforced by React.** "Hook names must start with
`use` followed by a capital letter" and "React component names must start with a capital letter."
Corollary: drop the `use` prefix from anything that calls no hooks.
([Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks#hook-names-always-start-with-use))

**[PRIMARY] Name hooks after the concrete use case, not the lifecycle.** `useChatRoom(...)` /
`useOnlineStatus()` are endorsed; `useMount(fn)` is marked 🔴.
([same page](https://react.dev/learn/reusing-logic-with-custom-hooks#keep-your-custom-hooks-focused-on-concrete-high-level-use-cases))

**[PRIMARY] Name reducer actions after what happened.** "Each action describes a single user
interaction, even if that leads to multiple changes in the data… Choose a name that says what
happened!"
([Extracting State Logic into a Reducer](https://react.dev/learn/extracting-state-logic-into-a-reducer#step-2-write-a-reducer-function))

**[PRIMARY] A Next.js-specific naming rule with teeth:** a Server Function passed as a prop to a
Client Component must be named `action` or end in `Action`. "The TypeScript plugin allows a Client
Component prop typed as a function when its name is `action` or ends in `Action`. The plugin flags
other function props."
([Server and Client Boundary](https://nextjs.org/docs/app/guides/server-and-client-boundary#crossing-the-boundary))

---

## 8. Next.js App Router specifics

**[PRIMARY] The file conventions are a fixed vocabulary:** `layout`, `page`, `loading`, `not-found`,
`error`, `global-error`, `route`, `template`, `default`, plus `@folder` slots and
`(.)`/`(..)`/`(...)` interception. Top-level files include `next.config.js`, `instrumentation.ts`,
`proxy.ts`, `.env*`.
([Project structure — Folder and file conventions](https://nextjs.org/docs/app/getting-started/project-structure#folder-and-file-conventions))

**[PRIMARY] The nesting order is fixed, and it is a rendering contract:** `layout.js` →
`template.js` → `error.js` (error boundary) → `loading.js` (suspense boundary) → `not-found.js` →
`page.js` or a nested `layout.js`, recursively per segment.
([Component hierarchy](https://nextjs.org/docs/app/getting-started/project-structure#component-hierarchy))

**[PRIMARY] Server Components are the default; layouts and pages are Server Components.** "By
default, layouts and pages are Server Components". Use Client Components for state, event handlers,
lifecycle, browser-only APIs, and custom hooks; use Server Components to fetch close to the source,
to use secrets, and to cut shipped JS.
([Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components#when-to-use-server-and-client-components))

**[PRIMARY] `"use client"` is a module-graph boundary, and one per subtree entry is enough.** "'use
client' introduces a server-client boundary in the module dependency tree, effectively creating a
subtree of Client modules." ([react.dev — `use client`](https://react.dev/reference/rsc/use-client))
Next.js: "Once a file is marked with `"use client"`, **all of its imports and the components it
directly renders are included in the client bundle**. This means you don't need to add the directive
to every component that is intended for the client."
([Using Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components#using-client-components))
And: "You only need `'use client'` at the entry to a client subtree, not on every file inside it."
([Server and Client Boundary](https://nextjs.org/docs/app/guides/server-and-client-boundary#crossing-the-boundary))

**[PRIMARY] Push the boundary down, and prefer a wrapper over annotating shared modules.** "To
reduce the size of your client JavaScript bundles, add `'use client'` to specific interactive
components instead of marking large parts of your UI as Client Components." The canonical example
keeps a `Layout` server-side while only `<Search />` is a Client Component.
([Reducing JS bundle size](https://nextjs.org/docs/app/getting-started/server-and-client-components#reducing-js-bundle-size))
Placement tactic: "To leave a shared component unchanged, create a Client Component wrapper that
imports it and place the directive on the wrapper. The wrapper keeps the shared module unchanged and
puts the boundary closer to your application code."
([Server and Client Boundary](https://nextjs.org/docs/app/guides/server-and-client-boundary#crossing-the-boundary))
Syntax constraint: "`'use client'` must be at the very beginning of a file, above any imports or
other code (comments are OK)."
([react.dev — `use client`](https://react.dev/reference/rsc/use-client))

**[PRIMARY] Providers: a client component that takes `children`, rendered as deep as possible.**
"React context is not supported in Server Components. To use context, create a Client Component that
accepts `children`." Then: "**You should render providers as deep as possible in the tree** – notice
how `ThemeProvider` only wraps `{children}` instead of the entire `<html>` document. This makes it
easier for Next.js to optimize the static parts of your Server Components."
([Context providers](https://nextjs.org/docs/app/getting-started/server-and-client-components#context-providers))

**[PRIMARY] Layouts: the root layout is required, owns `<html>`/`<body>`, and preserves state across
navigation.** "On navigation, layouts preserve state, remain interactive, and do not rerender." "The
root layout is **required** and must contain `html` and `body` tags." Multiple root layouts are
possible by removing the top-level `layout.js` and putting one inside each route group — each then
needs its own `<html>`/`<body>`.
([Layouts and Pages](https://nextjs.org/docs/app/getting-started/layouts-and-pages#creating-a-layout);
[Creating multiple root layouts](https://nextjs.org/docs/app/getting-started/project-structure#creating-multiple-root-layouts))

**[PRIMARY] Layout-level dynamic data defeats sibling `loading.js`.** "a layout that accesses
uncached or runtime data (e.g. `cookies()`, `headers()`, or uncached fetches) does not fall back to
a same route segment `loading.js`. Instead, it blocks navigation until the layout finishes
rendering." The docs' guidance: wrap it in its own `<Suspense>`, or move fetching into `page.js`.
"while `loading.js` works well for streaming route segments, using `<Suspense>` closer to the
runtime or uncached data access is recommended."
([Fetching Data — with loading.js](https://nextjs.org/docs/app/getting-started/fetching-data#with-loadingjs))
This is a real architectural constraint on what you are allowed to put in a layout.

**[PRIMARY] Third-party client-only components get a local wrapper.** "you can wrap third-party
components that rely on client-only features in your own Client Components." Library authors are
told the opposite direction: "add the `"use client"` directive to entry points that rely on
client-only features."
([Third-party components](https://nextjs.org/docs/app/getting-started/server-and-client-components#third-party-components))

**[PRIMARY] Client Components also run on the server.** "Run on the server during prerendering, but
must follow the same security assumptions as code running in the browser. Must not access privileged
data or server-only modules."
([Data security](https://nextjs.org/docs/app/guides/data-security#passing-data-from-server-to-client))
Table from the boundary guide: Server Component = server yes / browser no; Client Component = server
yes / browser yes.

**[PRIMARY] Interactivity does not always require a Client Component.** "Built-in browser and HTML
behavior can provide interactivity without a Client Component" — `<details>`, a `<form>` with a
Server Function `action`, `<video controls>`. "A button or form does not require a Client Component
when the browser provides all the required behavior."
([Server and Client Boundary](https://nextjs.org/docs/app/guides/server-and-client-boundary#state-and-interactivity))

### Added in second pass — the intended mental model, and a vendor restatement

**[PRIMARY-adjacent, author of the feature's docs] Abramov's framing: RSC extends the *module
system*, and the directives are doors, not location labels.** "RSC extends the module system (the
`import` and `export` keywords) with novel semantics that let the developer control the
frontend/backend split." "The backend and the frontend each have their own module system… Importing
code *from* either side always bring it *into* that side. The two module systems remain completely
independent." The directives are "'use client' and 'use server' directives that let you *refer* to
the modules from the other world and pass data to them without *bringing them in*." And the
correction of the most common misreading: "The directives aren't for specifying 'where the code
runs' module by module… All they do is let you create 'doors' between the two module systems." His
summary: "you can see an RSC application as a single program spanning two computers—with two
independent module systems, two poison pills, and two doors."
([overreacted.io — How Imports Work in RSC](https://overreacted.io/how-imports-work-in-rsc/),
published 2025-06-05) The "two poison pills" are `server-only` / `client-only` (§7).

**[COMMUNITY / vendor] Vercel's own teaching material states the placement rule as an imperative.**
"Start with Server Components by default; only add `'use client'` when needed." "Extract small
client wrappers (for example, the interactive button), then keep the rest as Server Components."
"Server children stream through client wrapper untouched." Named anti-pattern: "Large Client
Component boundaries force entire tree client-side, bloating bundle" and "Marking a component with
`'use client'` includes all its dependencies in the browser bundle. Keep client boundaries small and
specific."
([Vercel Academy — Client-Server Component Boundaries](https://vercel.com/academy/nextjs-foundations/client-server-boundaries))
Marked community/vendor deliberately: it is Vercel course material, not the Next.js documentation,
and it says nothing the primary docs do not already say — cite the docs first.

---

## 9. Testability as an architectural driver

This section was added in the second pass. Every claim here is a testability argument that a fetched
source makes *itself* — none is inferred.

**[PRIMARY] Purity is what makes logic testable without rendering, and React states the rule.** A
component "does not change any objects or variables that existed before it was called", and the
three render-time inputs (props, state, context) must be treated "as read-only".
([Keeping Components Pure](https://react.dev/learn/keeping-components-pure#purity-components-as-formulas))
Logic that obeys this can be extracted to a plain module and called directly in a test.

**[PRIMARY] The reducer is React's own named example of "move it out so you can test it".** "A
reducer is a pure function that doesn't depend on your component. This means that you can export and
test it separately in isolation." Debuggability is given as a sibling benefit: "you can add a
console log into your reducer to see every state update, and *why* it happened (due to which
`action`)."
([Extracting State Logic into a Reducer — Comparing useState and useReducer](https://react.dev/learn/extracting-state-logic-into-a-reducer#comparing-usestate-and-usereducer))
The constraint that buys this is stated on the same page: "Reducers must be pure… They should not
send requests, schedule timeouts, or perform any side effects."

**[PRIMARY] Effects are the least testable place to put logic, and react.dev's advice is to move it
out.** Derived values should be computed during render rather than synced in an Effect ("don't put
it in state… calculate it during rendering"), and event-triggered logic belongs in a shared plain
function called from handlers, not in an Effect keyed on data changes — the docs' `buyProduct()`
refactor. The decision rule: "Use Effects only for code that should run *because* the component was
displayed to the user."
([You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect#sharing-logic-between-event-handlers))

**[PRIMARY] Anything extractable as a plain function should not be a hook — which also makes it
testable without a renderer.** "If your function doesn't call any Hooks, avoid the `use` prefix.
Instead, write it as a regular function *without* the `use` prefix", because the plain function "can
be called conditionally".
([Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks#when-to-use-custom-hooks))
Practical reading: `useSorted` needs a React test harness; `getSorted` needs one assertion.

**[PRIMARY] Centralizing data access is argued partly as an auditability property — the same
property that makes it testable in one place.** The DAL "centralizes all data access logic, making
it easier to enforce consistent data access and reduces the risk of authorization bugs", and the
audit checklist asks "Is there an established practice for an isolated Data Access Layer?"
([Data security](https://nextjs.org/docs/app/guides/data-security#data-access-layer);
[Auditing](https://nextjs.org/docs/app/guides/data-security#auditing)) Authorization logic that
lives in one server-only module can be unit-tested; the same logic scattered across components and
actions can only be tested end-to-end.

**[COMMUNITY] Redux makes the testability argument explicitly a *placement* argument.** "try to put
as much of the logic for calculating a new state into the appropriate reducer, rather than in the
code that prepares and dispatches the action (like a click handler). This helps ensure that more of
the actual app logic is easily testable."
([Redux Style Guide](https://redux.js.org/style-guide/#put-as-much-logic-as-possible-in-reducers))
And derived data belongs in selectors, which "can be memoized"
([Keep State Minimal and Derive Additional Values](https://redux.js.org/style-guide/#keep-state-minimal-and-derive-additional-values)).

**[COMMUNITY] Test utilities get their own top-level home, not a per-feature one.**
bulletproof-react lists `src/testing` for "Test utilities and mocks" at the top level while
everything else is feature-scoped.
([bulletproof-react](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md))
Kent's colocation principle makes the matching exception explicit: integration and E2E tests do not
colocate, because E2E tests "don't really care how the `src/` is organized at all".
([Colocation](https://kentcdodds.com/blog/colocation))

**Synthesis (this is inference, marked as such):** the four primary testability levers all point the
same way — purity, plain functions over hooks, reducers over scattered setters, and one server-only
module for data access and authorization. None of them is a folder rule; each is a rule about *what
kind of thing* the logic is. A skill should prefer "extract to a pure module" over "move to
`utils/`".

---

## Disagreements and open questions

**Container / presentational — reportedly retracted by its author, but the retraction is not
verifiable from here.** Second pass outcome: Medium 403s, `web.archive.org` is unreachable from this
environment, the post was not re-hosted on overreacted.io, and patterns.dev — the most likely
secondary carrier — does not quote him at all. The quote survives only via the readmedium mirror.
**Downgraded to [COMMUNITY, reported]**; §2 records the full attempt list and gives the primary-only
argument that does not need the quote. But RSC reintroduces a *forced* server/client split that
looks like it and is often described as its successor. The distinction that matters: the RSC split
is imposed by the runtime (module graph, serializability), not chosen as a style. No primary source
calls RSC "container/presentational". Treat any such framing as community interpretation.

**Barrel files.** bulletproof-react says avoid them (bundler/tree-shaking cost); FSD's whole
enforcement model presumes a per-slice public API, which in practice is a barrel; Josh Comeau builds
his entire structure on a one-line `index.ts` per component. No official React or Next.js page rules
either way. Sharpened in the second pass: the disputants are not talking about the same object.
Comeau's barrel re-exports **one** component from its own folder; bulletproof-react's objection is
about barrels that re-export **many** modules and thereby pull a whole feature into the graph on a
single import. Those positions are compatible. The only hard datum remains that static properties
(`Menu.Item`) break across the RSC boundary, pushing toward named exports.

**Feature folders at all.** This is a sharper conflict than feature *isolation*. bulletproof-react,
FSD and the Redux Style Guide all organize by feature/domain; Comeau rejects it outright — "real
life isn't nicely segmented like this, and categorization is actually *really hard*" — and organizes
by function with a flat `components/` directory
([Comeau](https://www.joshwcomeau.com/react/file-structure/)). Next.js lists "Split project files by
feature or route" as one of three equal options and endorses none
([Project structure](https://nextjs.org/docs/app/getting-started/project-structure#examples)). There
is no primary tiebreaker. Note the sample bias: Comeau writes about a blog and a course platform;
FSD and bulletproof-react target large multi-team apps. Scale is the likely hidden variable, and no
source in this corpus states a threshold.

**`src/` vs root.** Next.js frames `src/` as optional and purely about separating app code from
config ([src folder](https://nextjs.org/docs/app/getting-started/project-structure#src-folder)),
while bulletproof-react and FSD both *assume* `src/` as the root of their layer model. Practical
tiebreaker recorded in the docs: `.env.*` must stay at the project root even with `src/`.

**Where to put shared code: inside `app/` or beside it.** Next.js lists both without preferring
either; "colocate inside route segments" and "keep `app/` purely for routing" are presented as equal
options on the same page. Anyone writing a rule here is choosing, not citing.

**`utils` vs `helpers` vs `lib` vs `services`.** There is *no* primary source. The only officially
named layer is the Data Access Layer. `services/` appears in neither bulletproof-react nor FSD's
segment vocabulary. Any distinction is local convention.

**Feature isolation strength.** bulletproof-react says cross-feature imports are merely "not a good
idea"; FSD makes same-layer slice imports a hard rule. Neither is primary. Next.js offers no feature
concept at all.

**Component size heuristics.** No primary source gives a line count. React's criteria are
responsibility ("concerned with one thing"), data-model correspondence, and spread-out state updates
(→ reducer). Any "keep components under N lines" rule is invented.

**TanStack Query + RSC — partially settled in the second pass, and the remainder is genuinely
unsettled.** Now answered by official docs: the client is built by a per-environment factory, never
a module singleton ("Server: always make a new query client"); Server Components are "a place to
prefetch data, nothing more"; and `<HydrationBoundary>` boilerplate per route "is not possible" to
abstract away under Server Components
([Advanced SSR](https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr)).

Still unsettled, and *why*: the docs answer construction and prefetch placement but are silent on
where `queryKey` factories and query hooks live, and they actively discourage reusing one query hook
across both environments. That collides with TkDodo's "one Query Key factory per feature, colocated"
advice, which is pre-RSC and assumes a single client-side consumer. The underlying tension is
ownership: a key factory is shared vocabulary between a server prefetch and a client hook, so it
wants to be in a neutral module — but the neutral module is exactly the kind of shared import that
the RFC's shared-component constraints govern (no state, no effects, no server data access,
importable by both graphs). Nothing in the fetched corpus resolves it. **Recommended posture for a
skill: state the factory-and-prefetch rules as sourced, and mark key-factory placement as a project
decision.**

**Scope of research after the second pass.** Now fetched and incorporated: React 19 release post,
RFC 0188 (RSC), RFC 0227 (server module conventions),
`react.dev/reference/rsc/{use-server,server-functions}`, `creating-a-react-app`, Abramov's "How
Imports Work in RSC", `eslint-plugin-boundaries` + JS Boundaries, TypeScript project references and
`paths`, Josh Comeau, Vercel Academy, TanStack Advanced SSR, and Next.js route segment config. Still
not fetched, and therefore not cited anywhere: Vercel *engineering blog* posts about structure
(searching vercel.com surfaced only Academy course material and performance/product posts — no
structure-and-boundaries engineering post was found, so this priority came up empty rather than
being skipped), and `overreacted.io/rsc-from-scratch/`, which **does not exist** under that slug
(404; his RSC writing lives under other slugs, one of which is now cited).

---

## Sources

### Primary / official

1. <https://nextjs.org/docs/app/getting-started/project-structure> — authoritative for file/folder
   conventions, colocation, private folders, route groups, `src/`, and the explicit statement that
   Next.js is unopinionated about layout. Reported version 16.3.5, `lastUpdated` 2026-07-21.
   **Fetched.**
2. <https://nextjs.org/docs/app/getting-started/server-and-client-components> — authoritative for
   when to use each, `"use client"` bundle semantics, interleaving, providers, third-party wrappers,
   `server-only`/`client-only`. `lastUpdated` 2026-08-25. **Fetched.**
3. <https://nextjs.org/docs/app/guides/server-and-client-boundary> — authoritative for module graph
   vs render tree, what crosses (code via imports, data via serializable props), owner vs parent,
   compound-component breakage, `action`-naming TS rule. `lastUpdated` 2026-08-25. **Fetched.**
4. <https://nextjs.org/docs/app/guides/data-security> — authoritative for the Data Access Layer,
   DTOs, `process.env` confinement, Server Action endpoint exposure, re-authorization inside
   actions, the audit checklist. `lastUpdated` 2026-08-25. **Fetched.**
5. <https://nextjs.org/docs/app/getting-started/fetching-data> — authoritative for where fetching
   belongs, `fetch` memoization, `React.cache`, preload colocation, `loading.js` vs `<Suspense>`,
   client-side options. `lastUpdated` 2026-09-07. **Fetched.**
6. <https://nextjs.org/docs/app/getting-started/layouts-and-pages> — authoritative for root layout
   requirements, nested layouts, `searchParams` vs `useSearchParams`. `lastUpdated` 2026-08-25.
   **Fetched.**
7. <https://nextjs.org/docs/app/api-reference/directives/use-server> — authoritative for file-level
   vs inline `'use server'`, the dedicated-file requirement for client imports, auth/return-value
   rules. `lastUpdated` 2026-08-25. **Fetched.**
8. <https://nextjs.org/docs/app/guides/environment-variables> — authoritative for `NEXT_PUBLIC_`
   inlining, build-time freezing, no dynamic lookups, `.env` at root even with `src/`. **Fetched.**
9. <https://react.dev/learn/thinking-in-react> — authoritative for component decomposition by
   responsibility and data model, and for minimal state. **Fetched.**
10. <https://react.dev/learn/reusing-logic-with-custom-hooks> — authoritative for hook naming,
    "share stateful logic not state", when to extract, concrete-use-case rule. **Fetched.**
11. <https://react.dev/learn/you-might-not-need-an-effect> — authoritative for derived values over
    state, effects-vs-event-handlers, and the "frameworks fetch better than Effects" note.
    **Fetched.**
12. <https://react.dev/learn/extracting-state-logic-into-a-reducer> — authoritative for reducer
    purity, testability outside the component, useState-vs-useReducer trade-offs, action naming.
    **Fetched.**
13. <https://react.dev/learn/keeping-components-pure> — authoritative for what render may read,
    module-scope mutation as an anti-pattern, local mutation, side effects in event handlers.
    **Fetched.**
14. <https://react.dev/reference/rsc/server-components> — authoritative for what a Server Component
    is and that it cannot use `useState`. **Fetched.**
15. <https://react.dev/reference/rsc/use-client> — authoritative for the directive's placement
    rules, module-dependency-tree boundary, and the serializable-props allow/deny list. **Fetched.**
16. <https://tanstack.com/query/latest/docs/framework/react/guides/query-keys> — authoritative for
    query key structure, hashing, and dependency semantics. **Fetched.**
17. <https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/no-restricted-paths.md>
    — authoritative for zone-based import boundary enforcement (`zones`, `target`, `from`, `except`,
    `basePath`). **Fetched.**
18. <https://eslint.org/docs/latest/rules/no-restricted-imports> — authoritative for core ESLint
    import restriction options. **Fetched.**
19. <https://readmedium.com/smart-and-dumb-components-7ca2f9a7c7d0> — mirror of Dan Abramov's
    "Presentational and Container Components", used **only** for his own 2019 retraction note.
    **Fetched** (the canonical
    `https://medium.com/@dan_abramov/smart-and-dumb-components-7ca2f9a7c7d0` returned **HTTP 403 and
    could not be fetched** — cite the retraction as Abramov's words via this mirror, and re-verify
    against Medium before publishing a skill).
20. <https://overreacted.io/the-two-reacts/> — Dan Abramov on `UI = f(data, state)` and why the
    server/client split exists at all. Background for section 8, not a source of rules. **Fetched.**

### Community / opinionated

21. <https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md> — the most
    cited concrete folder structure: `features/`, `lib` vs `utils` vs `config`, anti-barrel stance,
    unidirectional `shared → features → app`, `import/no-restricted-paths` enforcement. **Fetched.**
22. <https://feature-sliced.design/docs/get-started/overview> — layers/slices/segments and the hard
    import rule ("only from layers strictly below"). **Fetched.**
23. <https://redux.js.org/style-guide/> — feature folders with single-file slice logic, logic in
    reducers, minimal + derived state, state shaped by data type not by screen. Official to Redux
    but self-described as a style guide. **Fetched.**
24. <https://kentcdodds.com/blog/colocation> — the colocation principle and its explicit exceptions.
    **Fetched.**
25. <https://kentcdodds.com/blog/application-state-management-with-react> — colocate state, lift to
    lowest common ancestor, server cache vs UI state, split contexts. **Fetched.**
26. <https://tkdodo.eu/blog/effective-react-query-keys> — query keys colocated per feature, key
    factories, generic→specific ordering. Author is a TanStack Query maintainer; still a blog.
    **Fetched.**
27. <https://tkdodo.eu/blog/react-query-as-a-state-manager> — server state is not owned by the
    frontend, `staleTime` as the knob, one custom hook per query. **Fetched.**

### Primary / official — added in the second pass

28. <https://react.dev/reference/rsc/use-server> — authoritative for `'use server'` placement,
    "treat them as untrusted input", authorization inside every Server Function, and the
    argument/return serializability list (incl. `FormData`). **Fetched.**
29. <https://react.dev/reference/rsc/server-functions> — authoritative for what a Server Function
    is, the two ways to define one, and the Server Function vs Server Action distinction (renamed
    September 2024). **Fetched.**
30. <https://react.dev/blog/2024/12/05/react-19> — authoritative for "there is no directive for
    Server Components", the Server Actions description, and the `react-server` export condition as
    the library-authoring path. Dated December 5 2024 (originally April 25 2024). **Fetched.**
31.
    <https://react.dev/learn/creating-a-react-app#which-features-make-up-the-react-teams-full-stack-architecture-vision>
    — authoritative for the React team's intended full-stack model in their own words, including the
    annotated server-component example. **Fetched.**
32. <https://github.com/reactjs/rfcs/blob/main/text/0188-server-components.md> — the RSC
    specification RFC; authoritative for the may/may-not capability split and for the *shared
    components* category. **Fetched.**
33. <https://github.com/reactjs/rfcs/blob/main/text/0227-server-module-conventions.md> —
    authoritative for the module-convention design: `'use client'` imports becoming Reference
    objects, the `react-server` export condition, and the actual `server-only` / `client-only` throw
    mechanism. **Fetched.**
34. <https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config> —
    authoritative for config-as-exported-constants in route files and for which options were removed
    in v16. Version 16.3.5, `lastUpdated` 2026-04-30. **Fetched.**
35. <https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr> — authoritative for
    per-request QueryClient creation, "Server Components as a place to prefetch data, nothing more",
    and the un-abstractable `<HydrationBoundary>` boilerplate. **Fetched.**
36. <https://github.com/javierbrea/eslint-plugin-boundaries> — authoritative for element-type-based
    boundary enforcement and the `boundaries/elements` settings shape. **Fetched** (note: its
    `docs/rules/*.md` files now redirect — see failures).
37. <https://www.jsboundaries.dev/docs/rules/dependencies/> — current authoritative docs for the
    `boundaries/dependencies` rule: deny-by-default, `{ from, to, allow, disallow, message }`
    policies, captured-value templating. **Fetched.**
38. <https://www.typescriptlang.org/docs/handbook/project-references.html> — authoritative for
    project references as a real, compiler-enforced boundary ("enforce logical separation",
    `.d.ts`-only consumption, `composite`). **Fetched.**
39. <https://www.typescriptlang.org/tsconfig/> — authoritative for `paths`/`baseUrl` and the warning
    that `paths` does not change emitted imports, i.e. aliases are not enforcement. **Fetched.**
40. <https://www.typescriptlang.org/docs/handbook/modules/theory.html> — used as an **established
    absence**: module mechanics only, no guidance on barrel files, re-exports, or path aliases.
    **Fetched.**
41. <https://overreacted.io/how-imports-work-in-rsc/> — Dan Abramov (2025-06-05) on RSC as a
    module-system extension: two independent module systems, "two poison pills, and two doors", and
    the explicit denial that directives specify where code runs. Author-of-the-feature writing, not
    documentation. **Fetched.**

### Community / opinionated — added in the second pass

42. <https://www.joshwcomeau.com/react/file-structure/> — the strongest published
    *anti*-feature-folder, *pro*-barrel structure: flat `components/`, one folder per component with
    an `index.ts`, rejection of Atomic Design and of feature grouping, plus the only source
    distinguishing `helpers/` from `utils/` and placing `src/constants.ts`. **Fetched.**
43. <https://vercel.com/academy/nextjs-foundations/client-server-boundaries> — Vercel course
    material restating the boundary-placement rules as imperatives ("Start with Server Components by
    default"; "Extract small client wrappers"). Vendor education, not documentation. **Fetched.**
44. <https://www.patterns.dev/react/presentational-container-pattern/> — used only as **negative
    evidence** for the Abramov retraction (it does not quote him) and for its own claim that "Modern
    React strongly favors Hooks over container components". **Fetched.**

### Attempted and failed

- `https://medium.com/@dan_abramov/smart-and-dumb-components-7ca2f9a7c7d0` — **HTTP 403**. Content
  obtained via the mirror at entry 19; treat the quote as second-hand until re-verified.
- `https://nextjs.org/docs/app/getting-started/updating-data` — **404, page does not exist** at this
  docs version. Server Function guidance was taken from entries 4 and 7 instead.
- `https://www.freecodecamp.org/news/smart-and-dumb-components-in-react/` — **404**. Not used.

Second pass:

-
  `https://web.archive.org/web/2023/https://medium.com/@dan_abramov/smart-and-dumb-components-7ca2f9a7c7d0`
  — **this environment cannot fetch `web.archive.org` at all** ("Claude Code is unable to fetch from
  web.archive.org"). The Abramov retraction therefore remains mirror-only; see §2.
- `https://overreacted.io/rsc-from-scratch/` — **404, the slug does not exist.** A domain-scoped
  search found his RSC writing under other slugs; `how-imports-work-in-rsc` was fetched and cited
  instead. Not fetched and therefore not cited: `why-does-rsc-integrate-with-a-bundler`,
  `impossible-components`, `progressive-json`, `rsc-for-astro-developers`.
- `https://www.npmjs.com/package/server-only` — **HTTP 403.** The package's mechanism was instead
  sourced from RFC 0227 (entry 33), which specifies it normatively.
- `https://legacy.reactjs.org/blog/2020/12/21/data-fetching-with-react-server-components.html` —
  **fetched but substantively empty**: the page carries only the title, the authors ("December 21,
  2020 by Dan Abramov, Lauren Tan, Joseph Savona, and Sebastian Markbåge"), and "React Server
  Components are still in research and development", then defers to a talk and the RFC. Not cited
  for any architectural claim; RFC 0188 (entry 32) was used instead.
- `https://github.com/javierbrea/eslint-plugin-boundaries/blob/master/docs/rules/element-types.md` —
  **content migrated away**: "This documentation has been migrated to the JS Boundaries project
  website." Superseded by entry 37.
- **Vercel engineering blog posts on structure and boundaries — not found.** A domain-scoped search
  of vercel.com returned Academy course pages, templates, product posts and the Layouts RFC summary,
  but no engineering post about code organization or architectural boundaries. Priority came up
  empty; nothing was padded in from performance-only material.
- `https://nextjs.org/docs/app/getting-started/updating-data` — **404** (first pass), noted above.
