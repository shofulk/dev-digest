# frontend-ui-architecture — sources

Every claim in `SKILL.md` and `references/*.md` cites one of the numbered entries below. The numbers
are stable: cite `[17]`, not a URL.

**Research date:** 2026-09-20. **Next.js docs version at fetch time:** 16.3.5 (pages reported their
own `lastUpdated`, noted where it matters). Full research notes, with the verbatim quotes behind each
claim, live in this repository at `docs/research/react-frontend-architecture.md`.

## How authority is marked

The skill separates three tiers, and the distinction is the point of this file:

- **SPECIFIED** — entries 1–41 below: official documentation, RFCs, or a tool's own rule docs.
- **CONVENTION** — entries 42–44 plus 21–27: widely used, sometimes near-universal, but no official
  source backs them. The Redux Style Guide is official *to Redux* but is a style guide by its own
  framing; TkDodo maintains TanStack Query but the blog is not the docs; Vercel Academy is vendor
  course material, not the Next.js documentation.
- **UNSPECIFIED** — no source exists. Recorded explicitly (see "Established absences" below) so that
  nobody re-derives a rule and presents it as authoritative.

Every entry below was **actually fetched** during research. Sources that could not be fetched are
listed separately at the end and are **not** cited as evidence anywhere in the skill.

## Primary / official

1. <https://nextjs.org/docs/app/getting-started/project-structure> — file/folder conventions,
   colocation, private folders, route groups, `src/`, and the statement that Next.js is unopinionated
   about layout. `lastUpdated` 2026-07-21.
2. <https://nextjs.org/docs/app/getting-started/server-and-client-components> — when to use each,
   `'use client'` bundle semantics, interleaving, providers, third-party wrappers,
   `server-only`/`client-only`. `lastUpdated` 2026-08-25.
3. <https://nextjs.org/docs/app/guides/server-and-client-boundary> — module graph vs render tree, what
   crosses the boundary, owner vs parent, compound-component breakage, the `action`-naming rule.
   `lastUpdated` 2026-08-25.
4. <https://nextjs.org/docs/app/guides/data-security> — the Data Access Layer, DTOs, `process.env`
   confinement, Server Action endpoint exposure, re-authorization inside actions, the audit checklist.
   `lastUpdated` 2026-08-25.
5. <https://nextjs.org/docs/app/getting-started/fetching-data> — where fetching belongs, `fetch`
   memoization, `React.cache`, preload colocation, `loading.js` vs `<Suspense>`, client-side options.
   `lastUpdated` 2026-09-07.
6. <https://nextjs.org/docs/app/getting-started/layouts-and-pages> — root layout requirements, nested
   layouts, `searchParams` vs `useSearchParams`. `lastUpdated` 2026-08-25.
7. <https://nextjs.org/docs/app/api-reference/directives/use-server> — file-level vs inline
   `'use server'`, the dedicated-file requirement for client imports, auth and return-value rules.
   `lastUpdated` 2026-08-25.
8. <https://nextjs.org/docs/app/guides/environment-variables> — `NEXT_PUBLIC_` inlining, build-time
   freezing, why dynamic lookups fail, `.env` at root even with `src/`.
9. <https://react.dev/learn/thinking-in-react> — component decomposition by responsibility and data
   model; minimal state.
10. <https://react.dev/learn/reusing-logic-with-custom-hooks> — hook naming, "share stateful logic not
    state", when to extract, the concrete-use-case rule, `getSorted` over `useSorted`.
11. <https://react.dev/learn/you-might-not-need-an-effect> — derived values over state, effects vs
    event handlers, and why frameworks fetch better than Effects.
12. <https://react.dev/learn/extracting-state-logic-into-a-reducer> — reducer purity, testability in
    isolation, useState-vs-useReducer trade-offs, action naming.
13. <https://react.dev/learn/keeping-components-pure> — what render may read, module-scope mutation as
    an anti-pattern, local mutation, side effects in event handlers.
14. <https://react.dev/reference/rsc/server-components> — what a Server Component is; it cannot use
    `useState`.
15. <https://react.dev/reference/rsc/use-client> — directive placement, the module-dependency-tree
    boundary, the serializable-props allow/deny list.
16. <https://tanstack.com/query/latest/docs/framework/react/guides/query-keys> — query key structure,
    hashing, dependency semantics.
17. <https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/no-restricted-paths.md> —
    zone-based import boundary enforcement (`zones`, `target`, `from`, `except`, `basePath`).
18. <https://eslint.org/docs/latest/rules/no-restricted-imports> — core ESLint import restriction
    options.
19. <https://readmedium.com/smart-and-dumb-components-7ca2f9a7c7d0> — mirror of Dan Abramov's
    "Presentational and Container Components", used **only** for his reported retraction. See the
    caveat under "Known weaknesses".
20. <https://overreacted.io/the-two-reacts/> — Dan Abramov on `UI = f(data, state)` and why the
    server/client split exists. Background, not a source of rules.
21. <https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md> — the most
    cited concrete folder structure: `features/`, `lib` vs `utils` vs `config`, the anti-barrel stance,
    unidirectional `shared → features → app`, `import/no-restricted-paths` enforcement.
22. <https://feature-sliced.design/docs/get-started/overview> — layers, slices, segments, and the hard
    import rule ("only from layers strictly below").
23. <https://redux.js.org/style-guide/> — feature folders, logic in reducers, minimal and derived
    state, state shaped by data type not by screen, actions as events.
24. <https://kentcdodds.com/blog/colocation> — the colocation principle and its explicit exceptions.
25. <https://kentcdodds.com/blog/application-state-management-with-react> — colocate state, lift to
    the lowest common ancestor, server cache vs UI state, split contexts.
26. <https://tkdodo.eu/blog/effective-react-query-keys> — query keys colocated per feature, key
    factories, generic→specific ordering.
27. <https://tkdodo.eu/blog/react-query-as-a-state-manager> — server state is not owned by the
    frontend, `staleTime` as the knob, one custom hook per query.
28. <https://react.dev/reference/rsc/use-server> — `'use server'` placement, "treat them as untrusted
    input", authorization inside every Server Function, the argument/return serializability list
    (including `FormData`).
29. <https://react.dev/reference/rsc/server-functions> — what a Server Function is and the Server
    Function vs Server Action distinction (renamed September 2024).
30. <https://react.dev/blog/2024/12/05/react-19> — "there is no directive for Server Components"; the
    `react-server` export condition as the library-authoring path. Dated 2024-12-05.
31. <https://react.dev/learn/creating-a-react-app> — the React team's intended full-stack model in
    their own words, including the annotated Server Component example (section: "Which features make up
    the React team's full-stack architecture vision?"). Background for the RSC sections, not a source
    of rules; the same section stresses that "Server Components and Suspense are React features rather
    than Next.js features".
32. <https://github.com/reactjs/rfcs/blob/main/text/0188-server-components.md> — the RSC specification
    RFC: the may/may-not capability split and the **shared components** third category.
33. <https://github.com/reactjs/rfcs/blob/main/text/0227-server-module-conventions.md> — the module
    conventions: `'use client'` imports becoming Reference objects, the `react-server` export
    condition, and the actual `server-only`/`client-only` throw mechanism.
34. <https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config> —
    config-as-exported-constants in route files, and which options were removed in v16. Version 16.3.5,
    `lastUpdated` 2026-04-30.
35. <https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr> — per-request
    QueryClient creation, "Server Components as a place to prefetch data, nothing more", and the
    un-abstractable `<HydrationBoundary>` boilerplate.
36. <https://github.com/javierbrea/eslint-plugin-boundaries> — element-type-based boundary enforcement
    and the `boundaries/elements` settings shape.
37. <https://www.jsboundaries.dev/docs/rules/dependencies/> — current docs for the
    `boundaries/dependencies` rule: deny-by-default, `{ from, to, allow, disallow, message }` policies,
    captured-value templating.
38. <https://www.typescriptlang.org/docs/handbook/project-references.html> — project references as a
    real, compiler-enforced boundary ("enforce logical separation", `.d.ts`-only consumption,
    `composite`).
39. <https://www.typescriptlang.org/tsconfig/> — `paths`/`baseUrl`, and the warning that `paths` does
    not change emitted imports, i.e. aliases are not enforcement.
40. <https://www.typescriptlang.org/docs/handbook/modules/theory.html> — cited as an **established
    absence**: module mechanics only, no guidance on barrel files, re-exports or path aliases.
41. <https://overreacted.io/how-imports-work-in-rsc/> — Dan Abramov (2025-06-05) on RSC as a
    module-system extension: two independent module systems, "two poison pills, and two doors", and the
    explicit denial that directives specify where code runs. Author-of-the-feature writing, not
    documentation.

## Community / opinionated

42. <https://www.joshwcomeau.com/react/file-structure/> — the strongest published
    *anti*-feature-folder, *pro*-barrel structure: flat `components/`, one folder per component with an
    `index.ts`, rejection of Atomic Design **and** of feature grouping, plus the only source
    distinguishing `helpers/` from `utils/` and placing `src/constants.ts`.
43. <https://vercel.com/academy/nextjs-foundations/client-server-boundaries> — Vercel course material
    restating the boundary-placement rules as imperatives. Vendor education, not documentation.
44. <https://www.patterns.dev/react/presentational-container-pattern/> — used as **negative evidence**
    for the Abramov retraction (it does not quote him), and for its own claim that "Modern React
    strongly favors Hooks over container components".

## Established absences

Recorded deliberately, after searching. These are findings, not gaps — the skill presents each as a
project-level decision rather than inventing a rule.

- **Where application constants belong.** No guidance in React, Next.js or the TypeScript handbook.
  Checked: [13] (constrains mutation, not placement), [8] and [34] (framework config, not domain
  constants), [23] (no rule on action-type constants), [40] (module mechanics only).
- **`utils/` vs `helpers/` vs `lib/` vs `services/`.** No primary source distinguishes them [1][40].
  `services/` appears in no source at all — not in [21], not in [22]. The only officially named layer
  is the Data Access Layer [4], which is server-only by definition and therefore none of the four.
- **Barrel files.** No official React or Next.js position either way; the TypeScript handbook is
  explicitly silent [40].
- **Component size.** No primary source gives a line count.
- **Where shared code goes (inside `app/` or beside it).** Next.js presents both as equal options on
  the same page [1].
- **Where TanStack Query key factories live.** [35] settles client construction and prefetch placement
  but not this; [26] predates RSC.

## Known weaknesses

Read before quoting the skill as gospel.

- **The Abramov retraction (entry 19) is mirror-only.** Medium returns HTTP 403; `web.archive.org` was
  unreachable from the research environment; the post was not re-hosted on overreacted.io; and
  patterns.dev [44] does not quote him. The skill therefore tags it as *reported* and rests its actual
  argument on [9] and [10], which need no quote. If you can reach Medium, re-verify.
- **Next.js version drift.** Entries 1–8 and 34 were read at 16.3.5. Route segment config in
  particular is version-volatile [34] — re-check before relying on which options exist.
- **No Vercel engineering-blog source exists.** A domain-scoped search surfaced only Academy course
  pages, templates and product/performance posts. Entry 43 is course material, cited as vendor and
  subordinate to the docs; no engineering post on structure and boundaries was found.

## Attempted and not fetched

Not cited as evidence anywhere in the skill.

- <https://medium.com/@dan_abramov/smart-and-dumb-components-7ca2f9a7c7d0> — HTTP 403. Content reached
  via the mirror, entry 19.
- `web.archive.org` snapshots of the above — the research environment cannot fetch `web.archive.org`
  at all. A tooling limit, not a missing snapshot.
- <https://nextjs.org/docs/app/getting-started/updating-data> — 404 at this docs version. Server
  Function guidance taken from [4] and [7] instead.
- <https://www.npmjs.com/package/server-only> — 403. Recovered normatively from RFC 0227 [33], which
  specifies the mechanism rather than describing it.
- <https://overreacted.io/rsc-from-scratch/> — does not exist under that slug (404). Entry 41 is the
  RSC post that does exist.
- <https://legacy.reactjs.org/blog/2020/12/21/data-fetching-with-react-server-components.html> —
  fetched but substantively empty (defers to a talk). RFC 0188 [32] used instead.
- `eslint-plugin-boundaries` `docs/rules/*.md` on GitHub — migrated to the JS Boundaries site;
  superseded by [37].
- <https://www.freecodecamp.org/news/smart-and-dumb-components-in-react/> — 404.
