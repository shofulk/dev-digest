/* Pure presentation derivations for IntentCard — no hooks, no React (a plain
   function since it calls no hooks — frontend-ui-architecture: "logic that
   needs React goes in a hook; logic that doesn't goes in a plain module"). */
import type { IconName } from "@devdigest/ui";
import type { IntentConfidence, IntentSourceKind, IntentSourceStatus } from "@devdigest/shared";
// C3/C8 — the one RUNTIME value this card needs comes from the contract file
// directly, never the `@devdigest/shared` barrel (client INSIGHTS, 2026-09-17:
// a barrel value import compiles clean then serves a 500 on every route).
import { IntentSourceReason } from "@devdigest/shared/contracts/brief";

export function isLowConfidence(confidence: IntentConfidence): boolean {
  return confidence === "low";
}

export function confidenceTone(confidence: IntentConfidence): { color: string; bg: string } {
  if (confidence === "high") return { color: "var(--good, #3fb950)", bg: "var(--good-bg, rgba(63,185,80,.12))" };
  if (confidence === "medium") return { color: "var(--warn, #d29922)", bg: "var(--warn-bg, rgba(210,153,34,.12))" };
  return { color: "var(--text-muted)", bg: "var(--bg-hover)" };
}

const SOURCE_ICONS: Record<IntentSourceKind, IconName> = {
  pr_title: "GitPullRequest",
  pr_body: "MessageSquare",
  file_list: "FileText",
  linked_issue: "Link",
  doc_link: "FileText",
  repo_doc: "FileText",
  changed_spec: "FileText",
  ticket: "Tag",
};

export function sourceIcon(kind: IntentSourceKind): IconName {
  return SOURCE_ICONS[kind] ?? "FileText";
}

export function isMissingStatus(status: IntentSourceStatus): boolean {
  return status !== "used";
}

/** A stored `reason` value → the `prReview.json` key that translates it.
 *  Any value outside the known `IntentSourceReason` enum (older rows, or a
 *  future code this build doesn't know yet) falls back to `unknown` — the
 *  raw code is never rendered (F8). */
export function reasonKey(reason: string | null | undefined): string {
  if (reason && (IntentSourceReason.options as readonly string[]).includes(reason)) {
    return `intent.reason.${reason}`;
  }
  return "intent.reason.unknown";
}
