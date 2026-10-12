import type { ContextDocType } from "@devdigest/shared/contracts/platform";

/** Type-badge palette per document bucket (`docTypeFor`). Colour is never the only cue —
 *  the badge always carries the label too. */
export const TYPE_COLORS: Record<ContextDocType, { color: string; bg: string }> = {
  specs: { color: "var(--accent-text)", bg: "var(--accent-bg)" },
  docs: { color: "var(--ok)", bg: "var(--ok-bg)" },
  insights: { color: "var(--text-secondary)", bg: "var(--bg-hover)" },
};

/** MIME type used to carry the dragged document path (HTML5 drag needs one to start in Firefox). */
export const DRAG_MIME = "text/plain";
