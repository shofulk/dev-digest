/** Constants for the DiffViewer. */
import type { SmartDiffRole } from "@devdigest/shared";

/** Files with this many or fewer changed lines start expanded. */
export const AUTO_EXPAND_MAX_LINES = 200;

/** Matches a unified-diff hunk header, e.g. `@@ -1,2 +1,3 @@`. */
export const HUNK_HEADER_RE = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** D3 — role colour square, over EXISTING design tokens (no new palette). */
export const ROLE_COLOR: Record<SmartDiffRole, string> = {
  core: "var(--accent)",
  tests: "var(--ok)",
  wiring: "var(--info)",
  docs: "var(--text-muted)",
  boilerplate: "var(--border-strong)",
};

/** AC2 — groups that start collapsed in Smart order. */
export const DEFAULT_COLLAPSED_ROLES: ReadonlySet<SmartDiffRole> = new Set(["docs", "boilerplate"]);
