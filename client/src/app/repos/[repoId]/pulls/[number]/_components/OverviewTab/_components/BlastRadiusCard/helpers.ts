/* Pure presentation derivations for BlastRadiusCard — no hooks, no React
   (frontend-ui-architecture: "logic that needs React goes in a hook; logic
   that doesn't goes in a plain module"). */
import type { BlastRadius, DownstreamImpact } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import { REASON_KEYS } from "./constants";

export interface BlastCounts {
  symbols: number;
  callers: number;
  endpoints: number;
  crons: number;
}

/** AC2 — the summary row's four counts. Endpoints/crons are deduped across symbols. */
export function blastCounts(blast: BlastRadius): BlastCounts {
  const endpoints = new Set<string>();
  const crons = new Set<string>();
  let callers = 0;
  for (const d of blast.downstream) {
    callers += d.callers.length;
    for (const e of d.endpoints_affected) endpoints.add(e);
    for (const c of d.crons_affected) crons.add(c);
  }
  return { symbols: blast.changed_symbols.length, callers, endpoints: endpoints.size, crons: crons.size };
}

export interface SplitSymbols {
  withCallers: DownstreamImpact[];
  withoutCallers: string[];
}

/** D6 — `downstream` is keyed by name; a changed symbol absent from it has no callers. */
export function splitSymbols(blast: BlastRadius): SplitSymbols {
  const withCallers = blast.downstream.length > 0 ? blast.downstream : [];
  const covered = new Set(withCallers.map((d) => d.symbol));
  const withoutCallers = blast.changed_symbols.map((s) => s.name).filter((name) => !covered.has(name));
  return { withCallers, withoutCallers };
}

/** Any `BlastDegradedReason` value -> its `blast.json` key; unknown/null -> `reason.unknown`. */
export function degradedReasonKey(reason: string | null | undefined): string {
  if (reason && reason in REASON_KEYS) return REASON_KEYS[reason as keyof typeof REASON_KEYS];
  return "reason.unknown";
}

/** GitHub blob link pinned to the PR's head sha; `null` when `repoFullName` is missing (AC4). */
export function callerHref(repoFullName: string | null | undefined, headSha: string, file: string, line: number): string | null {
  if (!repoFullName) return null;
  return githubBlobUrl(repoFullName, headSha, file, line);
}
