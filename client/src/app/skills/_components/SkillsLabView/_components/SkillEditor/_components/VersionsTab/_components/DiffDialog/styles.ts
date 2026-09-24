import type { CSSProperties } from "react";
import type { DiffKind } from "../../helpers";

/** Co-located styles for DiffDialog. */
export const s = {
  body: { padding: 0 } satisfies CSSProperties,
  summary: {
    display: "flex",
    gap: 14,
    padding: "10px 24px",
    fontSize: 12.5,
    borderBottom: "1px solid var(--border)",
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  added: { color: "var(--code-add-text)", fontWeight: 600 } satisfies CSSProperties,
  removed: { color: "var(--code-del-text)", fontWeight: 600 } satisfies CSSProperties,
  code: { background: "var(--code-bg)", fontSize: 12.5, lineHeight: 1.6, overflowX: "auto", padding: "8px 0" } satisfies CSSProperties,
  line: (kind: DiffKind): CSSProperties => ({
    display: "flex",
    minHeight: 20,
    background: kind === "add" ? "var(--code-add)" : kind === "del" ? "var(--code-del)" : undefined,
    color: kind === "add" ? "var(--code-add-text)" : kind === "del" ? "var(--code-del-text)" : "var(--text-primary)",
  }),
  no: { width: 44, flexShrink: 0, textAlign: "right", paddingRight: 8, color: "var(--text-muted)", userSelect: "none" } satisfies CSSProperties,
  symbol: { width: 22, flexShrink: 0, textAlign: "center", fontWeight: 700, userSelect: "none" } satisfies CSSProperties,
  text: { whiteSpace: "pre", paddingRight: 24 } satisfies CSSProperties,
  state: { padding: 24, display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  identical: { padding: 24, fontSize: 14, color: "var(--text-secondary)" } satisfies CSSProperties,
  footer: { display: "flex", justifyContent: "flex-end" } satisfies CSSProperties,
} as const;
