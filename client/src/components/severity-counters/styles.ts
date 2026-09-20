import type { CSSProperties } from "react";

export const s = {
  row: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
    marginBottom: 14,
  } satisfies CSSProperties,
  /** Button chrome only — the severity's colour, icon and label come from the SEV tokens
   *  inside, so an active counter never relies on colour alone. */
  button: (active: boolean, disabled: boolean): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 9px",
    borderRadius: 5,
    fontSize: 12,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    transition: "all .12s",
    border: "1px solid " + (active ? "var(--accent)" : "transparent"),
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.45 : 1,
  }),
  /** Table-cell variant: tighter, no wrapping, no bottom margin. */
  rowCompact: {
    display: "flex",
    alignItems: "center",
    gap: 4,
  } satisfies CSSProperties,
  buttonCompact: {
    gap: 4,
    padding: "2px 5px",
    letterSpacing: 0,
  } satisfies CSSProperties,
  sep: {
    color: "var(--text-muted)",
    fontSize: 12,
  } satisfies CSSProperties,
} as const;
