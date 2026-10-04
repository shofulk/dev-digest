import type { CSSProperties } from "react";

export const s = {
  section: {
    marginTop: 16,
    paddingTop: 16,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  } satisfies CSSProperties,
  errorRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  hint: {
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  row: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,
  rowHeader: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
  } satisfies CSSProperties,
  title: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
    flex: 1,
  } satisfies CSSProperties,
  /* Visually hidden: the kind label (AC-52) is read by assistive tech next to
     the severity-labelled icon, without showing twice on screen. Standard
     clip technique — kept local since no shared sr-only primitive exists
     yet (`@devdigest/ui`). */
  kindLabel: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    border: 0,
  } satisfies CSSProperties,
  explanation: {
    fontSize: 13,
    color: "var(--text-secondary)",
    marginLeft: 22,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  refs: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginLeft: 22,
  } satisfies CSSProperties,
  refButton: {
    fontSize: 12,
    fontFamily: "var(--font-mono, monospace)",
    color: "var(--accent-text)",
    background: "var(--accent-bg)",
    border: "none",
    borderRadius: 4,
    padding: "2px 8px",
    cursor: "pointer",
  } satisfies CSSProperties,
  toggleButton: {
    background: "transparent",
    border: "none",
    color: "var(--text-muted)",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    padding: 0,
  } satisfies CSSProperties,
} as const;
