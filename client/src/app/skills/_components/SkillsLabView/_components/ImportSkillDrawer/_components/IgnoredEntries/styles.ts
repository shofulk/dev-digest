import type { CSSProperties } from "react";

export const s = {
  wrap: { marginBottom: 20 } satisfies CSSProperties,
  title: { fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", margin: 0 } satisfies CSSProperties,
  hint: { fontSize: 12.5, color: "var(--text-muted)", margin: "2px 0 8px" } satisfies CSSProperties,
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    maxHeight: 180,
    overflow: "auto",
    border: "1px solid var(--border)",
    borderRadius: 7,
  } satisfies CSSProperties,
  row: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: "7px 12px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  path: { fontSize: 12.5, color: "var(--text-primary)", wordBreak: "break-all" } satisfies CSSProperties,
  reason: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  reasonExecutable: { fontSize: 12, color: "var(--warn)", fontWeight: 600 } satisfies CSSProperties,
} as const;
