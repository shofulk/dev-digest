/* BodyEditor — monospace textarea with a scroll-synced line-number gutter, inside a framed
   panel whose header shows `<name>.md`, an `unsaved` badge while dirty and the exact token
   count. Deliberately not a code editor (see client/.spec/skills.spec.md, Decisions). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import { countLines, gutterText } from "./helpers";
import { s } from "./styles";
import { useBodyTokens, type SavedTokens } from "./useBodyTokens";

export function BodyEditor({
  name,
  value,
  onChange,
  dirty,
  saved,
}: {
  /** Skill name, shown as `<name>.md`. */
  name: string;
  value: string;
  onChange: (body: string) => void;
  /** True while the body differs from the saved one. */
  dirty: boolean;
  /** Saved body + its exact token count, so an unedited body needs no request. */
  saved?: SavedTokens;
}) {
  const t = useTranslations("skills");
  const tokens = useBodyTokens(value, saved);
  const gutterRef = React.useRef<HTMLDivElement>(null);
  const gutter = React.useMemo(() => gutterText(countLines(value)), [value]);

  const syncScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
  };

  return (
    <div style={s.frame}>
      <div style={s.header}>
        <span className="mono" style={s.fileName}>
          {t("config.body.fileName", { name: name.trim() || "skill" })}
        </span>
        {dirty && <Badge color="var(--warn)" bg="var(--warn-bg)">{t("config.body.unsaved")}</Badge>}
        {tokens !== null && (
          <span className="mono" style={s.tokens} data-testid="token-count">
            {t("config.body.tokens", { count: tokens })}
          </span>
        )}
      </div>
      <div style={s.editor}>
        <div ref={gutterRef} className="mono" style={s.gutter} aria-hidden="true" data-testid="line-gutter">
          {gutter}
        </div>
        <textarea
          className="mono"
          style={s.textarea}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          aria-label={t("config.body.ariaLabel")}
          spellCheck={false}
          wrap="off"
        />
      </div>
    </div>
  );
}
