import type { CSSProperties } from "react";

export const s = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  topRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  } satisfies CSSProperties,
  verdictRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flex: 1,
    minWidth: 0,
  } satisfies CSSProperties,
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,
  title: {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--text-muted)",
    letterSpacing: "0.03em",
    textTransform: "uppercase",
  } satisfies CSSProperties,
  scoreCol: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
    marginLeft: "auto",
  } satisfies CSSProperties,
  summary: {
    fontSize: 14,
    color: "var(--text-secondary)",
    margin: 0,
  } satisfies CSSProperties,
  statusRow: {
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  missingRow: {
    fontSize: 12,
    color: "var(--text-muted)",
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    alignItems: "baseline",
  } satisfies CSSProperties,
  footer: {
    display: "flex",
    flexWrap: "wrap",
    gap: 14,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  actionsRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,
  errorRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: "var(--crit)",
  } satisfies CSSProperties,
  settingsLink: {
    color: "var(--accent-text)",
  } satisfies CSSProperties,
} as const;
