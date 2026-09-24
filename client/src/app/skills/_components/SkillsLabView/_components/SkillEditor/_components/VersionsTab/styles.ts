import type { CSSProperties } from "react";

/** Co-located styles for VersionsTab. */
export const s = {
  wrap: { padding: "8px 28px 28px", display: "flex", flexDirection: "column", gap: 16, maxWidth: 860 } satisfies CSSProperties,
  head: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  title: { fontSize: 16, fontWeight: 700 } satisfies CSSProperties,
  intro: { fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.55, margin: 0 } satisfies CSSProperties,
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  row: (last: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 16px",
    borderBottom: last ? undefined : "1px solid var(--border)",
  }),
  note: { flex: 1, minWidth: 0, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis" } satisfies CSSProperties,
  noNote: { color: "var(--text-muted)", fontStyle: "italic" } satisfies CSSProperties,
  date: { fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" } satisfies CSSProperties,
  actions: { display: "flex", gap: 6, flexShrink: 0 } satisfies CSSProperties,
  actionsSpacer: { width: 0 } satisfies CSSProperties,
  skeletons: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
} as const;
