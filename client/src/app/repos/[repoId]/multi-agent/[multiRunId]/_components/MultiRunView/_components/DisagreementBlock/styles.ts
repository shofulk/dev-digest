import type { CSSProperties } from "react";

export const s = {
  root: { display: "flex", flexDirection: "column", gap: 10, marginTop: 28 } satisfies CSSProperties,
  toggleLabel: { display: "inline-flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text-secondary)", cursor: "pointer" } satisfies CSSProperties,
  notice: { fontSize: 13, color: "var(--text-muted)", padding: "10px 2px" } satisfies CSSProperties,
  group: { borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-surface)", overflow: "hidden" } satisfies CSSProperties,
  groupHead: { display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", padding: "10px 14px", borderBottom: "1px solid var(--border)" } satisfies CSSProperties,
  groupFile: { fontSize: 13, wordBreak: "break-all" } satisfies CSSProperties,
  groupTitle: { fontSize: 14, fontWeight: 600 } satisfies CSSProperties,
  cells: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" } satisfies CSSProperties,
  cell: { display: "flex", flexDirection: "column", gap: 6, padding: "10px 14px", borderRight: "1px solid var(--border)" } satisfies CSSProperties,
  cellAgent: { fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" } satisfies CSSProperties,
  cellNone: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  dot: { width: 7, height: 7, borderRadius: 99, background: "var(--text-muted)" } satisfies CSSProperties,
  cellTitle: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
