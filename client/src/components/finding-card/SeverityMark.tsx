/* SeverityMark — the vendor `SeverityBadge` in its icon-only (compact) form, given the
   accessible name the vendor badge lacks: without it a screen reader meets an unnamed
   icon and severity is conveyed by colour and shape alone. */
"use client";

import { useTranslations } from "next-intl";
import { SeverityBadge, type Severity } from "@devdigest/ui";

export function SeverityMark({ severity }: { severity: Severity }) {
  const t = useTranslations("prReview");
  return (
    <span role="img" aria-label={t(`finding.severity.${severity}`)} style={{ display: "inline-flex" }}>
      <SeverityBadge severity={severity} compact />
    </span>
  );
}
