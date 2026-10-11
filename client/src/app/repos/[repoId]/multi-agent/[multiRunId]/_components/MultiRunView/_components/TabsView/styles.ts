import type { CSSProperties } from "react";

export const s = {
  root: { display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  tablist: { display: "flex", gap: 2, borderBottom: "1px solid var(--border)", overflowX: "auto" } satisfies CSSProperties,
  tab: (on: boolean, accent: string) =>
    ({
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "10px 16px",
      border: "none",
      background: "transparent",
      borderBottom: `2px solid ${on ? accent : "transparent"}`,
      marginBottom: -1,
      cursor: "pointer",
      fontSize: 14,
      fontWeight: on ? 600 : 500,
      color: on ? "var(--text-primary)" : "var(--text-secondary)",
      whiteSpace: "nowrap",
    }) satisfies CSSProperties,
  tabScore: { fontSize: 12, fontWeight: 700, color: "var(--text-muted)" } satisfies CSSProperties,
  panel: { display: "flex", flexDirection: "column", gap: 12, maxWidth: 920 } satisfies CSSProperties,
  summary: (accent: string) =>
    ({
      display: "flex",
      gap: 16,
      alignItems: "flex-start",
      padding: "16px 18px",
      borderRadius: 10,
      border: "1px solid var(--border)",
      borderLeft: `3px solid ${accent}`,
      background: "var(--bg-surface)",
    }) satisfies CSSProperties,
  summaryMain: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  summaryName: (accent: string) => ({ fontSize: 15, fontWeight: 600, color: accent }) satisfies CSSProperties,
  summaryText: { fontSize: 13.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  summaryAside: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  error: { fontSize: 13, color: "var(--crit)", wordBreak: "break-word" } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
