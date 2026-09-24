/* CandidateEditor — the card in edit mode: the rule and its rationale, in place. The
   evidence is NOT editable; it is what the server verified, and a rule whose wording drifts
   away from its evidence is still anchored to a real line. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, TextInput, Textarea } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { evidenceLabel } from "../CandidateCard/helpers";
import { RATIONALE_ROWS } from "./constants";
import { canSaveRule, toRationale } from "./helpers";
import { s } from "./styles";

export function CandidateEditor({
  candidate,
  busy = false,
  onSave,
  onCancel,
}: {
  candidate: ConventionCandidate;
  busy?: boolean;
  onSave: (patch: { rule: string; rationale: string | null }) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("conventions");
  const [rule, setRule] = React.useState(candidate.rule);
  const [rationale, setRationale] = React.useState(candidate.rationale ?? "");

  return (
    <div style={s.frame} data-testid="candidate-editor">
      {/* The controls are WRAPPED by their label: TextInput/Textarea take no `id`, and an
          implicit association is what makes `getByLabelText` (and a screen reader) work. */}
      <label style={s.field}>
        <span style={s.label}>{t("editor.ruleLabel")}</span>
        <TextInput value={rule} onChange={setRule} placeholder={t("editor.rulePlaceholder")} />
      </label>
      <label style={s.field}>
        <span style={s.label}>{t("editor.rationaleLabel")}</span>
        <Textarea
          value={rationale}
          onChange={setRationale}
          rows={RATIONALE_ROWS}
          placeholder={t("editor.rationalePlaceholder")}
        />
      </label>
      <p className="mono" style={s.evidence}>
        {t("card.evidenceLabel")}: {evidenceLabel(candidate.evidence_path, candidate.evidence_line)}
      </p>
      <div style={s.actions}>
        <Button
          kind="primary"
          size="sm"
          onClick={() => onSave({ rule: rule.trim(), rationale: toRationale(rationale) })}
          disabled={busy || !canSaveRule(rule)}
        >
          {busy ? t("editor.saving") : t("editor.save")}
        </Button>
        <Button kind="ghost" size="sm" onClick={onCancel}>
          {t("editor.cancel")}
        </Button>
      </div>
    </div>
  );
}
