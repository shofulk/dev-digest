import type { CSSProperties } from "react";

export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
  intro: { fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.5, margin: 0 } satisfies CSSProperties,
  hint: { fontSize: 12.5, color: "var(--text-muted)", margin: 0 } satisfies CSSProperties,
  pick: { display: "flex", alignItems: "center", gap: 12 } satisfies CSSProperties,
  hiddenInput: { display: "none" } satisfies CSSProperties,
  busy: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  errorBox: {
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--crit)",
    background: "var(--crit-bg)",
    color: "var(--crit)",
    fontSize: 13,
    lineHeight: 1.45,
  } satisfies CSSProperties,
  errorTitle: { fontWeight: 600, marginBottom: 2 } satisfies CSSProperties,
} as const;
