import { EvalDashboardView } from "./_components/EvalDashboardView";

/* Route: /eval (Eval Dashboard). Thin route entry — the agents table and the recent-runs
   table are colocated under _components/EvalDashboardView. */
export default function EvalPage() {
  return <EvalDashboardView />;
}
