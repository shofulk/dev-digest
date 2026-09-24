/* Preview step: the parsed skill — editable name/description/type, the extracted body
   (read-only: the user is meant to read it before accepting) and the ignored archive entries. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { FormField, SelectInput, TextInput } from "@devdigest/ui";
import type { SkillImportPreview, SkillType } from "@devdigest/shared";
import { SkillSourceBadge, UntrustedBadge, isUntrusted } from "@/components/skill-ui";
import { TYPE_VALUES } from "../../constants";
import { IgnoredEntries } from "../IgnoredEntries";
import { s } from "./styles";

export interface PreviewFields {
  name: string;
  description: string;
  type: SkillType;
}

export interface PreviewStepProps {
  filename: string;
  preview: SkillImportPreview;
  fields: PreviewFields;
  onChange: (next: PreviewFields) => void;
}

export function PreviewStep({ filename, preview, fields, onChange }: PreviewStepProps) {
  const t = useTranslations("skills");
  return (
    <div>
      <div style={s.meta}>
        <span className="mono" style={s.filename}>
          {t("drawer.previewStep.fromFile", { filename })}
        </span>
        <SkillSourceBadge source={preview.source} />
        {isUntrusted(preview.source) && <UntrustedBadge />}
      </div>

      <div role="note" style={s.notice}>
        {t("drawer.previewStep.notice")}
      </div>

      <FormField label={t("drawer.previewStep.name")} required>
        <TextInput
          mono
          aria-label={t("drawer.previewStep.name")}
          value={fields.name}
          onChange={(name) => onChange({ ...fields, name })}
        />
      </FormField>
      <FormField label={t("drawer.previewStep.description")}>
        <TextInput
          aria-label={t("drawer.previewStep.description")}
          value={fields.description}
          onChange={(description) => onChange({ ...fields, description })}
        />
      </FormField>
      <FormField label={t("drawer.previewStep.type")}>
        <SelectInput
          mono={false}
          value={fields.type}
          onChange={(v) => onChange({ ...fields, type: v as SkillType })}
          options={TYPE_VALUES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }))}
        />
      </FormField>

      <IgnoredEntries ignored={preview.ignored} />

      <FormField label={t("drawer.previewStep.body")}>
        {preview.truncated && (
          <p role="status" style={s.truncated}>
            {t("drawer.previewStep.truncated")}
          </p>
        )}
        <pre
          className="mono"
          tabIndex={0}
          aria-label={t("drawer.previewStep.body")}
          style={s.body}
        >
          {preview.body}
        </pre>
        <p style={s.hint}>{t("drawer.previewStep.bodyHint")}</p>
      </FormField>
    </div>
  );
}
