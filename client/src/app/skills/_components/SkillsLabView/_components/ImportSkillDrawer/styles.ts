import type { CSSProperties } from "react";

/** Co-located styles for ImportSkillDrawer. */
export const s = {
  footer: { display: "flex", gap: 10, alignItems: "center" } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
  error: { color: "var(--crit)", fontSize: 13 } satisfies CSSProperties,
} as const;
