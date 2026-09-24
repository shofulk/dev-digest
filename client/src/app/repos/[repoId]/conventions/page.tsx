import { ConventionsView } from "./_components/ConventionsView";

/* Route: /repos/:repoId/conventions — the Conventions Extractor. Thin route entry: the
   scan, the triage board, the inline editor and the create-skill modal are colocated
   under _components/ConventionsView. */
export default function ConventionsPage() {
  return <ConventionsView />;
}
