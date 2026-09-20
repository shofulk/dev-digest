/* ChangeNoteDialog — one-line change note asked before a body save; prefilled and skippable. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, Modal, TextInput } from "@devdigest/ui";
import { NOTE_DIALOG_WIDTH } from "../../constants";
import { s } from "./styles";

export function ChangeNoteDialog({
  initialNote,
  onSave,
  onSkip,
  onCancel,
}: {
  initialNote: string;
  /** Save the version with this note. */
  onSave: (note: string) => void;
  /** Save the version with no note. */
  onSkip: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("skills");
  const [note, setNote] = React.useState(initialNote);
  return (
    <Modal
      width={NOTE_DIALOG_WIDTH}
      title={t("config.note.title")}
      subtitle={t("config.note.body")}
      onClose={onCancel}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onSkip}>
            {t("config.note.skip")}
          </Button>
          <Button kind="primary" onClick={() => onSave(note)}>
            {t("config.note.confirm")}
          </Button>
        </div>
      }
    >
      <form
        style={s.body}
        onSubmit={(e) => {
          e.preventDefault();
          onSave(note);
        }}
      >
        <FormField label={t("config.note.label")}>
          <TextInput value={note} onChange={setNote} aria-label={t("config.note.label")} autoFocus />
        </FormField>
      </form>
    </Modal>
  );
}
