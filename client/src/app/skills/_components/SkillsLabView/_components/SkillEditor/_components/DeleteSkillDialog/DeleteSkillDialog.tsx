/* DeleteSkillDialog — confirmation that states the skill will be unlinked from every agent. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";
import { DELETE_DIALOG_WIDTH } from "./constants";
import { s } from "./styles";

export function DeleteSkillDialog({
  name,
  pending,
  failed,
  onConfirm,
  onCancel,
}: {
  name: string;
  pending: boolean;
  failed: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("skills");
  return (
    <Modal
      width={DELETE_DIALOG_WIDTH}
      title={t("editor.deleteDialog.title")}
      onClose={onCancel}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onCancel}>
            {t("editor.deleteDialog.cancel")}
          </Button>
          <Button kind="danger" icon="Trash" onClick={onConfirm} disabled={pending}>
            {pending ? t("editor.deleteDialog.deleting") : t("editor.deleteDialog.confirm")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <p>{t("editor.deleteDialog.body", { name })}</p>
        {failed && (
          <p role="alert" style={s.error}>
            {t("editor.deleteDialog.error")}
          </p>
        )}
      </div>
    </Modal>
  );
}
