import type { CSSProperties } from "react";

export const s = {
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  } satisfies CSSProperties,
  count: {
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  hint: {
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    margin: 0,
    padding: 0,
    listStylePosition: "inside",
  } satisfies CSSProperties,
  item: {
    fontSize: 13,
  } satisfies CSSProperties,
  itemButton: {
    background: "transparent",
    border: "none",
    color: "var(--text-primary)",
    cursor: "pointer",
    textAlign: "left",
    padding: 0,
    font: "inherit",
  } satisfies CSSProperties,
  path: {
    fontFamily: "var(--font-mono, monospace)",
    color: "var(--accent-text)",
  } satisfies CSSProperties,
} as const;
