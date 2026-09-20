import type { CSSProperties } from "react";

/** Co-located styles for ChangeNoteDialog. */
export const s = {
  footer: { display: "flex", gap: 10, justifyContent: "flex-end" } satisfies CSSProperties,
  body: { padding: "20px 24px 4px" } satisfies CSSProperties,
} as const;
