import type { CSSProperties } from "react";

/** Co-located styles for MetricBar. */
export const s = {
  wrap: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 } satisfies CSSProperties,
  track: {
    flex: 1,
    minWidth: 40,
    height: 6,
    borderRadius: 3,
    background: "var(--bg-hover)",
    overflow: "hidden",
  } satisfies CSSProperties,
  fill: (pct: number, color: string): CSSProperties => ({ width: `${pct}%`, height: "100%", background: color }),
  text: { fontSize: 12, width: 38, textAlign: "right", flexShrink: 0 } satisfies CSSProperties,
  empty: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
