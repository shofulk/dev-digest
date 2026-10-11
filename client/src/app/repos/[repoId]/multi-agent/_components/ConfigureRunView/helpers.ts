/* Pure helpers for the Configure run screen (no React). */
import type { PrMeta } from "@devdigest/shared";

/** A pull request that has a row id (every API-keyed action needs it). */
export type PickablePr = PrMeta & { id: string };

export function pickablePulls(pulls: PrMeta[] | undefined): PickablePr[] {
  return (pulls ?? []).filter((p): p is PickablePr => !!p.id);
}

/** `?pr=<id>` preselects only a PR that is in this repo's list; anything else leaves it empty. */
export function preselectedPrId(pulls: PickablePr[], param: string | null): string | null {
  if (!param) return null;
  return pulls.some((p) => p.id === param) ? param : null;
}
