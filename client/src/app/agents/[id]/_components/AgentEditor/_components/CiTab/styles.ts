import type { CSSProperties } from "react";

/** Co-located styles for the agent CI tab. */
export const s = {
  wrap: { maxWidth: 960, display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 12 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  spacer: { marginLeft: "auto", display: "flex", gap: 8 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "14px 16px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  repo: { fontWeight: 600, flex: 1 } satisfies CSSProperties,
  muted: { color: "var(--text-muted)", fontSize: 12.5 } satisfies CSSProperties,
  addRow: {
    padding: "14px 16px",
    border: "1px dashed var(--border-strong)",
    borderRadius: 8,
    textAlign: "center",
    color: "var(--text-secondary)",
    width: "100%",
    background: "transparent",
  } satisfies CSSProperties,
  notice: {
    padding: "10px 14px",
    borderRadius: 8,
    background: "var(--warn-bg)",
    color: "var(--warn)",
    fontSize: 13,
  } satisfies CSSProperties,
  failOn: { maxWidth: 360 } satisfies CSSProperties,
  link: { color: "var(--accent-text)" } satisfies CSSProperties,
} as const;
