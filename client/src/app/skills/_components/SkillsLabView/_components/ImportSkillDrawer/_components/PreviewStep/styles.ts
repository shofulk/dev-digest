import type { CSSProperties } from "react";
import { BODY_MAX_HEIGHT } from "../../constants";

export const s = {
  meta: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 } satisfies CSSProperties,
  filename: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  notice: {
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    color: "var(--text-primary)",
    fontSize: 13,
    lineHeight: 1.5,
    marginBottom: 20,
  } satisfies CSSProperties,
  truncated: { fontSize: 13, color: "var(--warn)", margin: "0 0 8px" } satisfies CSSProperties,
  body: {
    margin: 0,
    padding: "10px 12px",
    maxHeight: BODY_MAX_HEIGHT,
    overflow: "auto",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontSize: 12.5,
    lineHeight: 1.55,
    color: "var(--text-primary)",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 7,
  } satisfies CSSProperties,
  hint: { fontSize: 12.5, color: "var(--text-muted)", margin: "6px 0 0" } satisfies CSSProperties,
} as const;
