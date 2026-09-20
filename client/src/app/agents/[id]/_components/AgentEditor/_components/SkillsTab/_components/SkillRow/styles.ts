import type { CSSProperties } from "react";

/** Co-located styles for SkillRow. */
export const s = {
  row: (state: { dragging: boolean; over: boolean; muted: boolean }): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 12px",
    borderRadius: 8,
    border: "1px solid " + (state.over ? "var(--accent)" : "var(--border)"),
    background: "var(--bg-surface)",
    opacity: state.dragging ? 0.4 : 1,
  }),
  handle: (enabled: boolean): CSSProperties => ({
    cursor: enabled ? "grab" : "default",
    color: enabled ? "var(--text-muted)" : "var(--border-strong)",
    userSelect: "none",
    fontSize: 14,
    lineHeight: 1,
    letterSpacing: -2,
  }),
  main: (muted: boolean): CSSProperties => ({
    flex: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: 10,
    opacity: muted ? 0.55 : 1,
  }),
  name: { fontSize: 13, color: "var(--text-primary)" } satisfies CSSProperties,
  caption: {
    fontSize: 12,
    color: "var(--warn)",
    textDecoration: "underline",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
} as const;
