import type { CSSProperties } from "react";

export const s = {
  root: { padding: "22px 32px 14px", borderBottom: "1px solid var(--border)" } satisfies CSSProperties,
  topRow: { display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" } satisfies CSSProperties,
  heading: { fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
  switchGroup: {
    display: "inline-flex",
    padding: 2,
    gap: 2,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  switchBtn: (on: boolean) =>
    ({
      padding: "5px 14px",
      border: "none",
      borderRadius: 6,
      fontSize: 13,
      fontWeight: on ? 600 : 500,
      cursor: "pointer",
      background: on ? "var(--bg-hover)" : "transparent",
      color: on ? "var(--text-primary)" : "var(--text-secondary)",
    }) satisfies CSSProperties,
  prRow: { display: "flex", alignItems: "baseline", gap: 12, marginTop: 14, flexWrap: "wrap" } satisfies CSSProperties,
  prNumber: { fontSize: 14, color: "var(--text-muted)" } satisfies CSSProperties,
  prTitle: { fontSize: 15, fontWeight: 600, minWidth: 0 } satisfies CSSProperties,
  meta: { marginLeft: "auto", fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
} as const;
