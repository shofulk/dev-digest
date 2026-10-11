/* helpers.ts — pure logic for the multi-agent results page (view mode, disagreement
   rows, running state). No React, no I/O. */
import type { AgentColumn, Conflict, Severity } from "@devdigest/shared";
import { NO_COST } from "@/lib/format-cost";
import { estimateSeconds } from "@/lib/multi-agent-estimates";

export type MultiRunViewMode = "columns" | "tabs";

/** "tabs" only for "tabs"; anything else (including null) is "columns". */
export function parseView(v: string | null): MultiRunViewMode {
  return v === "tabs" ? "tabs" : "columns";
}

/** Every group, or only conflict groups; stable order. */
export function visibleGroups(groups: Conflict[], onlyConflicts: boolean): Conflict[] {
  return onlyConflicts ? groups.filter((g) => g.is_conflict) : [...groups];
}

/** At least two columns are `done`. */
export function canCompare(columns: AgentColumn[]): boolean {
  return columns.filter((c) => c.status === "done").length >= 2;
}

/** Any column is still `running`. */
export function hasRunning(columns: AgentColumn[]): boolean {
  return columns.some((c) => c.status === "running");
}

export type DisagreementCell = {
  agentId: string;
  agentName: string;
  flagged: boolean;
  severity: Severity | null;
  title: string | null;
};

/** One cell per take; an `ignored` take is `flagged: false` with null severity and title. */
export function disagreementCells(group: Conflict): DisagreementCell[] {
  return group.takes.map((take) =>
    take.verdict === "ignored"
      ? { agentId: take.agent_id, agentName: take.persona, flagged: false, severity: null, title: null }
      : {
          agentId: take.agent_id,
          agentName: take.persona,
          flagged: true,
          severity: take.verdict,
          title: take.note,
        },
  );
}

/** Whole seconds of a duration, or null when the duration is unknown. */
export function secondsOf(ms: number | null | undefined): number | null {
  return ms == null ? null : estimateSeconds(ms);
}

/** The "—" a missing duration shows (the same dash as a missing cost). */
export const NO_DURATION = NO_COST;

/** "file:line" of a finding. */
export function fileLine(file: string, line: number): string {
  return `${file}:${line}`;
}
