import type { CSSProperties } from "react";

/** Co-located styles for the conventions CreateSkillModal. */
export const s = {
  body: { padding: "20px 24px" } satisfies CSSProperties,
  banner: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    marginBottom: 20,
  } satisfies CSSProperties,
  bannerIcon: { color: "var(--accent)", flexShrink: 0 } satisfies CSSProperties,
  row: { display: "flex", gap: 24 } satisfies CSSProperties,
  rowItem: { flex: 1 } satisfies CSSProperties,
  evidenceFiles: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  footer: { display: "flex", alignItems: "center", gap: 10, width: "100%" } satisfies CSSProperties,
  footerHint: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  footerActions: { marginLeft: "auto", display: "flex", gap: 10 } satisfies CSSProperties,
} as const;
