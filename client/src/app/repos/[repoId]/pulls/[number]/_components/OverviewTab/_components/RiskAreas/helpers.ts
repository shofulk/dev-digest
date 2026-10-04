/* RiskAreas/helpers.ts — pure logic, no `use` prefix (frontend-ui-architecture
   "logic placement"): parsing a grounded file ref (D7's `path` / `path:s-e`
   wire shape) into the path + start line `onOpenFile` needs, mapping a risk
   severity to its colour (SEV token precedent, VerdictBanner), and mapping a
   risk's closed `kind` vocabulary (contracts/brief.ts RiskKind) to its icon
   (AC-52: icon by kind, coloured by severity — the two are independent axes,
   so they are two functions rather than one combined lookup). */
import type { IconName } from "@devdigest/ui";
import { SEV } from "@devdigest/ui";
import type { RiskSeverity, RiskKind } from "@devdigest/shared";

/** `path:s-e` or `path` → the path plus the start line, or `null` when the
 *  ref carries no range (D7). The path itself is never line-shaped, so a
 *  trailing `:digits` or `:digits-digits` is always the range. */
export function parseFileRef(ref: string): { path: string; line: number | null } {
  const m = /^(.*):(\d+)(?:-\d+)?$/.exec(ref);
  if (!m) return { path: ref, line: null };
  return { path: m[1]!, line: Number(m[2]) };
}

const SEVERITY_SEV_KEY: Record<RiskSeverity, keyof typeof SEV> = {
  high: "CRITICAL",
  medium: "WARNING",
  low: "SUGGESTION",
};

/** Risk severity → its colour, reusing the shared severity palette (`SEV`)
 *  rather than inventing a second one. The icon shown is chosen by `kind`
 *  (`riskKindIcon`), not by severity — AC-52. */
export function severityMeta(severity: RiskSeverity): { c: string; icon: IconName } {
  const key = SEVERITY_SEV_KEY[severity];
  return { c: SEV[key].c, icon: SEV[key].icon };
}

/** Closed `RiskKind` vocabulary → its icon (AC-16, AC-52). `other` is both a
 *  real list member and the fallback for a value the client does not (yet)
 *  recognise, so the `Record` covers every member and the function still
 *  falls back defensively for forward-compat with a server that adds one. */
const KIND_ICON: Record<RiskKind, IconName> = {
  auth_surface: "Lock",
  dependency: "Boxes",
  performance: "Zap",
  data_migration: "Database",
  api_contract: "Link",
  config_secrets: "Shield",
  test_coverage: "FlaskConical",
  other: "Info",
};

export function riskKindIcon(kind: RiskKind): IconName {
  return KIND_ICON[kind] ?? KIND_ICON.other;
}

/** F16/AC-17 — the `risks.kind.<kind>` label goes through the same
 *  closed-vocabulary fallback as the icon: an unrecognised `kind` (a server
 *  ahead of this client) resolves to the `other` label key, never a raw,
 *  untranslated `risks.kind.<kind>` string. */
export function riskKindLabelKey(kind: RiskKind): RiskKind {
  return kind in KIND_ICON ? kind : "other";
}
