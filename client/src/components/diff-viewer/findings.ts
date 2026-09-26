/* Inline-finding support for the DiffViewer (Smart Diff, AC3/AC4). Pure
   helpers + the render-prop contract the shared viewer needs — the actual
   `FindingCard` component is route-private and is injected by `DiffTab`
   (C2: the seam that lets a shared component host a route-private card,
   the same pattern `DiffCommentApi` already uses for comments). */
import type { ReactNode } from "react";
import type { FindingRecord } from "@devdigest/shared";
import type { Severity } from "@devdigest/ui";
import { lineKey } from "./comments";

/** What the viewer needs to read + render inline findings. `findings` is the
 *  PR's full open+closed finding set (D2: the same `allFindings` the page's
 *  severity counters use); `renderFinding` returns the route's `FindingCard`. */
export interface DiffFindingApi {
  findings: FindingRecord[];
  renderFinding: (f: FindingRecord) => ReactNode;
}

/** D4 — "open" means not dismissed. Accepted findings still count. */
export function isOpenFinding(f: FindingRecord): boolean {
  return f.dismissed_at == null;
}

/** Every finding (open or not) whose `file` matches `path`. */
export function findingsForFile(findings: FindingRecord[], path: string): FindingRecord[] {
  return findings.filter((f) => f.file === path);
}

const SEV_RANK: Record<Severity, number> = { CRITICAL: 3, WARNING: 2, SUGGESTION: 1, INFO: 0 };

/** The most severe of a non-empty list of severities. */
export function maxSeverity(severities: Severity[]): Severity {
  return severities.reduce((max, s) => (SEV_RANK[s] > SEV_RANK[max] ? s : max));
}

/**
 * Split a file's findings into those anchored to a rendered `RIGHT:${line}`
 * key (AC4) and "unanchored" ones (line not in the patch, including a null
 * patch) — patterned on `partitionThreads` in `comments.ts`.
 */
export function partitionFindings(
  findings: FindingRecord[],
  renderedKeys: Set<string>,
): { matched: Map<string, FindingRecord[]>; unanchored: FindingRecord[] } {
  const matched = new Map<string, FindingRecord[]>();
  const unanchored: FindingRecord[] = [];
  for (const f of findings) {
    const key = lineKey("RIGHT", f.start_line);
    if (key && renderedKeys.has(key)) {
      const list = matched.get(key) ?? [];
      list.push(f);
      matched.set(key, list);
    } else {
      unanchored.push(f);
    }
  }
  return { matched, unanchored };
}
