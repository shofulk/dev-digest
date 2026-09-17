import type { CSSProperties } from "react";

export const s = {
  cell: {
    display: "flex",
    alignItems: "center",
    minWidth: 0,
  } satisfies CSSProperties,
  never: {
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
