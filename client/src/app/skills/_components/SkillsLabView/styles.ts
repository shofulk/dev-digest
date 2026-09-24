import type { CSSProperties } from "react";
import { LIST_WIDTH, TOPBAR_HEIGHT } from "./constants";

/** Co-located styles for SkillsLabView. */
export const s = {
  panes: { display: "flex", height: `calc(100vh - ${TOPBAR_HEIGHT}px)` } satisfies CSSProperties,
  left: {
    width: LIST_WIDTH,
    flexShrink: 0,
    borderRight: "1px solid var(--border)",
    background: "var(--bg-surface)",
    minHeight: 0,
  } satisfies CSSProperties,
  right: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 } satisfies CSSProperties,
  prompt: { flex: 1, display: "grid", placeItems: "center" } satisfies CSSProperties,
} as const;
