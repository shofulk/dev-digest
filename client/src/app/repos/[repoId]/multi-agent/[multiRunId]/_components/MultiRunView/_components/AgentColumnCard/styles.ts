import type { CSSProperties } from "react";

export const s = {
  card: (accent: string) =>
    ({
      display: "flex",
      flexDirection: "column",
      minWidth: 0,
      borderRadius: 10,
      border: "1px solid var(--border)",
      borderTop: `2px solid ${accent}`,
      background: "var(--bg-surface)",
      overflow: "hidden",
    }) satisfies CSSProperties,
  head: { display: "flex", alignItems: "center", gap: 10, padding: "14px 14px 10px" } satisfies CSSProperties,
  iconBox: (accent: string) =>
    ({
      width: 32,
      height: 32,
      borderRadius: 8,
      display: "grid",
      placeItems: "center",
      flexShrink: 0,
      color: accent,
      border: `1px solid ${accent}`,
    }) satisfies CSSProperties,
  headMain: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  name: { fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } satisfies CSSProperties,
  meta: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  body: { flex: 1, display: "flex", flexDirection: "column", gap: 8, padding: "4px 14px 12px", minHeight: 80 } satisfies CSSProperties,
  statusRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  error: { fontSize: 12.5, color: "var(--crit)", wordBreak: "break-word" } satisfies CSSProperties,
  finding: (color: string) =>
    ({
      padding: "8px 10px",
      borderRadius: 6,
      borderLeft: `3px solid ${color}`,
      background: "var(--bg-primary)",
      display: "flex",
      flexDirection: "column",
      gap: 4,
    }) satisfies CSSProperties,
  findingTitle: { display: "flex", gap: 6, alignItems: "flex-start", fontSize: 13, fontWeight: 500 } satisfies CSSProperties,
  findingFile: { fontSize: 11.5, color: "var(--text-muted)", wordBreak: "break-all" } satisfies CSSProperties,
  empty: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  foot: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 14px",
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  count: { marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
