import type { CSSProperties } from "react";

export const s = {
  body: { padding: "20px 32px 44px", display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  skeleton: { padding: "28px 32px", display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  banner: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    fontSize: 13,
    fontWeight: 500,
  } satisfies CSSProperties,
  link: { color: "var(--accent-text)", textDecoration: "underline" } satisfies CSSProperties,
  notFound: { padding: "80px 32px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" } satisfies CSSProperties,
  notFoundTitle: { fontSize: 20, fontWeight: 700, margin: 0 } satisfies CSSProperties,
  notFoundBody: { fontSize: 14, color: "var(--text-secondary)", margin: 0 } satisfies CSSProperties,
} as const;
