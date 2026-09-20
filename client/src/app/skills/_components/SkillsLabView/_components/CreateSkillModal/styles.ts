import type { CSSProperties } from "react";

/** Co-located styles for CreateSkillModal. */
export const s = {
  footer: { display: "flex", gap: 10, justifyContent: "flex-end" } satisfies CSSProperties,
  body: { padding: 24 } satisfies CSSProperties,
  error: { color: "var(--crit)", fontSize: 13, marginRight: "auto", alignSelf: "center" } satisfies CSSProperties,
} as const;
