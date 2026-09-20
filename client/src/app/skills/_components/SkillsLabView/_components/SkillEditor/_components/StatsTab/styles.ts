import type { CSSProperties } from "react";

/** Co-located styles for StatsTab. */
export const s = {
  wrap: { padding: "8px 28px 28px", display: "flex", flexDirection: "column", gap: 20 } satisfies CSSProperties,
  tiles: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 } satisfies CSSProperties,
  panels: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 } satisfies CSSProperties,
} as const;
