import type { CSSProperties } from "react";

/** Co-located styles for ConfigTab. */
export const s = {
  wrap: { padding: "20px 28px 28px", maxWidth: 860 } satisfies CSSProperties,
  sectionHead: { display: "flex", alignItems: "center", gap: 10, marginBottom: 20 } satisfies CSSProperties,
  heading: { fontSize: 15, fontWeight: 700, margin: 0 } satisfies CSSProperties,
  enabled: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, fontSize: 13 } satisfies CSSProperties,
  footer: { display: "flex", alignItems: "center", gap: 12, justifyContent: "flex-end" } satisfies CSSProperties,
  error: { color: "var(--crit)", fontSize: 13, marginRight: "auto" } satisfies CSSProperties,
} as const;
