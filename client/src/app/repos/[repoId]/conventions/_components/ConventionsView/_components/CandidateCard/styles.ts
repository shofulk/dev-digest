import type { CSSProperties } from "react";
import { ACTIONS_WIDTH, CONFIDENCE_BAR_WIDTH } from "./constants";

/** Co-located styles for CandidateCard. */
export const s = {
  /** `overflow: hidden` clips the rounded corners and the snippet's own scroller. */
  card: (status: string): CSSProperties => ({
    display: "flex",
    gap: 16,
    padding: 16,
    borderRadius: 10,
    overflow: "hidden",
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    // the accent stripe reads the triage state at a glance
    borderLeft: `3px solid ${
      status === "accepted"
        ? "var(--ok)"
        : status === "rejected"
          ? "var(--border-strong)"
          : "var(--accent)"
    }`,
    opacity: status === "rejected" ? 0.55 : 1,
  }),
  main: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  rule: { fontSize: 15, fontWeight: 600, fontStyle: "italic" } satisfies CSSProperties,
  rationale: {
    fontSize: 13,
    color: "var(--text-secondary)",
    margin: "0 0 12px",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  evidence: {
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,
  evidenceHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    borderBottom: "1px solid var(--border)",
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  evidenceLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    color: "var(--accent)",
    textDecoration: "none",
  } satisfies CSSProperties,
  evidenceCode: {
    margin: 0,
    padding: "12px 14px",
    fontSize: 12.5,
    lineHeight: 1.6,
    overflowX: "auto",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  confidenceRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginTop: 12,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  confidenceBar: { width: CONFIDENCE_BAR_WIDTH } satisfies CSSProperties,
  actions: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    width: ACTIONS_WIDTH,
    flexShrink: 0,
  } satisfies CSSProperties,
  iconRow: { display: "flex", gap: 6, justifyContent: "flex-end" } satisfies CSSProperties,
} as const;
