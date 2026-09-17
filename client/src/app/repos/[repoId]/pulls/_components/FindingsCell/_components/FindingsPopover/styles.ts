import type { CSSProperties } from "react";
import { POPOVER_MAX_HEIGHT, POPOVER_WIDTH } from "./constants";

export const s = {
  /** position: fixed, NOT absolute — the list's table card has overflow:hidden and would
   *  clip a popover positioned inside it. */
  popover: (top: number, left: number): CSSProperties => ({
    position: "fixed",
    top,
    left,
    zIndex: 50,
    width: POPOVER_WIDTH,
    maxHeight: POPOVER_MAX_HEIGHT,
    overflowY: "auto",
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    boxShadow: "0 12px 32px rgba(0,0,0,.35)",
    padding: 12,
    cursor: "default",
  }),
  head: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 10,
  } satisfies CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  /** Each finding is its own bordered card — several stacked rationales run together
   *  otherwise, and the titles stop reading as separate findings. */
  item: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
    padding: 10,
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  } satisfies CSSProperties,
  title: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  rationale: {
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  footer: {
    marginTop: 12,
    paddingTop: 10,
    borderTop: "1px solid var(--border)",
    display: "flex",
    justifyContent: "flex-end",
  } satisfies CSSProperties,
  link: {
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--accent-text)",
    textDecoration: "none",
  } satisfies CSSProperties,
} as const;
