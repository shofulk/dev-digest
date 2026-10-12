/* ColumnsView — one AgentColumnCard per agent, side by side. */
"use client";

import type { AgentColumn, RunEvent } from "@devdigest/shared";
import { AgentColumnCard } from "../AgentColumnCard";

export function ColumnsView({
  columns,
  onViewTrace,
  onRetry,
  onCancel,
  pendingAgentIds,
  liveEvents,
}: {
  columns: AgentColumn[];
  onViewTrace: (column: AgentColumn) => void;
  onRetry: (column: AgentColumn) => void;
  onCancel: (column: AgentColumn) => void;
  /** The agents whose retry / cancel call is in flight. */
  pendingAgentIds: ReadonlySet<string>;
  /** Live events by run id, from the page-level stream. */
  liveEvents: ReadonlyMap<string, RunEvent[]>;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, minmax(260px, 1fr))`,
        gap: 14,
        alignItems: "stretch",
        overflowX: "auto",
      }}
    >
      {columns.map((c) => (
        <AgentColumnCard
          key={c.agent_id}
          column={c}
          events={liveEvents.get(c.run_id) ?? []}
          onViewTrace={onViewTrace}
          onRetry={onRetry}
          onCancel={onCancel}
          retryPending={pendingAgentIds.has(c.agent_id)}
          cancelPending={pendingAgentIds.has(c.agent_id)}
        />
      ))}
    </div>
  );
}
