import type { CSSProperties } from "react";

export const s = {
  /** Intent + Blast radius side by side; stacks to one column when narrow. */
  briefRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))",
    gap: 20,
    alignItems: "stretch",
  } satisfies CSSProperties,
  /** A grid cell may shrink below its content (min-width: 0) and stretches its card to the row height. */
  briefCell: {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
  } satisfies CSSProperties,
  descriptionBox: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    fontSize: 14,
    color: "var(--text-secondary)",
    lineHeight: 1.55,
  } satisfies CSSProperties,
} as const;
