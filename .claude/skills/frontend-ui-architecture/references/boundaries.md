# Boundaries: barrels, imports, and what actually enforces a layer

The recurring mistake here is selling a convention as enforcement. Exactly one boundary in a
React/Next codebase fails the build, and it is not ESLint and not a path alias.

## Ranked by how hard they are to violate

| Mechanism | Enforcement | Notes |
|---|---|---|
| `server-only` / `client-only` | **Build error** | The real boundary. [2][33] |
| TypeScript project references | **Compiler** | Consumers see only the referenced project's `.d.ts`. [38] |
| `eslint-plugin-boundaries` | Lint, deny-by-default | Architecture declared once; unlisted edges error. [36][37] |
| `import/no-restricted-paths` | Lint, allow-by-default | Path-based zones. [17] |
| `no-restricted-imports` | Lint, coarse | By exact path or pattern. [18] |
| `tsconfig` `paths` aliases | **None** | Ergonomics only. [39] |

## `server-only` / `client-only` — the one with teeth

**SPECIFIED.** "you can mark a module with the `server-only` package… This ensures that proprietary
code or internal business logic stays on the server by causing a build error if the module is imported
in the client environment." The mirror is `client-only`. Installing them is optional in Next.js, which
handles the imports internally. [2] And: "if you try to import the module into a Client Component,
there will be a build-time error." [2]

**SPECIFIED — what the error actually is.** It is a package trick, not compiler magic, and knowing
this is what lets you explain it. RFC 0227 specifies the mechanism: the packages ship two entry points
selected by the `react-server` export condition, and the wrong-environment entry throws. For
`server-only`: "In this case `index.js` throws an error, so if you import this from a Client Component
- even in SSR - you get an error." For `client-only`: "In this case `error.js` throws an error, so if
you import this from a Server Component - you get an error." The condition itself: "The
`'react-server'` condition applies only React Server Component environments." [33]

The same RFC specifies what `'use client'` does to an import: "When a Component with a `"use client"`
directive… is imported in a 'React Server' environment its exports gets replaced with a special
'Reference' object." [33] React 19 confirms the condition is the supported library-authoring path:
libraries "can now target React 19 as a peer dependency with a `react-server` export condition". [30]

**SPECIFIED, the audit question worth stealing.** "Verify that database packages and environment
variables are not imported outside the Data Access Layer." [4]

## The mental model that prevents most boundary bugs

**Author-of-the-feature framing.** RSC extends the module system rather than labeling locations:
"The backend and the frontend each have their own module system… Importing code *from* either side
always bring it *into* that side. The two module systems remain completely independent." The
directives "let you *refer* to the modules from the other world and pass data to them without
*bringing them in*." And the correction of the most common misreading: "The directives aren't for
specifying 'where the code runs' module by module… All they do is let you create 'doors' between the
two module systems." His summary: "you can see an RSC application as a single program spanning two
computers—with two independent module systems, two poison pills, and two doors." [41]

The two poison pills are `server-only` / `client-only`. If someone is confused about why a directive
"didn't work", this framing usually resolves it.

## ESLint boundary rules

**SPECIFIED.** `import/no-restricted-paths` exists for exactly this, and its motivating example is the
server/client split: "consider a web application that contains specific code for the server and some
specific code for the browser/client. In this case you don't want to import server-only files in your
client code." Config is `zones[]` of `{ target, from, except?, message? }` plus `basePath`, and "The
rule matches resolved file paths rather than literal import strings." [17]

**SPECIFIED.** Core ESLint `no-restricted-imports` is coarser: restrict by exact `paths` or
glob/regex `patterns`, with `importNames` / `allowImportNames` / `allowTypeImports`. [18]

**SPECIFIED.** `eslint-plugin-boundaries` is the type-based alternative: "Enforce architectural
boundaries in your JavaScript and TypeScript projects" by "defining dependency rules that match your
project's architecture". Files are classified into *element types* by glob, and rules are written
between types rather than between directories: [36]

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

The `boundaries/dependencies` rule is **deny-by-default** — "When no policies match a dependency, the
default is to disallow it", overridable with `default: "allow"` — with policies shaped
`{ from, to, allow, disallow, message }`, and "You must provide at least one of `allow` or `disallow`
effect for each policy". Captured-value templating is how "a slice may import only from its own
family" is expressed: [37]

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

**How to choose.** `import/no-restricted-paths` matches resolved *file paths* and is allow-by-default;
`boundaries` classifies files into named element types and is deny-by-default. For a layered app
(`shared → features → app`), deny-by-default is the one that **fails closed** when someone adds a new
folder — which is usually what you want from an architecture rule.

## TypeScript: aliases are not boundaries, project references are

**SPECIFIED.** "Note that this feature does not change how import paths are emitted by `tsc`, so
`paths` should only be used to inform TypeScript that another tool has this mapping and will use it at
runtime or when bundling." [39] An alias can make a bad import *shorter*; it cannot forbid one. Never
sell `@/features/...` aliases as enforcement.

**SPECIFIED.** Project references are a real, compiler-enforced boundary: "Project references allows
you to structure your TypeScript programs into smaller pieces… you can greatly improve build times,
**enforce logical separation between components**, and organize your code in new and better ways." The
enforcement is structural: "Importing modules from a referenced project will instead load its *output*
declaration file (`.d.ts`)", so a project reaches only what a referenced project declares, and
unreferenced projects are unreachable. Requires `composite` (which requires `declaration`). [38]

**Practical consequence.** If a repo shares code between packages through path aliases alone, its
package boundary is *conventional*, not enforced. Whether that is acceptable is a project decision —
but state it accurately rather than describing the aliases as a boundary.

## Barrel files — CONVENTION, and the argument is usually about two different things

No official React or Next.js page endorses or forbids barrel files, and the TypeScript handbook
"does NOT provide explicit guidance on barrel files or re-export patterns". [40] So this is
convention all the way down.

**Against.** bulletproof-react: barrels "can cause issues for Vite to do tree shaking and can lead to
performance issues" — import files directly. [21]

**For.** FSD's whole enforcement model presumes a *public API per slice*, which in practice is a
barrel — the import rule is enforceable only because a slice exposes one entry point. [22] Comeau
builds his structure on a one-line `index.ts` per component that "does nothing except re-export other
stuff from its sibling files", for import ergonomics and to avoid being "flooded with index files" in
the IDE. [42]

**The resolution.** The disputants are not describing the same object. Comeau's barrel re-exports
**one** component from its own folder; bulletproof-react's objection is about barrels re-exporting
**many** modules, which pull a whole feature into the graph on a single import. Those positions are
compatible: small barrels are cheap, feature-wide barrels are the ones with a cost.

**The one hard datum nearby is SPECIFIED:** static properties do not survive the RSC boundary
(`Menu.Item` becomes `undefined`), so "expose them as named exports instead of static properties". [3]
That pushes toward named exports regardless of where you land on barrels.
