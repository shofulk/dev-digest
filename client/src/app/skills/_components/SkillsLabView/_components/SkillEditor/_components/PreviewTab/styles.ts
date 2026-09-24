import type { CSSProperties } from "react";

/** Co-located styles for PreviewTab. */
export const s = {
  wrap: { padding: "20px 28px 28px", maxWidth: 860 } satisfies CSSProperties,
  heading: { fontSize: 15, fontWeight: 700, margin: 0 } satisfies CSSProperties,
  caption: { fontSize: 13, color: "var(--text-muted)", margin: "4px 0 16px" } satisfies CSSProperties,
  panel: {
    padding: "18px 22px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    fontSize: 14,
    color: "var(--text-primary)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  empty: { margin: 0, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
