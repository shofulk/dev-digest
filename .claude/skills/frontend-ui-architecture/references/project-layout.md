# Project layout

Authority tiers: **SPECIFIED** (docs/RFC), **CONVENTION** (popular, unofficial), **UNSPECIFIED**
(no authority exists). Sources numbered as in the skill's `README.md`.

## The framework has no opinion — and says so

**SPECIFIED.** "Next.js is **unopinionated** about how you organize and colocate your project
files." The same page closes with: "The simplest takeaway is to choose a strategy that works for you
and your team and be consistent across the project." [1]

This is the single most useful fact in this file. It means a layout argument can only be won on
consistency and cost, never on correctness.

**SPECIFIED.** Folder names carry no meaning: "we're using `components` and `lib` folders as
generalized placeholders, their naming has no special framework significance and your projects might
use other folders like `ui`, `utils`, `hooks`, `styles`, etc." [1]

## The three sanctioned strategies

Verbatim from the docs [1]:

1. **Project files outside `app`** — `app/` kept "purely for routing purposes".
2. **Project files in top-level folders inside `app`**.
3. **Split by feature or route** — globally shared code at the `app` root, specific code pushed
   "into the route segments that use them".

Next.js presents all three as equal. **Anyone writing a rule here is choosing, not citing.**

## Colocation

**SPECIFIED.** Colocation inside `app/` is safe because routability is opt-in: "a route is **not
publicly accessible** until a `page.js` or `route.js` file is added to a route segment… This means
that **project files** can be **safely colocated** inside route segments in the `app` directory
without accidentally being routable." [1]

**CONVENTION.** The general principle, and the strongest argument for it: "Place code as close to
where it's relevant as possible", because separated things "get out of sync or out of date quicker"
and people notice what sits next to the code they are editing. [24]

Kent names the exceptions explicitly — cross-system docs, integration tests and E2E tests do not
colocate, because E2E tests "don't really care how the `src/` is organized at all". [24]

**Practical rule of thumb:** promote code upward on the *second real consumer*, not in anticipation
of one. Anticipatory sharing is how a `utils/` junk drawer starts.

## Private folders and route groups

**SPECIFIED.** `_folder` is optional: "Since files in the `app` directory can be safely colocated by
default, private folders are not required for colocation." They remain useful for "Separating UI
logic from routing logic", editor sorting, and "Avoiding potential naming conflicts with future
Next.js file conventions." [1]

That last one is the real argument: if you do *not* use private folders, you must know every
reserved file name to avoid a collision.

**SPECIFIED.** Route groups `(group)` organize without affecting the URL: "This indicates the folder
is for organizational purposes and should **not be included** in the route's URL path." Uses listed:
organizing by section/intent/team, nested layouts at the same level, scoping a `loading.tsx`, and
multiple root layouts. [1]

## `src/`

**SPECIFIED.** Optional and organizational: it "separates application code from project
configuration files which mostly live in the root of a project." [1]

**SPECIFIED gotcha.** "If you are using a `/src` directory, `.env.*` files should remain in the root
of your project." [8]

Note the tension: Next.js treats `src/` as cosmetic, while bulletproof-react and Feature-Sliced
Design both *assume* it as the root of their layer model. [21][22]

## Feature folders vs flat — genuinely contested

This is the sharpest unresolved disagreement in the whole corpus. Present both sides.

**CONVENTION, for feature folders.**

- bulletproof-react: `src/{app,components,config,features,hooks,lib,stores,testing,types,utils}`,
  with each feature owning its own `api/ assets/ components/ hooks/ stores/ types/ utils/`. [21]
- Redux, more strongly: "most applications should structure files using a 'feature folder' approach
  (all files for a feature in the same folder)… keeping related logic together makes it easier to
  find and update that code." [23]
- Feature-Sliced Design formalizes it: layers (`app`, `pages`, `widgets`, `features`, `entities`,
  `shared`) → slices (by business domain) → segments (`ui`, `api`, `model`, `lib`, `config`). `app`
  and `shared` have no slices. [22]

**CONVENTION, against feature folders.** Josh Comeau keeps all components in a flat `components/`
directory, one folder per component (`ComponentName.tsx`, `index.ts`, optional
`ComponentName.helpers.ts`). He rejects type-based grouping (Atomic Design's `atoms`/`molecules`,
because "developers will waste time trying to figure out which box each component fits into") **and**
feature grouping: "real life isn't nicely segmented like this, and categorization is actually
*really hard*", naming unclear feature boundaries and the cost of moving code as products
evolve. [42]

**How to handle the disagreement.** No primary tiebreaker exists — Next.js lists feature-splitting
as one of three equal options [1]. Note the sample bias: Comeau writes about a blog and a course
platform; FSD and bulletproof-react target large multi-team apps. Scale is the likely hidden
variable, and **no source in this corpus states a threshold**. So: if the project has a pattern,
follow it. If it is greenfield and small, flat is cheaper and Comeau's objection is real. If several
teams will own different parts, feature boundaries start paying for themselves.

## Where shared code goes

**UNSPECIFIED.** Next.js lists both "colocate inside route segments" and "keep `app/` purely for
routing" as equal options on the same page [1]. There is no authority to cite either way.

One thing that *is* specified and often forgotten: shared code importable by both the server and
client graphs must satisfy the **intersection** of both environments' constraints, not the union —
no state, no effects, no browser APIs, no server data access, and no importing either component
type. RFC 0188 calls these *shared components* and notes they are common: "Many components simply
transform some props based on some conditions, without using state or loading additional data." [32]

That is a much stronger constraint than "put reusable things in `shared/`", and it is the real test
for whether a module belongs in a shared layer.
