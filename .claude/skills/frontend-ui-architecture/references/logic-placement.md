# Where logic lives

The useful question is not "which folder" but "what kind of thing is this". Get the kind right and
the folder follows. Every lever below is about kind.

## The decision, in one table

| The logic… | belongs in | why (SPECIFIED unless noted) |
|---|---|---|
| calls no hooks, is pure | a plain module function | can be called conditionally; testable without a renderer [10] |
| needs state/effects/refs | a custom hook | "Custom Hooks let you share *stateful logic* but not *state itself*" [10] |
| is state-update logic spread over many handlers | a pure reducer, outside the component | "you can export and test it separately in isolation" [12] |
| reads a database, uses secrets, authorizes | one server-only module | secrets and DB access must not leave the server [4] |
| mutates data on user action | a thin `'use server'` function delegating to that module | "`\"use server\"` actions stay thin" [4] |
| can be computed from props/state | nowhere — compute it during render | "don't put it in state. Instead, calculate it during rendering" [11] |

## Hooks vs plain functions

**SPECIFIED.** "Custom Hooks let you share *stateful logic* but not *state itself.*" [10]

**SPECIFIED.** Drop the `use` prefix from anything that calls no hooks: "If your function doesn't
call any Hooks, avoid the `use` prefix. Instead, write it as a regular function *without* the `use`
prefix" — the docs' own example turns `useSorted` into `getSorted`, because the plain function "can
be called conditionally, which is not allowed for actual Hooks." [10]

This is both a naming rule and an architecture rule. `useSorted` needs a React test harness;
`getSorted` needs one assertion.

**SPECIFIED.** Hooks should be named and scoped by concrete use case, not by lifecycle: "**Keep your
custom Hooks focused on concrete high-level use cases**". `useChatRoom(...)` and `useOnlineStatus()`
are endorsed; a generic `useMount(fn)` wrapper is marked 🔴. [10]

**SPECIFIED, and worth quoting to anyone over-extracting.** "You don't need to extract a custom Hook
for every little duplicated bit of code. Some duplication is fine." [10]

**SPECIFIED.** When you do write an Effect, consider wrapping it in a custom hook, because "if you're
writing one, it means that you need to 'step outside React' to synchronize with some external
system." [10] The hook boundary is where "outside React" should be visible.

## Reducers

**SPECIFIED.** A reducer "lets you cleanly separate the *how* of update logic from the *what
happened* of event handlers", and "is a pure function that doesn't depend on your component. This
means that you can export and test it separately in isolation." It may live outside the component or
in its own file. [12]

**SPECIFIED constraint.** "Reducers must be pure… They should not send requests, schedule timeouts,
or perform any side effects." [12]

**SPECIFIED, conditional.** The recommendation is not blanket: "We recommend using a reducer if you
often encounter bugs due to incorrect state updates in some component… You don't have to use reducers
for everything." [12]

**SPECIFIED naming.** Actions are named after what happened, not what to set: "Each action describes
a single user interaction… Choose a name that says what happened!" [12] Redux states the same:
"treat actions more as 'describing events that occurred', rather than 'setters'". [23]

## Side effects and mutations

**SPECIFIED.** "In React, **side effects usually belong inside event handlers.**" [13]

**SPECIFIED.** Never during render: "Mutations (e.g. logging out users, updating databases,
invalidating caches) should never be a side-effect, either in Server or Client Components." [4]

**SPECIFIED.** Effects are for display-triggered work only: "Use Effects only for code that should
run *because* the component was displayed to the user." [11]

## The read path in an RSC app

**SPECIFIED.** Domain logic on the read path belongs in a server-only module, not in the component.
The docs contrast a Data Access Layer with "Component-level data access", scope the latter to "quick
prototypes and iteration", and then show it failing: "EXPOSED: This exposes all the fields in
userData to the client because we are passing the data from the Server Component to the Client." [4]

**SPECIFIED.** The DAL is the one officially named application layer in the corpus: "For new projects,
we recommend creating a dedicated **Data Access Layer (DAL)**… It should: Only run on the server.
Perform authorization checks. Return safe, minimal **Data Transfer Objects (DTOs)**." [4]

Note it is a **security** boundary, not a tidiness one. Also: "only the Data Access Layer should
access `process.env`" [4], and pick one of the three approaches (HTTP APIs / DAL / component-level)
and avoid mixing them, because mixing makes it unclear "for both developers working in your code base
and security auditors what to expect." [4]

## The write path

**SPECIFIED.** Keep actions thin: "you can apply the same pattern to mutations. This keeps
authentication, authorization, and database logic in a dedicated `server-only` module, while `"use
server"` actions stay thin." [4]

**SPECIFIED, and the strongest argument for centralizing authorization.** Every Server Function is a
public endpoint: "when a Server Action is created and exported, it is reachable via a direct POST
request, not just through your application's UI… A page-level authentication check does not extend to
the Server Actions defined within it. Always re-verify inside the action." [4] React says it at its
own level too: "Arguments to Server Functions are fully client-controlled. For security, always treat
them as untrusted input" and "make sure to validate that the logged-in user is allowed to perform
that action." [28]

Read auth from cookies/headers, not parameters: "Read authentication from cookies or headers rather
than accepting tokens as function parameters." [7]

**SPECIFIED placement.** Server Functions callable from Client Components must live in a dedicated
file: "To use Server Functions in Client Components you need to create your Server Functions in a
dedicated file using the `use server` directive at the top of the file." [7] Inline `'use server'`
works but creates a closure whose captured variables are "sent to the client and back to the server
when the action is invoked" — encrypted, but the docs add "We don't recommend relying on encryption
alone." [7]

**SPECIFIED vocabulary.** Not every Server Function is a Server Action: "If a Server Function is
passed to an action prop or called from inside an action then it is a Server Action, but not all
Server Functions are Server Actions." [29] And there is no directive for Server Components: "A common
misunderstanding is that Server Components are denoted by `"use server"`, but there is no directive
for Server Components." [30]

## The capability split, as a layering rule

**SPECIFIED.** RFC 0188 states it as a table, and it is the cleanest layering rule in the corpus. [32]

- Server Components **may** use `async/await` with databases/services and render other Server
  Components, native elements, or Client Components. They **may not** use `useState`/`useReducer`,
  effects, browser-only APIs, or "Import or call Client Components directly".
- Client Components may use all standard React features and "Receive already-rendered Server
  Components as children". They **may not** "Import Server Components or call server
  hooks/utilities".
- **Shared components** are the third category most codebases forget: code that works in both, "so
  long as the components meet all the constraints of both" — the intersection, not the union.

React states the consequence plainly: "Server Components are not sent to the browser, so they cannot
use interactive APIs like `useState`." [14]

## Testability is the driver behind all of the above

Every lever here is a testability argument that a primary source makes itself.

**SPECIFIED.** Purity is what makes logic testable without rendering: a component "does not change
any objects or variables that existed before it was called", and props/state/context are
"read-only". [13] Logic that obeys this can be extracted to a plain module and called directly.

**SPECIFIED.** The reducer is React's own named example of "move it out so you can test it", with
debuggability as a sibling benefit: "you can add a console log into your reducer to see every state
update, and *why* it happened (due to which `action`)." [12]

**SPECIFIED.** Effects are the least testable site, and the docs' advice is to move logic out of
them — compute derived values during render [11], and put event-triggered logic in a shared plain
function called from handlers rather than an Effect keyed on data changes. [11]

**SPECIFIED.** Centralizing data access is argued partly as auditability, which is the same property
that makes it testable in one place: the DAL "centralizes all data access logic, making it easier to
enforce consistent data access and reduces the risk of authorization bugs". [4] Authorization in one
server-only module can be unit-tested; the same logic scattered across components and actions can
only be tested end-to-end.

**CONVENTION.** Redux makes testability explicitly a *placement* argument: "try to put as much of the
logic for calculating a new state into the appropriate reducer, rather than in the code that prepares
and dispatches the action (like a click handler). This helps ensure that more of the actual app logic
is easily testable." [23]

**CONVENTION.** Test utilities get a top-level home rather than a per-feature one (`src/testing` in
bulletproof-react [21]), and integration/E2E tests do not colocate at all [24].

**The synthesis, marked as inference:** all four primary levers — purity, plain functions over hooks,
reducers over scattered setters, one server-only module for data access — are rules about *what kind
of thing* the logic is, and none of them is a folder rule. Prefer "extract to a pure module" over
"move to `utils/`".
