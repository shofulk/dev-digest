# Next.js App Router: structure and the client boundary

## The fixed vocabulary

**SPECIFIED.** File conventions: `layout`, `page`, `loading`, `not-found`, `error`, `global-error`,
`route`, `template`, `default`, plus `@folder` slots and `(.)`/`(..)`/`(...)` interception. Top-level
files include `next.config.js`, `instrumentation.ts`, `proxy.ts`, `.env*`. [1]

**SPECIFIED.** The nesting order is a rendering contract, not a convention: `layout.js` →
`template.js` → `error.js` (error boundary) → `loading.js` (suspense boundary) → `not-found.js` →
`page.js` or a nested `layout.js`, recursively per segment. [1]

This matters architecturally because it tells you where a boundary *can* go. An error boundary you
place yourself competes with the one the segment already gives you.

## `'use client'` — a module-graph boundary

**SPECIFIED.** "'use client' introduces a server-client boundary in the module dependency tree,
effectively creating a subtree of Client modules." [15]

**SPECIFIED.** One directive per subtree entry is enough: "Once a file is marked with `"use client"`,
**all of its imports and the components it directly renders are included in the client bundle**. This
means you don't need to add the directive to every component that is intended for the client." [2]
And: "You only need `'use client'` at the entry to a client subtree, not on every file inside it." [3]

**SPECIFIED.** Push it down: "add `'use client'` to specific interactive components instead of marking
large parts of your UI as Client Components." The canonical example keeps a `Layout` server-side while
only `<Search />` is a Client Component. [2]

**SPECIFIED.** Prefer a wrapper over annotating a shared module: "To leave a shared component
unchanged, create a Client Component wrapper that imports it and place the directive on the wrapper.
The wrapper keeps the shared module unchanged and puts the boundary closer to your application
code." [3] Same tactic for third-party client-only components: "you can wrap third-party components
that rely on client-only features in your own Client Components." Library *authors* are told the
opposite: "add the `"use client"` directive to entry points that rely on client-only features." [2]

**SPECIFIED syntax.** "`'use client'` must be at the very beginning of a file, above any imports or
other code (comments are OK)." [15]

**Applying this to existing code.** A `'use client'` at the top of a `page.tsx` is the maximal version
of the anti-pattern: it pulls the entire route subtree into the client bundle. Hold *new* code to the
leaf rule, name the existing case once so it is visible, and treat migration as a separate decision
the user owns. Recording it as known debt is the right-sized action; a sweeping rewrite is not.

## Interactivity does not always need a Client Component

**SPECIFIED, and routinely forgotten.** "Built-in browser and HTML behavior can provide interactivity
without a Client Component" — `<details>`, a `<form>` with a Server Function `action`,
`<video controls>`. "A button or form does not require a Client Component when the browser provides
all the required behavior." [3]

Check this before adding a directive. It is the cheapest way to keep a boundary from spreading.

## Providers

**SPECIFIED.** Context needs a client component that takes `children`: "React context is not supported
in Server Components. To use context, create a Client Component that accepts `children`." [2]

**SPECIFIED placement.** "**You should render providers as deep as possible in the tree** – notice how
`ThemeProvider` only wraps `{children}` instead of the entire `<html>` document. This makes it easier
for Next.js to optimize the static parts of your Server Components." [2]

A provider wrapping `<html>` in the root layout is the common default and the common mistake.

## Layouts, and what they are allowed to contain

**SPECIFIED.** "On navigation, layouts preserve state, remain interactive, and do not rerender." "The
root layout is **required** and must contain `html` and `body` tags." Multiple root layouts are
possible by removing the top-level `layout.js` and putting one inside each route group — each then
needs its own `<html>`/`<body>`. [6][1]

**SPECIFIED, and a real constraint on layout contents.** "a layout that accesses uncached or runtime
data (e.g. `cookies()`, `headers()`, or uncached fetches) does not fall back to a same route segment
`loading.js`. Instead, it blocks navigation until the layout finishes rendering." The docs' own
conclusion: "while `loading.js` works well for streaming route segments, using `<Suspense>` closer to
the runtime or uncached data access is recommended." [5]

So: dynamic data in a layout is a navigation-blocking decision. Either wrap it in its own
`<Suspense>`, or move the fetch into `page.js`.

## Server Components are the default

**SPECIFIED.** "By default, layouts and pages are Server Components". Use Client Components for state,
event handlers, lifecycle, browser-only APIs and custom hooks; use Server Components to fetch close to
the source, use secrets, and cut shipped JS. [2]

**SPECIFIED, easy to miss.** Client Components also run on the server: "Run on the server during
prerendering, but must follow the same security assumptions as code running in the browser. Must not
access privileged data or server-only modules." [4] The boundary guide's table: Server Component =
server yes / browser no; Client Component = server yes / browser yes.

"Client" therefore means "also in the browser", not "only in the browser" — which is why a Client
Component must never import a server-only module even though it does execute server-side.

## Vendor restatement

**CONVENTION / vendor.** Vercel's own course material states the same rules as imperatives: "Start with
Server Components by default; only add `'use client'` when needed"; "Extract small client wrappers…
then keep the rest as Server Components"; "Server children stream through client wrapper untouched".
Named anti-pattern: "Large Client Component boundaries force entire tree client-side, bloating
bundle". [43]

It says nothing the primary docs do not. Cite the docs first; this is useful only as confirmation that
the reading is the intended one.
