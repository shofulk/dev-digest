/* ConfigTab — name, description, type and body of a skill, saved with PUT /skills/:id.
   A body edit is reported up (onDraftBodyChange) so PreviewTab can render it, and a save
   that changed the body asks for a one-line change note first. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, FormField, SelectInput, TextInput, Toggle } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { useUpdateSkill } from "@/lib/hooks/skills";
import { BodyEditor } from "./_components/BodyEditor";
import { ChangeNoteDialog } from "./_components/ChangeNoteDialog";
import { TYPE_VALUES } from "./constants";
import { buildPatch, formFromSkill, isBodyDirty, isDirty, isValid, type SkillForm } from "./helpers";
import { s } from "./styles";

export interface ConfigTabProps {
  skill: Skill;
  /**
   * Report the edited (unsaved) body so PreviewTab can render it. Pass `null` when the
   * form is clean again (after a save, or when the edit is reverted).
   */
  onDraftBodyChange: (body: string | null) => void;
  /**
   * The unsaved body the shell is holding (SkillEditor passes it to every tab). ConfigTab
   * unmounts on a tab switch, so it seeds the body field from it to keep an edit alive.
   */
  draftBody?: string | null;
}

/** Keyed by skill id, so selecting another skill starts from that skill's own values. */
export function ConfigTab(props: ConfigTabProps) {
  return <ConfigForm key={props.skill.id} {...props} />;
}

function ConfigForm({ skill, onDraftBodyChange, draftBody }: ConfigTabProps) {
  const t = useTranslations("skills");
  const save = useUpdateSkill();
  const toggle = useUpdateSkill();
  const [form, setForm] = React.useState<SkillForm>(() => formFromSkill(skill, draftBody ?? skill.body));
  const [asking, setAsking] = React.useState(false);

  const set = <K extends keyof SkillForm>(key: K, value: SkillForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const bodyDirty = isBodyDirty(form, skill);
  const dirty = isDirty(form, skill);
  const canSave = dirty && isValid(form) && !save.isPending;

  // Tell the shell about the unsaved body; null again once it is saved or reverted.
  React.useEffect(() => {
    onDraftBodyChange(bodyDirty ? form.body : null);
  }, [bodyDirty, form.body, onDraftBodyChange]);

  const submit = (note?: string) => {
    const trimmed = note?.trim();
    setAsking(false);
    save.mutate(
      { id: skill.id, patch: { ...buildPatch(form, skill), ...(trimmed ? { note: trimmed } : {}) } },
      {
        // Re-seed from the server's copy: it is what "saved" now means, however it normalised the input.
        onSuccess: (saved) => {
          setForm(formFromSkill(saved));
          onDraftBodyChange(null);
        },
      },
    );
  };

  const onSaveClick = () => {
    if (bodyDirty) setAsking(true);
    else submit();
  };

  return (
    <div style={s.wrap}>
      <div style={s.sectionHead}>
        <h3 style={s.heading}>{t("config.heading")}</h3>
        <Badge mono>{t("preview.version", { version: skill.version })}</Badge>
        <label style={s.enabled}>
          <span>{t("config.enabledLabel")}</span>
          <Toggle on={skill.enabled} onChange={(enabled) => toggle.mutate({ id: skill.id, patch: { enabled } })} />
        </label>
      </div>

      <FormField label={t("config.fields.name")} required>
        <TextInput
          mono
          value={form.name}
          onChange={(v) => set("name", v)}
          placeholder={t("config.fields.namePlaceholder")}
          aria-label={t("config.fields.name")}
        />
      </FormField>
      <FormField label={t("config.fields.description")} hint={t("config.fields.descriptionHint")}>
        <TextInput
          value={form.description}
          onChange={(v) => set("description", v)}
          placeholder={t("config.fields.descriptionPlaceholder")}
          aria-label={t("config.fields.description")}
        />
      </FormField>
      <FormField label={t("config.fields.type")}>
        <div role="group" aria-label={t("config.fields.type")}>
          <SelectInput
            mono={false}
            value={form.type}
            onChange={(v) => set("type", v as SkillType)}
            options={TYPE_VALUES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }))}
          />
        </div>
      </FormField>
      <FormField label={t("config.fields.body")} required hint={t("preview.bodyHint")}>
        <BodyEditor
          name={form.name}
          value={form.body}
          onChange={(v) => set("body", v)}
          dirty={bodyDirty}
          saved={{ body: skill.body, tokens: skill.tokens }}
        />
      </FormField>

      <div style={s.footer}>
        {save.isError && (
          <span role="alert" style={s.error}>
            {save.error instanceof ApiError ? save.error.message : t("config.saveError")}
          </span>
        )}
        <Button kind="primary" icon="Check" onClick={onSaveClick} disabled={!canSave}>
          {save.isPending ? t("config.saving") : t("config.save")}
        </Button>
      </div>

      {asking && (
        <ChangeNoteDialog
          initialNote={t("config.note.default", { name: form.name.trim() })}
          onSave={submit}
          onSkip={() => submit()}
          onCancel={() => setAsking(false)}
        />
      )}
    </div>
  );
}
