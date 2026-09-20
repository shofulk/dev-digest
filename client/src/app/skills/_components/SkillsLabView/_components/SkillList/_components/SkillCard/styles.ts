import type { CSSProperties } from "react";

/** Co-located styles for SkillCard. */
export const s = {
  card: (selected: boolean, enabled: boolean): CSSProperties => ({
    padding: 14,
    borderRadius: 8,
    cursor: "pointer",
    border: "1px solid " + (selected ? "var(--accent)" : "var(--border)"),
    background: selected ? "var(--bg-hover)" : "var(--bg-elevated)",
    opacity: enabled ? 1 : 0.7,
    marginBottom: 10,
  }),
  headerRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  name: {
    fontSize: 13.5,
    fontWeight: 600,
    flex: 1,
    minWidth: 0,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  toggle: { display: "flex", flexShrink: 0 } satisfies CSSProperties,
  description: {
    fontSize: 13,
    color: "var(--text-secondary)",
    margin: "8px 0 10px",
    lineHeight: 1.4,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  } satisfies CSSProperties,
  badgeRow: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" } satisfies CSSProperties,
  footer: { fontSize: 12, color: "var(--text-muted)", marginTop: 10 } satisfies CSSProperties,
} as const;
