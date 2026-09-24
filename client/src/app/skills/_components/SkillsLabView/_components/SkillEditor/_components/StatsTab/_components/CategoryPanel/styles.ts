import type { CSSProperties } from "react";

/** Co-located styles for CategoryPanel. */
export const s = {
  body: { display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" } satisfies CSSProperties,
  chart: { position: "relative", flexShrink: 0 } satisfies CSSProperties,
  center: {
    position: "absolute",
    inset: 0,
    display: "grid",
    placeItems: "center",
    pointerEvents: "none",
  } satisfies CSSProperties,
  total: { textAlign: "center", lineHeight: 1.1 } satisfies CSSProperties,
  totalValue: { fontSize: 22, fontWeight: 700, color: "var(--text-primary)" } satisfies CSSProperties,
  totalLabel: { fontSize: 11, color: "var(--text-muted)" } satisfies CSSProperties,
  legend: { listStyle: "none", margin: 0, padding: 0, flex: 1, minWidth: 140, display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  legendRow: { display: "flex", alignItems: "center", gap: 10, fontSize: 13 } satisfies CSSProperties,
  swatch: (color: string): CSSProperties => ({ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }),
  legendLabel: { flex: 1, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis" } satisfies CSSProperties,
  legendCount: { fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
} as const;
