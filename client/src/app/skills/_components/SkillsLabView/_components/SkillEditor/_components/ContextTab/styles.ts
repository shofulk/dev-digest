import type { CSSProperties } from "react";

/** Co-located styles for the skill Context tab. */
export const s = {
  wrap: { padding: "20px 28px 28px", maxWidth: 860 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 12, marginBottom: 6 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700, margin: 0 } satisfies CSSProperties,
  count: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  hint: { fontSize: 13, color: "var(--text-muted)", margin: "0 0 14px" } satisfies CSSProperties,
  serializeWrap: { marginTop: 20 } satisfies CSSProperties,
  h3: { fontSize: 14, fontWeight: 700, margin: "0 0 6px" } satisfies CSSProperties,
  serializePre: {
    padding: "14px 18px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    fontSize: 13,
    color: "var(--text-primary)",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    margin: 0,
  } satisfies CSSProperties,
  tokensNote: { display: "block", marginTop: 8, fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
