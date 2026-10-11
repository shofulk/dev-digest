/* ColumnsView — one AgentColumnCard per agent, side by side. */
"use client";

import type { AgentColumn } from "@devdigest/shared";
import { AgentColumnCard } from "../AgentColumnCard";

export function ColumnsView({
  columns,
  onViewTrace,
  onRetry,
  onCancel,
  pendingAgentId,
}: {
  columns: AgentColumn[];
  onViewTrace: (column: AgentColumn) => void;
  onRetry: (column: AgentColumn) => void;
  onCancel: (column: AgentColumn) => void;
  /** The agent whose retry / cancel call is in flight, if any. */
  pendingAgentId: string | null;
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
          onViewTrace={onViewTrace}
          onRetry={onRetry}
          onCancel={onCancel}
          retryPending={pendingAgentId === c.agent_id}
          cancelPending={pendingAgentId === c.agent_id}
        />
      ))}
    </div>
  );
}
