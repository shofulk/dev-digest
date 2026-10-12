import type { CSSProperties } from "react";

export const s = {
  section: { marginTop: 48 } satisfies CSSProperties,
  title: { margin: "0 0 12px", fontSize: 15, fontWeight: 600 } satisfies CSSProperties,
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "10px 14px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-secondary)",
    color: "var(--text-primary)",
    textDecoration: "none",
    fontSize: 13.5,
  } satisfies CSSProperties,
  pr: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontWeight: 600,
  } satisfies CSSProperties,
  meta: { fontSize: 12.5, color: "var(--text-muted)", whiteSpace: "nowrap" } satisfies CSSProperties,
  skeletons: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  retry: { marginTop: 8 } satisfies CSSProperties,
} as const;

export const STATUS_LOOK = {
  running: { color: "var(--accent)", bg: "var(--bg-elevated)" },
  done: { color: "var(--ok)", bg: "var(--bg-elevated)" },
  partial: { color: "var(--warn)", bg: "var(--bg-elevated)" },
  failed: { color: "var(--code-del-text)", bg: "var(--bg-elevated)" },
} as const;
