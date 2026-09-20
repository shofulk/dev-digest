# Splitting components

## The official criteria

**SPECIFIED.** Responsibility, applied the way you would decide to extract a function: "use the same
techniques for deciding if you should create a new function or object. One such technique is the
separation of concerns, that is, a component should ideally only be concerned with one thing. If it
ends up growing, it should be decomposed into smaller subcomponents." [9]

**SPECIFIED.** The data model is the recommended seam: "If your JSON is well-structured, you'll often
find that it naturally maps to the component structure of your UI… Separate your UI into components,
where each component matches one piece of your data model." [9]

Note what kind of criterion this is. It is **structural** (the shape of the data) rather than
**layered** (fetches vs renders). That distinction is the whole reason container/presentational is
not the recommended split.

**SPECIFIED.** There is no line-count rule anywhere in the primary corpus. The signal React actually
names is scattered update logic: "Components with many state updates spread across many event
handlers can get overwhelming… you can consolidate all the state update logic outside your component
in a single function, called a *reducer*." [12]

So when asked "is this component too big", the useful questions are: does it do more than one thing,
does it span more than one piece of the data model, and is its state-update logic spread across many
handlers. Not: how many lines.

## Container / presentational

**Do not present this as recommended, and do not claim it was retracted as if that were a sourced
fact.** Both halves matter.

**CONVENTION (reported, mirror-only).** The pattern's author is widely and consistently reported to
have retracted it, and a mirror of his article carries the text: "I wrote this article a long time
ago and my views have since evolved. In particular, I don't *suggest* splitting your components like
this anymore." [19] But this could not be verified against a non-mirror source: Medium returns HTTP
403, `web.archive.org` was unreachable from the research environment, the post was not re-hosted on
overreacted.io, and patterns.dev — the most likely secondary carrier — does not quote him at
all. [44] If you cite the retraction, cite it as *reported*.

**SPECIFIED, and independently sufficient.** You do not need the quote. Two primary facts carry the
whole argument:

1. React routes shared stateful logic to custom hooks: "Custom Hooks let you share *stateful
   logic*". [10]
2. No official React or Next.js page anywhere in this corpus recommends a container/presentational
   layer, and React's own split criteria (above) are structural, not layered. [9]

patterns.dev, on its own authority, agrees: "Modern React strongly favors **Hooks over container
components** for separating logic from views. Custom Hooks can replace class-based containers
entirely." [44]

**The RSC confusion to head off.** RSC reintroduces a forced server/client split that superficially
resembles container/presentational and is often described as its successor. The distinction that
matters: the RSC split is **imposed by the runtime** (module graph, serializability), not chosen as a
style. No primary source calls RSC "container/presentational"; treat that framing as community
interpretation.

## Composition across the server/client boundary

**SPECIFIED.** `children` is the official mechanism for putting server-rendered output inside a
client component: "Passing rendered output as `children` lets a Server Component nest inside a Client
Component without importing the Server Component's code into the client graph." The docs name the
roles precisely: "The **owner** is the component whose source contains the JSX for a child… The
**parent** directly contains the child in the rendered tree." [3]

The mechanism works because *rendered output is serializable data, while code is not*. This is why
composition — not configuration — is how logic and UI recombine across the boundary.

**SPECIFIED.** Serializability is asymmetric, and it constrains whether a crossing should be a prop
or a function call:

- Client Component props: JSX **is** allowed; `FormData` is not listed. [15]
- Server Function arguments/returns: `FormData` **is** allowed; React elements/JSX, non-Server
  functions, and class instances are not. [28]

## Compound components break across the boundary

**SPECIFIED.** "The pattern breaks when a static member crosses the boundary. A Server Component
that imports a Client Component receives a client reference instead of the function. As a result,
`Menu.Item` is `undefined`… To use its pieces from a Server Component, expose them as named exports
instead of static properties." [3]

This is a hard architectural constraint, not a style note: the `Menu.Item` configuration-style API
simply does not survive RSC. Prefer named exports in any codebase that has, or might get, a server
graph.
