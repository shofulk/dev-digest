import type { CSSProperties } from "react";

export const s = {
  header: {
    display: "flex",
    // `SectionLabel` carries its own bottom margin, so `center` would sit the
    // count badge below the title; align on the text baseline instead.
    alignItems: "baseline",
    gap: 10,
    marginBottom: 14,
  } satisfies CSSProperties,
  hint: {
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    margin: 0,
    padding: 0,
    listStyle: "none",
  } satisfies CSSProperties,
  item: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    fontSize: 13,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  marker: {
    color: "var(--accent-text)",
    flexShrink: 0,
    marginTop: 4,
  } satisfies CSSProperties,
  itemButton: {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    padding: 0,
    font: "inherit",
    minWidth: 0,
  } satisfies CSSProperties,
  path: {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12,
    color: "var(--accent-text)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  reason: {
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
} as const;
