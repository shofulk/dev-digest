/* CreateSkillModal — name, description, type and body -> POST /skills. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, Modal, SelectInput, Textarea, TextInput } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { useCreateSkill } from "@/lib/hooks/skills";
import { BODY_ROWS, DEFAULT_TYPE, MODAL_WIDTH, TYPE_VALUES } from "./constants";
import { canCreate } from "./helpers";
import { s } from "./styles";

export function CreateSkillModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (skill: Skill) => void;
}) {
  const t = useTranslations("skills");
  const create = useCreateSkill();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>(DEFAULT_TYPE);
  const [body, setBody] = React.useState("");

  const submit = () =>
    create.mutate(
      { name: name.trim(), description: description.trim(), type, body },
      { onSuccess: (skill) => onCreated(skill) },
    );

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("create.title")}
      subtitle={t("create.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {create.isError && (
            <span role="alert" style={s.error}>
              {create.error instanceof ApiError ? create.error.message : t("create.error")}
            </span>
          )}
          <Button kind="ghost" onClick={onClose}>
            {t("create.cancel")}
          </Button>
          <Button
            kind="primary"
            icon="Plus"
            onClick={submit}
            disabled={create.isPending || !canCreate(name, body)}
          >
            {create.isPending ? t("create.submitting") : t("create.submit")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <FormField label={t("create.fields.name")} required>
          <TextInput mono value={name} onChange={setName} placeholder={t("create.fields.namePlaceholder")} />
        </FormField>
        <FormField label={t("create.fields.description")}>
          <TextInput
            value={description}
            onChange={setDescription}
            placeholder={t("create.fields.descriptionPlaceholder")}
          />
        </FormField>
        <FormField label={t("create.fields.type")}>
          <SelectInput
            mono={false}
            value={type}
            onChange={(v) => setType(v as SkillType)}
            options={TYPE_VALUES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }))}
          />
        </FormField>
        <FormField label={t("create.fields.body")} required>
          <Textarea mono rows={BODY_ROWS} value={body} onChange={setBody} placeholder={t("create.fields.bodyPlaceholder")} />
        </FormField>
      </div>
    </Modal>
  );
}
