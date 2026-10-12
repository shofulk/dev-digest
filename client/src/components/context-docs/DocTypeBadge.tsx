"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { ContextDocType } from "@devdigest/shared/contracts/platform";
import { TYPE_COLORS } from "./constants";

/** Small coloured badge naming a document's search-root bucket (specs / docs / insights). */
export function DocTypeBadge({ type }: { type: ContextDocType | null }) {
  const t = useTranslations("context");
  const kind = type ?? "docs";
  const tone = TYPE_COLORS[kind];
  return (
    <Badge color={tone.color} bg={tone.bg}>
      {t(`picker.types.${kind}`)}
    </Badge>
  );
}
