# Data fetching and state placement

Placement of data and state is an architecture decision, not a library preference. These are the
sourced rules.

## Where fetching belongs

**SPECIFIED.** Fetch in the component that needs the data; prop-drilling is not the sharing
mechanism. "Identical `fetch` requests in a React component tree are memoized by default, so you can
fetch data in the component that needs it instead of drilling props." [5]

For non-`fetch` sources: "For data access that does not use `fetch`, such as an ORM or database query,
wrap the function in `React.cache`. Multiple components can then call the function within the same
request while sharing one result." [5] Scope caveat from the same page: `React.cache` "is scoped to
the current request only."

**SPECIFIED.** RSC removes the separate loading layer entirely: "With RSC, a Server Component can
fetch data while rendering. A separate data-loading step does not need to pass initial props to the
component tree." [3] This is the architectural break from the `getServerSideProps` era — if a
codebase still has a "load then pass down" layer, that layer is the legacy, not the pattern.

**SPECIFIED.** Effects are the wrong place in a framework app: "modern frameworks provide more
efficient built-in data fetching mechanisms than writing Effects directly in your components." If you
do fetch in an Effect, you must handle races with an `ignore` flag in cleanup. [11]

**SPECIFIED.** Client-side fetching has two sanctioned shapes: "1. React's `use` API 2. A community
library like SWR or React Query." [5] The `use` shape is: start the request in a Server Component,
pass the *pending promise* as a prop, read it with `use()` inside `<Suspense>`. "Because the request
starts before the client runs, the Client Component does not need to fetch the same data after
mount." [3]

**SPECIFIED, colocation.** "Keep the preload function next to the component that consumes the data.
This makes the dependency easier to find if you move or remove the component." [5] This is the
clearest primary statement of query colocation in the App Router.

**SPECIFIED, a placement decision often mistaken for taste.** "Use the `searchParams` prop when you
need search parameters to **load data for the page**… Use `useSearchParams` when search parameters are
used **only on the client**." [6]

## How much state, and where

**SPECIFIED.** "Think of state as the minimal set of changing data that your app needs to remember…
Figure out the absolute minimal representation of the state your application needs and compute
everything else on-demand." The three disqualifiers: unchanged over time, passed in from a parent, or
computable from existing state/props. [9]

**CONVENTION.** Keep state as close to where it is needed as possible and lift only to the lowest
common ancestor; split contexts by domain rather than one global object. [25]

**CONVENTION.** Shape global state by data type, not by screen: "Root state slices should be defined
and named based on the major data types or areas of functionality in your application, not based on
which specific components you have in your UI… A good state structure might look like
`{auth, posts, users, ui}`. A bad structure would be something like
`{loginScreen, usersList, postsList}`." Plus: keep stored data minimal and *derive* the rest. [23]

**CONVENTION.** Most form state does not belong in a global store: "In most use cases, the data is not
truly global, is not being cached, and is not being used by multiple components at once." [23]

## Server cache is a different kind of state

**CONVENTION, but stated independently by two sources — treat it as near-settled.** Server cache and
UI state are different things and mixing them causes problems. [25] TanStack's framing: "React Query
is an async state manager"; "it assumes that the frontend application doesn't 'own' the data"; the main
knob is `staleTime` — "As long as data is fresh, it will always come from the cache only." [27]

**CONVENTION.** Do not copy server data into local state. Wrap each query in a custom hook rather than
calling it ad hoc. [27]

## TanStack Query keys

**SPECIFIED (TanStack docs).** Keys are the dependency array of the cache. They "must be serializable
using `JSON.stringify`, and **unique to the query's data**"; "If your query function depends on a
variable, include it in your query key"; "Adding dependent variables to your query key will ensure
that queries are cached independently, and that any time a variable changes, *queries will be
refetched automatically*." Object key order does not matter; array order does. [16]

**CONVENTION.** Keys and query functions belong together, per feature, behind a factory: "I keep my
Query Keys next to their respective queries, co-located in a feature directory"; "Structure your Query
Keys from *most generic* to *most specific*"; "I recommend one Query Key factory per feature". [26]
Note this advice predates RSC and assumes a single client-side consumer.

## TanStack Query in the App Router

**SPECIFIED (TanStack docs).** The QueryClient must **not** be a module-level singleton on the server.
The official `getQueryClient()` shape is environment-branched — "Server: always make a new query
client" / "Browser: make a new query client if we don't already have one" — and the reason is request
isolation: "`cache()` is scoped per request, so we don't leak data between requests". [35]

**SPECIFIED (TanStack docs).** Server Components are a prefetch site, not a render site: "From the
React Query perspective, treat Server Components as a place to prefetch data, nothing more." Rendering
query results at both levels creates ownership and sync problems on revalidation. [35]

**SPECIFIED (TanStack docs).** The per-route boilerplate is a structural cost, not a smell:
"HydrationBoundary is a Client Component, so hydration will happen there", and "In the SSR guide, we
noted that you could get rid of the boilerplate of having `<HydrationBoundary>` in every route. This
is not possible with Server Components." [35] Do not try to abstract it away.

**Still open — say so.** The official docs settle *client construction* and *prefetch placement* but
are silent on where `queryKey` factories and query hooks should live, and they discourage reusing one
query hook across both environments. That collides with the colocate-per-feature convention above,
which is pre-RSC. The underlying tension is ownership: a key factory is shared vocabulary between a
server prefetch and a client hook, so it wants a neutral module — but a neutral module importable by
both graphs is exactly what RFC 0188's shared-component constraints govern (no state, no effects, no
server data access). [32] **Recommended posture: state the factory and prefetch rules as sourced, and
mark key-factory placement as a project decision.**
