/** Pure helpers for the Conventions board. No hooks, no fetch. */

import type { ConventionCandidate } from "@devdigest/shared";
import { CANDIDATE_PARAM, FILTER_STATUSES, type ConventionFilter } from "./constants";

/** Candidates in the given triage state, highest confidence first. */
export function filterCandidates(
  candidates: ConventionCandidate[],
  filter: ConventionFilter,
): ConventionCandidate[] {
  const allowed = FILTER_STATUSES[filter];
  const list = allowed ? candidates.filter((c) => allowed.includes(c.status)) : candidates.slice();
  return list.sort((a, b) => b.confidence - a.confidence);
}

export interface ConventionCounts {
  pending: number;
  accepted: number;
  rejected: number;
  all: number;
}

export function countByStatus(candidates: ConventionCandidate[]): ConventionCounts {
  return {
    pending: candidates.filter((c) => c.status === "pending").length,
    accepted: candidates.filter((c) => c.status === "accepted").length,
    rejected: candidates.filter((c) => c.status === "rejected").length,
    all: candidates.length,
  };
}

/**
 * Deep link to the evidence on GitHub: `…/blob/<branch>/<path>#L<line>`.
 *
 * The branch — not a sha — because the extractor samples the working tree at whatever the
 * clone is synced to, and no scan sha is persisted. A link can therefore drift if the file
 * moves after the scan; the alternative (no link at all) is worse, and the snippet on the
 * card stays the authoritative evidence.
 *
 * Returns null when the repo or the path is unknown, so the caller renders plain text
 * rather than a dead link.
 */
export function githubEvidenceUrl(
  fullName: string | undefined,
  branch: string | undefined,
  path: string,
  line?: number | null,
): string | null {
  if (!fullName || !path) return null;
  const ref = branch || "HEAD";
  const segments = path.split("/").map(encodeURIComponent).join("/");
  const anchor = line ? `#L${line}` : "";
  return `https://github.com/${fullName}/blob/${encodeURIComponent(ref)}/${segments}${anchor}`;
}

/**
 * Next URL for the board with `?candidate=` set (or removed with `null`); every other param
 * is kept, so opening an editor never drops a filter someone linked to.
 */
export function buildCandidateUrl(
  pathname: string,
  current: string,
  candidateId: string | null,
): string {
  const sp = new URLSearchParams(current);
  if (candidateId === null) sp.delete(CANDIDATE_PARAM);
  else sp.set(CANDIDATE_PARAM, candidateId);
  const qs = sp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/**
 * Accepted ids minus the ones the user unticked. Empty `excluded` means "all of them", so
 * the common case needs no clicks; unticking is how one board yields several focused skills.
 */
export function selectedSkillIds(
  candidates: ConventionCandidate[],
  excluded: ReadonlySet<string>,
): string[] {
  return candidates
    .filter((c) => c.status === "accepted" && !excluded.has(c.id))
    .map((c) => c.id);
}
