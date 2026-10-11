import type { CSSProperties } from "react";

/** Co-located styles for CompareModal. */
export const s = {
  body: { padding: 24, display: "flex", flexDirection: "column", gap: 22 } satisfies CSSProperties,
  tiles: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 } satisfies CSSProperties,
  tile: {
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 9,
    padding: 14,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  tileLabel: { fontSize: 12, fontWeight: 600, color: "var(--text-muted)" } satisfies CSSProperties,
  tileValues: { fontSize: 16, fontWeight: 600 } satisfies CSSProperties,
  delta: (color: string): CSSProperties => ({ fontSize: 13, fontWeight: 700, color }),
  heading: { fontSize: 13, fontWeight: 700, marginBottom: 8 } satisfies CSSProperties,
  note: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  diff: {
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "8px 0",
    maxHeight: 280,
    overflow: "auto",
  } satisfies CSSProperties,
  diffLine: (op: "same" | "add" | "del"): CSSProperties => ({
    padding: "1px 12px",
    whiteSpace: "pre-wrap",
    fontSize: 12,
    color: op === "same" ? "var(--text-muted)" : op === "add" ? "var(--ok)" : "var(--crit)",
  }),
  list: { display: "flex", flexDirection: "column", gap: 4, fontSize: 13 } satisfies CSSProperties,
  skeletons: { padding: 24, display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
} as const;
