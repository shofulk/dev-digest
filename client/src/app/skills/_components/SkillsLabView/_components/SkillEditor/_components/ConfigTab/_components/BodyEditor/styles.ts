import type { CSSProperties } from "react";
import { EDITOR_HEIGHT, LINE_HEIGHT, PAD_Y, SCROLLBAR_ALLOWANCE } from "./constants";

const mono = { fontSize: 13, lineHeight: `${LINE_HEIGHT}px` } satisfies CSSProperties;

/** Co-located styles for BodyEditor. */
export const s = {
  frame: {
    borderRadius: 8,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 12px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 12,
  } satisfies CSSProperties,
  fileName: { color: "var(--text-secondary)", fontWeight: 600 } satisfies CSSProperties,
  tokens: { marginLeft: "auto", color: "var(--text-muted)" } satisfies CSSProperties,
  editor: { display: "flex", height: EDITOR_HEIGHT } satisfies CSSProperties,
  gutter: {
    ...mono,
    flexShrink: 0,
    minWidth: 44,
    boxSizing: "border-box",
    padding: `${PAD_Y}px 10px ${PAD_Y + SCROLLBAR_ALLOWANCE}px`,
    overflow: "hidden",
    textAlign: "right",
    whiteSpace: "pre",
    userSelect: "none",
    color: "var(--text-muted)",
    background: "var(--bg-surface)",
    borderRight: "1px solid var(--border)",
  } satisfies CSSProperties,
  textarea: {
    ...mono,
    flex: 1,
    minWidth: 0,
    boxSizing: "border-box",
    padding: `${PAD_Y}px 12px`,
    border: "none",
    outline: "none",
    resize: "none",
    whiteSpace: "pre",
    overflow: "auto",
    color: "var(--text-primary)",
    background: "transparent",
  } satisfies CSSProperties,
} as const;
