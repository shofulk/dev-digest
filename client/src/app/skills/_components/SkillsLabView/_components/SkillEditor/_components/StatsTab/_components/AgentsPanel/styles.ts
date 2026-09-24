import type { CSSProperties } from "react";

/** Co-located styles for AgentsPanel. */
export const s = {
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" } satisfies CSSProperties,
  row: (last: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 0",
    borderBottom: last ? undefined : "1px solid var(--border)",
  }),
  name: { flex: 1, minWidth: 0, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis" } satisfies CSSProperties,
  open: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--accent-text)",
    textDecoration: "none",
  } satisfies CSSProperties,
} as const;
