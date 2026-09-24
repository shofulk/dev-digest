import type { CSSProperties } from "react";

/** Co-located styles for CandidateEditor. */
export const s = {
  frame: {
    padding: 16,
    borderRadius: 10,
    overflow: "hidden",
    background: "var(--bg-surface)",
    border: "1px solid var(--accent)",
  } satisfies CSSProperties,
  field: { display: "block", marginBottom: 12 } satisfies CSSProperties,
  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginBottom: 6,
  } satisfies CSSProperties,
  evidence: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginBottom: 12,
  } satisfies CSSProperties,
  actions: { display: "flex", gap: 8 } satisfies CSSProperties,
} as const;
