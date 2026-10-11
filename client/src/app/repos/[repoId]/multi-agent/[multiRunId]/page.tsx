import { MultiRunView } from "./_components/MultiRunView";

/* Route: /repos/:repoId/multi-agent/:multiRunId — the multi-agent results page. Thin
   route entry: the view (Columns / Tabs, disagreement block) is colocated under
   _components/MultiRunView. The mode lives in the query (?view=columns|tabs). */
export default function MultiAgentResultsPage() {
  return <MultiRunView />;
}
