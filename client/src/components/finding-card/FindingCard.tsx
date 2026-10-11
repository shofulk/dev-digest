/* FindingCard — ported from findings.jsx (createElement → TSX).
   Severity icon+label, category, file:line, confidence, markdown rationale +
   suggestion, accept/dismiss actions. Accept/dismiss reflect persisted
   timestamps. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Icon,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  Button,
  Markdown,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { FindingRecord, FindingActionKind } from "@devdigest/shared";
import { SEV_COLOR, SEV_COLOR_FALLBACK } from "./constants";
import { evalCaseTypeOf, lineLabel } from "./helpers";
import { githubBlobUrl } from "../../lib/github-urls";
import { SeverityMark } from "./SeverityMark";
import { s } from "./styles";

export function FindingCard({
  f,
  focused,
  defaultExpanded,
  onAction,
  pending,
  onEvalCase,
  evalPending,
  onLearn,
  learnPending,
  repoFullName,
  headSha,
}: {
  f: FindingRecord;
  focused?: boolean;
  defaultExpanded?: boolean;
  onAction?: (action: FindingActionKind, reply?: string) => void;
  pending?: boolean;
  /** Freeze this finding into an eval case; the parent owns the mutation. */
  onEvalCase?: () => void;
  evalPending?: boolean;
  /** Save this finding as a repo learning; the parent owns the mutation. Button hidden when absent. */
  onLearn?: () => void;
  learnPending?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const t = useTranslations("prReview");
  const [expanded, setExpanded] = React.useState(defaultExpanded ?? false);
  const sevColor = SEV_COLOR[f.severity] ?? SEV_COLOR_FALLBACK;
  const fileHref =
    repoFullName && headSha
      ? githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line)
      : undefined;
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;
  const muted = accepted || dismissed;
  const evalType = evalCaseTypeOf(f);

  return (
    <div data-finding-id={f.id} style={s.card(!!focused, sevColor, muted)}>
      <div onClick={() => setExpanded((e) => !e)} style={s.header}>
        <div style={s.badgeWrap}>
          <SeverityMark severity={f.severity as Severity} />
        </div>
        <div style={s.headerMain}>
          <div style={s.titleRow}>
            <div style={s.title(muted, dismissed)}>
              <Markdown>{f.title}</Markdown>
            </div>
            <CategoryTag category={f.category as Category} />
            {f.scope === "out" && <span style={s.acceptedTag}>{t("finding.outOfScope")}</span>}
            {accepted && <span style={s.acceptedTag}>{t("finding.accepted")}</span>}
            {dismissed && <span style={s.dismissedTag}>{t("finding.dismissed")}</span>}
          </div>
          <div style={s.metaRow}>
            <MonoLink href={fileHref}>
              {f.file}:{lineLabel(f)}
            </MonoLink>
            <ConfidenceNum value={f.confidence} />
          </div>
        </div>
        {/* The keyboard / assistive-tech handle of the header: Enter and Space fire its click,
            which bubbles to the header's onClick (the mouse target) — one toggle either way. */}
        <button type="button" aria-expanded={expanded} aria-label={t("finding.toggleDetails")} style={s.toggle}>
          <Icon.ChevronDown size={16} style={s.chevron(expanded)} />
        </button>
      </div>

      {expanded && (
        <div style={s.body}>
          <div style={s.prose}>
            <Markdown>{f.rationale}</Markdown>
          </div>
          {f.suggestion && (
            <div style={s.suggestionWrap}>
              <div style={s.suggestionLabel}>{t("finding.suggestedFix")}</div>
              <div style={s.prose}>
                <Markdown>{f.suggestion}</Markdown>
              </div>
            </div>
          )}

          <div style={s.actions}>
            <Button
              kind="secondary"
              size="sm"
              icon="Check"
              disabled={pending}
              active={accepted}
              onClick={() => onAction?.("accept")}
            >
              {t("finding.accept")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              disabled={pending}
              active={dismissed}
              onClick={() => onAction?.("dismiss")}
            >
              {t("finding.dismiss")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="FlaskConical"
              disabled={evalType === null || evalPending}
              title={evalType === null ? t("finding.evalCaseNeedsTriage") : undefined}
              onClick={() => onEvalCase?.()}
            >
              {t("finding.evalCase")}
              {evalType && ` ${t(evalType === "must_find" ? "finding.evalCaseMustFind" : "finding.evalCaseMustNotFlag")}`}
            </Button>
            {onLearn && (
              <Button
                kind="ghost"
                size="sm"
                icon="Brain"
                disabled={learnPending}
                active={!!f.learned}
                onClick={() => onLearn()}
              >
                {f.learned ? t("finding.learned") : t("finding.learn")}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
