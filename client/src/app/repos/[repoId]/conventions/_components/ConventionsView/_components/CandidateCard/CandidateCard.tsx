/* CandidateCard — one extracted house-rule with its verified evidence and the accept /
   reject / edit / delete controls. The snippet shown is the repo's own bytes: the server
   drops any candidate whose evidence it could not find in the file, so nothing here is the
   model's word for it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Checkbox, Icon, IconBtn, ProgressBar } from "@devdigest/ui";
import type { ConventionCandidate, ConventionStatus } from "@devdigest/shared";
import { toPercent } from "@/components/skill-ui";
import { confidenceColor, evidenceLabel } from "./helpers";
import { s } from "./styles";

export function CandidateCard({
  candidate,
  busy = false,
  evidenceHref = null,
  selectable = false,
  selected = false,
  onSelect,
  onStatus,
  onEdit,
  onDelete,
}: {
  candidate: ConventionCandidate;
  busy?: boolean;
  /** Deep link to the evidence on GitHub; plain text when null. */
  evidenceHref?: string | null;
  /** Accepted candidates are selectable — the selection is what a skill is built from. */
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (selected: boolean) => void;
  onStatus: (status: ConventionStatus) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("conventions");
  const pct = toPercent(candidate.confidence);
  const label = evidenceLabel(candidate.evidence_path, candidate.evidence_line);

  return (
    <div style={s.card(candidate.status)} data-testid="candidate-card">
      <div style={s.main}>
        <div style={s.titleRow}>
          {selectable && (
            // The row is not itself clickable, but keep the cell from bubbling: cards live
            // in lists whose rows become clickable the moment someone adds navigation.
            <span onClick={(e) => e.stopPropagation()}>
              <Checkbox
                checked={selected}
                onChange={(v) => onSelect?.(v)}
                label={t("card.includeInSkill")}
              />
            </span>
          )}
          <Badge mono>{t(`card.category.${candidate.category}`)}</Badge>
          <div style={s.rule}>{candidate.rule}</div>
        </div>

        {candidate.rationale && <p style={s.rationale}>{candidate.rationale}</p>}

        <div style={s.evidence}>
          <div style={s.evidenceHeader}>
            {evidenceHref ? (
              // Opens the exact line on GitHub. The snippet below stays the authoritative
              // evidence — the link can drift if the file moves after the scan, it cannot.
              <a
                className="mono"
                href={evidenceHref}
                target="_blank"
                rel="noreferrer"
                title={t("card.openOnGitHub")}
                aria-label={t("card.openOnGitHub")}
                style={s.evidenceLink}
                onClick={(e) => e.stopPropagation()}
              >
                {label}
                <Icon.ExternalLink size={11} />
              </a>
            ) : (
              <span className="mono">{label}</span>
            )}
          </div>
          <pre className="mono" style={s.evidenceCode}>
            {candidate.evidence_snippet}
          </pre>
        </div>

        <div style={s.confidenceRow}>
          <span>{t("card.confidence")}</span>
          <div style={s.confidenceBar}>
            <ProgressBar value={pct} color={confidenceColor(candidate.confidence)} />
          </div>
          <span className="mono tnum">{pct}%</span>
        </div>
      </div>

      <div style={s.actions}>
        <Button
          kind={candidate.status === "accepted" ? "primary" : "secondary"}
          size="sm"
          icon="Check"
          disabled={busy}
          onClick={() => onStatus(candidate.status === "accepted" ? "pending" : "accepted")}
        >
          {candidate.status === "accepted" ? t("card.accepted") : t("card.accept")}
        </Button>
        <Button
          kind="ghost"
          size="sm"
          icon="X"
          disabled={busy}
          title={candidate.status === "rejected" ? t("card.undoReject") : undefined}
          onClick={() => onStatus(candidate.status === "rejected" ? "pending" : "rejected")}
        >
          {candidate.status === "rejected" ? t("card.rejected") : t("card.reject")}
        </Button>
        <div style={s.iconRow}>
          <IconBtn icon="Edit" label={t("card.edit")} onClick={onEdit} />
          <IconBtn icon="Trash" label={t("card.delete")} danger onClick={onDelete} />
        </div>
      </div>
    </div>
  );
}
