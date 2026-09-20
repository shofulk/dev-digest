import type { CSSProperties } from "react";

/** Co-located styles for RestoreDialog. */
export const s = {
  footer: { display: "flex", gap: 10, justifyContent: "flex-end" } satisfies CSSProperties,
  body: { padding: 24, fontSize: 14, lineHeight: 1.55 } satisfies CSSProperties,
  error: { marginTop: 12, color: "var(--crit)", fontSize: 13 } satisfies CSSProperties,
} as const;
