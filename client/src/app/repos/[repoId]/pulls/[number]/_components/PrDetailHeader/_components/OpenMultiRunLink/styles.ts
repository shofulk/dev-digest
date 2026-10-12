import type { CSSProperties } from "react";

export const s = {
  link: {
    display: "inline-flex",
    alignItems: "center",
    height: 30,
    padding: "0 12px",
    borderRadius: 6,
    border: "1px solid var(--border-strong)",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
    textDecoration: "none",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
} as const;
