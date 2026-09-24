import type { CSSProperties } from "react";

/** Co-located styles for SkillEditor. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 12, padding: "16px 28px 12px", flexShrink: 0 } satisfies CSSProperties,
  name: { fontSize: 18, fontWeight: 700, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" } satisfies CSSProperties,
  spacer: { marginLeft: "auto" } satisfies CSSProperties,
  notice: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    margin: "0 28px 12px",
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    color: "var(--text-primary)",
    fontSize: 13,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  noticeIcon: { color: "var(--warn)", flexShrink: 0, marginTop: 2 } satisfies CSSProperties,
  body: { flex: 1, minHeight: 0, overflow: "auto" } satisfies CSSProperties,
  center: { flex: 1, padding: 28, display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
} as const;
