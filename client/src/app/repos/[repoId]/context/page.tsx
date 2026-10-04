import { ProjectContextView } from "./_components/ProjectContextView";

/* Route: /repos/:repoId/context — the Project Context page (read-only). Thin route entry,
   as the conventions page: the list, the preview and the discovery summary are colocated
   under _components/ProjectContextView. */
export default function ProjectContextPage() {
  return <ProjectContextView />;
}
