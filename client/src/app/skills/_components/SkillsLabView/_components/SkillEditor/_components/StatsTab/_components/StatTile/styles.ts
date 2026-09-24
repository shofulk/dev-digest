import type { CSSProperties } from "react";

/** Co-located styles for StatTile. */
export const s = {
  card: { display: "flex", flexDirection: "column", gap: 6, minWidth: 0 } satisfies CSSProperties,
  label: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  main: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 } satisfies CSSProperties,
  value: { fontSize: 26, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.2 } satisfies CSSProperties,
  caption: { fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 } satisfies CSSProperties,
} as const;
