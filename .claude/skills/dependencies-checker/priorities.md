# Priorities — P0 / P1 / P2

Read by `dependencies-checker` step 3. Every finding gets exactly one tier. All inputs are
fields of `deps.json`; a finding that cannot name its field is not reported.

The tiers are assigned by `build-report.mjs` from `deps.json` fields alone. The "20 MB with
a named, sourced alternative" rule is never assigned by the script: it reaches the report
only through the agent's `--advice` lines. A rule change here is mirrored in
`build-report.mjs` in the same change.

Each prioritised item states four things: **what** (package, dependency, field value),
**why** (the rule below), **effort vs impact** (effort S/M/L; impact = MB saved from
`exclusiveBytes`, plus the risk) and **a ready command** from the forms at the bottom.

MB saved is `exclusiveBytes / 1048576`, one decimal. When `exclusiveBytes` is `null` the
package is not installed: write `size unknown`, never a guess.

---

## P0

Fix first: a defect, not a tidy-up.

- A declared dependency with `deprecated: true`.
- A major-version split (`duplicates[].majorSplit: true`) of a package that is imported
  through `server/src/vendor/shared`, across packages that compile that mirror. The
  evidence is a `tsconfig-path` or `vendor-mirror` link for `shared` in `links[]`, plus the
  same name in `duplicates[].uses` for both ends of the link. A split between packages that
  do not compile the mirror (for example `mcp-server`, which imports nothing from `server/`)
  is not P0; it is P1 or P2 by the rules below.

Effort is usually M to L (a major upgrade). Risk: high; say what breaks.

## P1

Worth doing this sprint.

- A `prod` dependency with `usage: unused-candidate`. Always worded "confirm before
  removing" (the scan is heuristic: dynamic imports and names referenced from strings can
  hide a real use).
- A dependency with `exclusiveBytes` of 20 MB (20971520) or more, when a lighter
  alternative can be named **with a source** (docs or registry page). No source, no finding.
- A `prod` dependency a major version behind `latest`.
- A major-version split in `duplicates[]` that is not P0.

## P2

Tidy-up, batch it.

- A `dev` dependency with `usage: unused-candidate` ("confirm before removing").
- A dependency a minor or patch version behind `latest`.
- A minor- or patch-version duplicate in `duplicates[]`.
- A dev dependency a major version behind latest (separate PR each, breaking risk).

---

## Rules

- **Mirrors are links.** `*/src/vendor/**` appears only in the diagram and the links table.
  Never a finding, never a command for a `vendor/` path. A change to shared code goes to
  `server/src/vendor/shared` through the normal flow, not through this report.
- **Skipped outdated check.** When `outdated.status` is `skipped`, no item may claim a
  version is outdated or deprecated. Quote the note instead.
- **Not installed.** Every size field is `null`; keep `not installed, size unknown`.
- **Tooling is not unused.** `usage: tooling` and `usage: types` are never findings on
  their own.
- **CVEs are out of scope.** Point to the `security` skill; do not guess advisories.
- **Read-only.** Commands are proposals for the user. The skill never runs them.

## Command forms

The package manager is the package's own: `lockfile` in `deps.json` decides.

For `pnpm-lock.yaml` packages:

```
pnpm --dir <pkg> remove <dep>
pnpm --dir <pkg> add <dep>@<ver>
```

For `package-lock.json` packages (`reviewer-core`, `e2e`), where a pnpm command would write
a stray `pnpm-lock.yaml`:

```
npm --prefix <pkg> uninstall <dep>
npm --prefix <pkg> install <dep>@<ver>
```

Never a bare `pnpm` or `npm` without `--dir` / `--prefix`. A dev dependency uses the same
forms with `-D` on `add` / `install`.
