# Onion architecture — sources

Read order for anyone extending `SKILL.md`: Palermo for the rule, Drotbohm for why our
`modules/<name>/` slices are not a contradiction of it, Sentry + Freestone for the
repository trade-off, then the enforcement tools.

## The pattern itself

- [Jeffrey Palermo — *The Onion Architecture*, part 1](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/) (2008) — the
  original. Source of the four tenets we compressed into one line: the app is built around
  an independent object model, inner layers define interfaces, outer layers implement them,
  all coupling points inward.
- [Allegro Tech — *Onion Architecture*](https://blog.allegro.tech/2023/02/onion-architecture.html) (2023) —
  a production retrospective; where the pattern pays and where it is ceremony.
- [NDepend — *Onion Architecture: Going Beyond Layers*](https://blog.ndepend.com/onion-architecture-layers/) —
  layers as a dependency graph rather than as folders; the argument behind our
  file-level (not folder-level) ring classification.
- [Oliver Drotbohm — *Sliced Onion Architecture*](http://odrotbohm.github.io/2023/07/sliced-onion-architecture/) (2023) —
  vertical slices crossed with rings. This is exactly our `modules/<name>/` layout, and the
  justification for "the ring is the file, not the folder".
- [Enterprise Craftsmanship — *Domain model isolation*](https://enterprisecraftsmanship.com/posts/domain-model-isolation/) —
  what "the domain leaks" concretely looks like.
- [*Anemic domain model*](https://en.wikipedia.org/wiki/Anemic_domain_model) — the failure
  mode where all four rings exist and none of them mean anything.

## TypeScript / Node realisations

- [Domain-Driven Hexagon](https://dev.to/sairyss/domain-driven-hexagon-18g5) — the most
  complete TS reference for ports/adapters, DTOs and mappers. Heavier (NestJS, full DDD)
  than we need; we take the port/adapter and DTO rules, not the aggregate machinery.
- [jbreckmckye/node-typescript-architecture](https://github.com/jbreckmckye/node-typescript-architecture) —
  hexagonal Node without class ceremony; closest in spirit to our functional repositories
  (`modules/reviews/repository/*.repo.ts`).
- [*Ports and Adapters, explained with two real codebases*](https://saadh393.github.io/blog/adapter-port-architecture-two-cases) —
  "the port is the contract, adapters each wrap one SDK behind it" — our
  one-SDK-one-adapter rule.

## Persistence, DTOs, validation

- [Sentry — *Atomic Repositories in Clean Architecture and TypeScript*](https://blog.sentry.io/atomic-repositories-in-clean-architecture-and-typescript/) —
  ORM types leaking past the repository boundary; the source of the `$inferSelect` rule.
- [Jay Freestone — *You might not need the repository pattern*](https://dev.to/jayfreestone/you-might-not-need-the-repository-pattern-46b) —
  the counter-argument we deliberately kept: with a query-builder-style ORM like Drizzle, a
  repository that guards no aggregate is a worse interface over the database.
- [Khalil Stemmler — *DTOs, Mappers & the Repository Pattern*](https://khalilstemmler.com/articles/typescript-domain-driven-design/repository-dto-mapper/) —
  the mapper discipline behind `helpers.ts`.
- [*Drizzle ORM best practices*](https://paulserban.eu/blog/post/drizzle-orm-best-practices-principles-patterns-and-real-world-case-studies/) —
  Drizzle as SQL-first query builder, and what that implies for layering.
- [*Runtime validation in TypeScript: where Zod ends and the type system begins*](https://dev.to/gabrielanhaia/runtime-validation-in-typescript-where-zod-ends-and-the-type-system-begins-4e9e) —
  parse at the boundary, trust inside; re-parsing in the core means the boundary is in the
  wrong place.

## Enforcement

- [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) — the tool behind
  `enforcement/dependency-cruiser.cjs`. Already a server dependency (it also backs
  `src/adapters/depgraph`), so the architecture check costs no new install. Rule syntax:
  `forbidden[].from/to` with `path`/`pathNot` regexes and `$1` back-references for the
  cross-module rule.
- [*Avoid cross-module dependencies with dependency-cruiser*](https://dev.to/jacobandrewsky/avoid-cross-module-dependencies-with-dependency-cruiser-3b0b) —
  the pattern our `no-cross-module-internals` rule is copied from.
- [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries) —
  the alternative, with editor-time feedback. Not adopted: the server has no ESLint setup,
  and adopting one for a single rule set is a bigger change than the rules are worth.
- [ArchUnitTS](https://github.com/LukasNiessen/ArchUnitTS) ·
  [ts-arch](https://github.com/ts-arch/ts-arch) — architecture rules as unit tests. Option
  for step 2 of the rollout (a hermetic `arch.test.ts` so violations fail `pnpm test`
  rather than a separate command); ArchUnitTS has first-class Vitest support, ts-arch is
  Jest-oriented.
- [*Architecture beyond layers: tsarch for AI coding agents*](https://www.angulararchitects.io/en/blog/architecture-beyond-layers-tsarch-for-ai-agents/) —
  the specific argument for machine-checkable boundaries when agents write the code: a rule
  an agent can run is worth more than a rule it must remember.
- [*Architecture fitness functions in TypeScript*](https://www.tiarebalbi.com/en/blog/fitness-function-test-that-fails-the-build) —
  on making the rule fail the build, and the warn→error promotion strategy we use.
