import type { CSSProperties } from "react";

/** Co-located styles for EvalsTab. */
export const s = {
  wrap: { padding: "20px 28px", display: "flex", flexDirection: "column", gap: 24, maxWidth: 1000 } satisfies CSSProperties,
  tiles: { display: "flex", gap: 12 } satisfies CSSProperties,
  sectionHead: { display: "flex", alignItems: "center", gap: 12, marginBottom: 10 } satisfies CSSProperties,
  h2: { fontSize: 16, fontWeight: 700 } satisfies CSSProperties,
  spacer: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  hint: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 } satisfies CSSProperties,
  th: {
    textAlign: "left",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
    padding: "6px 10px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  td: { padding: "8px 10px", borderBottom: "1px solid var(--border)", verticalAlign: "middle" } satisfies CSSProperties,
  muted: { color: "var(--text-muted)" } satisfies CSSProperties,
  result: (kind: string): CSSProperties => ({
    fontWeight: 600,
    color: kind === "pass" ? "var(--ok)" : kind === "fail" || kind === "errored" ? "var(--crit)" : "var(--text-muted)",
  }),
  skeletons: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
} as const;
