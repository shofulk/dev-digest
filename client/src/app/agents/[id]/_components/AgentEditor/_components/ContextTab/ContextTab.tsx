/* ContextTab — agent Context tab (D11/S25). Lists the current repo's documents through
   the shared ContextDocPicker, attaching/reordering saves the agent's ordered
   `context_docs` path list at once (no Save button, AC-14). The picker owns its own
   strings (the "context" namespace); this tab adds none of its own. */
"use client";

import React from "react";
import type { Agent } from "@devdigest/shared";
import { ContextDocPicker } from "@/components/context-docs";
import { useSetAgentContextDocs } from "@/lib/hooks/context";
import { useActiveRepo } from "@/lib/repo-context";
import { s } from "./styles";

export interface ContextTabProps {
  agent: Agent;
}

export function ContextTab({ agent }: ContextTabProps) {
  const { repoId } = useActiveRepo();
  const attached = agent.context_docs ?? [];
  const setDocs = useSetAgentContextDocs(agent.id);

  return (
    <div style={s.wrap}>
      <ContextDocPicker repoId={repoId} attached={attached} onChange={(next) => setDocs.mutate(next)} />
    </div>
  );
}
