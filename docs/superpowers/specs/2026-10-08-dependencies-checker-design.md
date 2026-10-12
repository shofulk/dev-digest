# dependencies-checker — design

Status: draft for review · Date: 2026-10-08

## Goal

A first-party skill, `.claude/skills/dependencies-checker/`, that analyses the dependencies
of all five standalone packages (`server`, `client`, `reviewer-core`, `e2e`, `mcp-server`),
draws them, sizes them, and ends with prioritised advice. The output has a fixed structure
so any developer reads it the same way.

Success: one invocation yields a report a developer can act on without re-running anything;
every number in it is reproducible from `deps.json`.

## Decisions (agreed)

- **Size** = disk size in `node_modules` plus the transitive tree that the package pulls in.
  Offline, no extra tooling. No bundle/gzip analysis.
- **Output** = Markdown report printed in chat and saved to
  `docs/dependencies/report-YYYY-MM-DD.md`, plus an HTML artifact (sortable table + Mermaid).
- **Approach B** = a deterministic collector script plus a skill that interprets its output.
  No new third-party dependencies (no madge/depcheck/npm-check).
- The skill is **read-only**: it never removes, updates or edits a lockfile; it only proposes
  `pnpm --dir <pkg> add|remove` commands.

## Layout

```
.claude/skills/dependencies-checker/
├── SKILL.md            procedure + arguments (--pkg, --top N, --no-html)
├── collect.mjs         deterministic collector -> deps.json (Node >= 22, zero deps)
├── priorities.md       P0/P1/P2 rules and thresholds
└── report-template.md  fixed report structure
```

First-party skill: edit freely, never add to `skills-lock.json`.

## Collector (`collect.mjs`)

Runs per package, independently (packages share no workspace; `reviewer-core` and `e2e`
have no lockfile of their own, so each package is treated on its own terms).

Collects:
- direct `dependencies` / `devDependencies` from `package.json`;
- per-dependency on-disk size and transitive tree from `node_modules` (`du`, `pnpm list`);
- installed vs latest version and deprecation (`pnpm outdated`); skipped with a note when
  offline;
- unused candidates: declared but not imported anywhere under `src/`;
- duplicates: the same package at different versions across packages;
- cross-package links: tsconfig `paths` aliases and `vendor/` mirrors.

If a package's `node_modules` is not installed, its size fields are `null` and the report
says "not installed, size unknown". Never estimate.

Writes `deps.json` to the scratchpad; the report is built only from it.

## Report structure (fixed)

1. **Summary** — table: package x deps x size x issue count.
2. **Diagram** — Mermaid. Top level: the five packages and their links. Per package:
   package -> top-N heaviest dependencies; node label carries size, colour carries priority.
3. **Size table** — top-N dependencies (direct and transitive) with share of `node_modules`.
4. **Findings** — unused, version duplicates, outdated/deprecated, heavy packages with a
   lighter alternative.
5. **Prioritisation** — P0/P1/P2 per `priorities.md`; each item: what, why, effort vs
   impact (MB saved, risk), and a ready command.
6. **Advice** — 3-5 "start here" points, plus what not to touch and why.

## Safety and constraints

- Read-only; installs nothing.
- Only `pnpm --dir <pkg>` forms in suggested commands (root AGENTS.md convention).
- `*/src/vendor/**` mirrors are reported as links, never as findings to edit.

## Verification

- Run on the real repo; check one known package's size against `du`.
- A package without `node_modules` must produce the "unknown" label, not a number.
- Offline run must degrade (skip outdated check) with a visible note, not fail.
- Report sections appear in the fixed order for every run.

## Out of scope

Bundle/gzip analysis, auto-fixing, CVE scanning (belongs to the `security` skill),
installing analysis tools.
