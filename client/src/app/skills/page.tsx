import { SkillsLabView } from "./_components/SkillsLabView";

/* Route: /skills (Skills Lab). Thin route entry — the two-pane view, list, editor,
   create modal and import drawer are colocated under _components/SkillsLabView. */
export default function SkillsPage() {
  return <SkillsLabView />;
}
