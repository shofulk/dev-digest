import type { CSSProperties } from "react";

export const s = {
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  } satisfies CSSProperties,
  headerActions: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,
  summary: {
    display: "flex",
    flexWrap: "wrap",
    gap: 18,
    marginBottom: 14,
  } satisfies CSSProperties,
  stat: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  statIcon: {
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  statValue: {
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  reasonText: {
    fontSize: 13,
    color: "var(--text-secondary)",
    marginBottom: 12,
  } satisfies CSSProperties,
  tree: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  } satisfies CSSProperties,
  node: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,
  nodeHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,
  nodeIcon: {
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  nodeSymbol: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  nodeCallerCount: {
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  callerRow: (indent: boolean): CSSProperties => ({
    display: "flex",
    flexWrap: "wrap",
    overflowWrap: "anywhere",
    minWidth: 0,
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    color: "var(--text-secondary)",
    marginLeft: indent ? 24 : 12,
  }),
  callerIcon: {
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  callerName: {
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  callerLocation: {
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  viaLabel: {
    fontSize: 12,
    color: "var(--text-muted)",
    fontStyle: "italic",
  } satisfies CSSProperties,
  badgeRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginLeft: 12,
    marginTop: 4,
  } satisfies CSSProperties,
  noCallers: {
    fontSize: 13,
    color: "var(--text-muted)",
    marginTop: 4,
  } satisfies CSSProperties,
  cappedHint: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginTop: 8,
  } satisfies CSSProperties,
  emptySummary: {
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
