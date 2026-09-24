/* RestoreDialog — confirmation before a restore. Restoring snapshots the current body and
   makes the old one current as a NEW version; the dialog says so. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";
import { RESTORE_DIALOG_WIDTH } from "../../constants";
import { s } from "./styles";

export function RestoreDialog({
  version,
  nextVersion,
  pending,
  failed,
  onConfirm,
  onCancel,
}: {
  version: number;
  /** The version number the restore will create. */
  nextVersion: number;
  pending: boolean;
  failed: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("skills");
  return (
    <Modal
      width={RESTORE_DIALOG_WIDTH}
      title={t("versions.restoreDialog.title", { version })}
      onClose={onCancel}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onCancel}>
            {t("versions.restoreDialog.cancel")}
          </Button>
          <Button kind="primary" icon="History" onClick={onConfirm} disabled={pending}>
            {pending
              ? t("versions.restoreDialog.restoring")
              : t("versions.restoreDialog.confirm", { next: nextVersion })}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <p>{t("versions.restoreDialog.body", { version, next: nextVersion })}</p>
        {failed && (
          <p role="alert" style={s.error}>
            {t("versions.restoreDialog.error")}
          </p>
        )}
      </div>
    </Modal>
  );
}
