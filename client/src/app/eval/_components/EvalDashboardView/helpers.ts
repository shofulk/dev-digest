import type {
  EvalDashboardAgent,
  EvalRunAllRefusal,
  EvalRunAllResult,
} from "@devdigest/shared/contracts/eval-ci";

/** Agents, cases and model calls a run-all would start (one review call per case). */
export function runAllSummary(agents: readonly EvalDashboardAgent[]): {
  agents: number;
  cases: number;
  calls: number;
} {
  const cases = agents.reduce((sum, a) => sum + a.cases_total, 0);
  return { agents: agents.length, cases, calls: cases };
}

/** Started count and per-agent refusals of a run-all result. */
export function runAllOutcome(result: EvalRunAllResult): {
  started: number;
  refused: { agent_name: string; reason: EvalRunAllRefusal }[];
} {
  const refused: { agent_name: string; reason: EvalRunAllRefusal }[] = [];
  let started = 0;
  for (const e of result.started) {
    if (e.run_id) started += 1;
    else if (e.refused_reason) refused.push({ agent_name: e.agent_name, reason: e.refused_reason });
  }
  return { started, refused };
}
