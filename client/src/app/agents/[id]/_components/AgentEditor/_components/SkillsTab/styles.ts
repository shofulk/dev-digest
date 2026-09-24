import type { CSSProperties } from "react";

/** Co-located styles for SkillsTab. */
export const s = {
  wrap: { maxWidth: 760 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 12, marginBottom: 6 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  count: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  addWrap: { marginLeft: "auto", width: 240 } satisfies CSSProperties,
  hint: { fontSize: 13, color: "var(--text-muted)", marginBottom: 14 } satisfies CSSProperties,
  filterWrap: { position: "relative", marginBottom: 12 } satisfies CSSProperties,
  filterIcon: {
    position: "absolute",
    left: 10,
    top: "50%",
    transform: "translateY(-50%)",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  filterInput: {
    width: "100%",
    padding: "8px 12px 8px 30px",
    fontSize: 13,
    borderRadius: 7,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  noMatches: { fontSize: 13, color: "var(--text-muted)", padding: "12px 4px" } satisfies CSSProperties,
  skeletons: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
} as const;
