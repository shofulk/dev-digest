import { AgentEvalView } from "./_components/AgentEvalView";

/* Route: /eval/agents/:agentId (per-agent eval page). Thin route entry — the metrics, trend
   chart and runs table are colocated under _components/AgentEvalView. */
export default async function EvalAgentPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  return <AgentEvalView agentId={agentId} />;
}
