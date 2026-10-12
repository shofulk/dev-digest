import type { CSSProperties } from "react";

/** Co-located styles for MetricTile. */
export const s = {
  tile: {
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "14px 16px",
    minWidth: 0,
  } satisfies CSSProperties,
  label: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.04em",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  body: { display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 } satisfies CSSProperties,
  value: (color: string): CSSProperties => ({ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color }),
  delta: (color: string): CSSProperties => ({ fontSize: 12, fontWeight: 600, color }),
  spark: { marginLeft: "auto", alignSelf: "center" } satisfies CSSProperties,
} as const;
