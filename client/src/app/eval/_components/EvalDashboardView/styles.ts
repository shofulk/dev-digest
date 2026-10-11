import type { CSSProperties } from "react";

/** Co-located styles for EvalDashboardView. */
export const s = {
  wrap: { padding: "24px 28px", display: "flex", flexDirection: "column", gap: 28, maxWidth: 1100 } satisfies CSSProperties,
  h1: { fontSize: 22, fontWeight: 700 } satisfies CSSProperties,
  subtitle: { fontSize: 14, color: "var(--text-secondary)", marginTop: 4 } satisfies CSSProperties,
  h2: { fontSize: 16, fontWeight: 700, marginBottom: 10 } satisfies CSSProperties,
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 } satisfies CSSProperties,
  th: {
    textAlign: "left",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
    padding: "6px 10px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  td: { padding: "10px", borderBottom: "1px solid var(--border)", verticalAlign: "middle" } satisfies CSSProperties,
  link: { color: "var(--accent)", fontWeight: 600, textDecoration: "none" } satisfies CSSProperties,
  model: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  skeletons: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
} as const;
