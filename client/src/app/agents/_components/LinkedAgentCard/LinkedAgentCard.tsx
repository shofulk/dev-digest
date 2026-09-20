"use client";

import React from "react";
import { useAgentSkills } from "@/lib/hooks/agent-skills";
import { AgentCard } from "../AgentCard";

type AgentCardProps = React.ComponentProps<typeof AgentCard>;

/** AgentCard plus its linked-skill count. The agents list response does not carry the
 *  count, so each card reads `GET /agents/:id/skills` — the same cached query the editor's
 *  Skills tab uses, so a link/unlink there updates the card with no extra invalidation.
 *  While loading or on error the count is omitted and the badge stays hidden. */
export function LinkedAgentCard(props: Omit<AgentCardProps, "skillCount">) {
  const { data } = useAgentSkills(props.ag.id);
  return <AgentCard {...props} skillCount={data?.length} />;
}
