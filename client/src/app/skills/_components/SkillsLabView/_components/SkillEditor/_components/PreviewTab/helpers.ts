/** The text the Preview tab renders: the unsaved draft when there is one, else the saved body. */
export function previewBody(saved: string, draft: string | null): string {
  return draft ?? saved;
}
