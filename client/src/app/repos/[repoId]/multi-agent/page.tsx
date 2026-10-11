/* Configure run — /repos/:repoId/multi-agent[?pr=<prId>]. Thin: the view owns the logic. */
import { ConfigureRunView } from "./_components/ConfigureRunView";

export default function MultiAgentConfigurePage() {
  return <ConfigureRunView />;
}
