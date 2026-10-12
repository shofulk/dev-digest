import type { CSSProperties } from "react";

export const s = {
  card: (accent: string, checked: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "10px 14px",
    borderRadius: 9,
    border: `1px solid ${checked ? accent : "var(--border)"}`,
    background: checked
      ? `color-mix(in srgb, ${accent} 8%, var(--bg-elevated))`
      : "var(--bg-elevated)",
  }),
  checkbox: (accent: string, checked: boolean): CSSProperties => ({
    width: 16,
    height: 16,
    // centred on the 30px icon tile: (30 - 16) / 2
    marginTop: 7,
    borderRadius: 4,
    border: `1.5px solid ${checked ? accent : "var(--border-strong)"}`,
    background: checked ? accent : "transparent",
    display: "grid",
    placeItems: "center",
    padding: 0,
    flexShrink: 0,
    cursor: "pointer",
  }),
  check: { color: "#fff" } satisfies CSSProperties,
  iconBox: (accent: string): CSSProperties => ({
    width: 30,
    height: 30,
    borderRadius: 8,
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    color: accent,
    background: `color-mix(in srgb, ${accent} 16%, transparent)`,
  }),
  body: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  name: {
    fontSize: 14,
    fontWeight: 600,
    // first line centred on the 30px icon tile, like the checkbox
    lineHeight: "20px",
    paddingTop: 5,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  desc: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 1.45,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  estimate: {
    fontSize: 11,
    lineHeight: "20px",
    paddingTop: 5,
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
} as const;
