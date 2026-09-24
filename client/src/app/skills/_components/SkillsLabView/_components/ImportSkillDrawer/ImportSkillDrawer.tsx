/* ImportSkillDrawer — file step -> preview step -> confirm (client/.spec/skills.spec.md,
   section H). Choosing a file only calls POST /skills/import/preview; the skill is written
   by the confirm alone. The body is remounted on every open, so closing resets everything. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Drawer } from "@devdigest/ui";
import type { Skill, SkillImportPreview } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { useImportPreview, useImportSkill } from "@/lib/hooks/skills";
import { FileStep } from "./_components/FileStep";
import { PreviewStep, type PreviewFields } from "./_components/PreviewStep";
import { DRAWER_WIDTH } from "./constants";
import { canConfirm, readFileAsBase64 } from "./helpers";
import { s } from "./styles";

export interface ImportSkillDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Called with the created skill after a successful confirm, just before `onClose`. */
  onImported?: (skill: Skill) => void;
}

export function ImportSkillDrawer({ open, onClose, onImported }: ImportSkillDrawerProps) {
  if (!open) return null;
  return <ImportDrawerBody onClose={onClose} onImported={onImported} />;
}

function ImportDrawerBody({ onClose, onImported }: Omit<ImportSkillDrawerProps, "open">) {
  const t = useTranslations("skills");
  const previewMutation = useImportPreview();
  const importMutation = useImportSkill();
  const [filename, setFilename] = React.useState<string | null>(null);
  const [reading, setReading] = React.useState(false);
  const [preview, setPreview] = React.useState<SkillImportPreview | null>(null);
  const [fields, setFields] = React.useState<PreviewFields | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const message = (e: unknown) => (e instanceof ApiError ? e.message : t("drawer.importFailed"));

  const chooseFile = async (file: File) => {
    setFilename(file.name);
    setError(null);
    setReading(true);
    let content_base64: string;
    try {
      content_base64 = await readFileAsBase64(file);
    } catch (e) {
      setReading(false);
      setFilename(null);
      setError(message(e));
      return;
    }
    setReading(false);
    previewMutation.mutate(
      { filename: file.name, content_base64 },
      {
        onSuccess: (data) => {
          setPreview(data);
          setFields({ name: data.name, description: data.description, type: data.type });
        },
        onError: (e) => {
          setFilename(null);
          setError(message(e));
        },
      },
    );
  };

  const backToFile = () => {
    setPreview(null);
    setFields(null);
    setFilename(null);
    setError(null);
    importMutation.reset();
  };

  const confirm = () => {
    if (!preview || !fields) return;
    importMutation.mutate(
      { name: fields.name.trim(), description: fields.description.trim(), type: fields.type, body: preview.body },
      {
        onSuccess: (skill) => {
          onImported?.(skill);
          onClose();
        },
      },
    );
  };

  const inPreview = preview !== null && fields !== null;
  const busy = reading || previewMutation.isPending;

  return (
    <Drawer
      width={DRAWER_WIDTH}
      title={t("drawer.title")}
      subtitle={t("drawer.subtitleFile")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {inPreview && (
            <Button kind="ghost" onClick={backToFile} disabled={importMutation.isPending}>
              {t("drawer.previewStep.back")}
            </Button>
          )}
          <span style={s.spacer} />
          {importMutation.isError && (
            <span role="alert" style={s.error}>
              {message(importMutation.error)}
            </span>
          )}
          <Button kind="ghost" onClick={onClose}>
            {t("drawer.cancel")}
          </Button>
          {inPreview && (
            <Button
              kind="primary"
              icon="Upload"
              onClick={confirm}
              disabled={importMutation.isPending || !canConfirm(fields.name, preview.body)}
            >
              {importMutation.isPending ? t("drawer.previewStep.confirming") : t("drawer.previewStep.confirm")}
            </Button>
          )}
        </div>
      }
    >
      {inPreview ? (
        <PreviewStep filename={filename ?? ""} preview={preview} fields={fields} onChange={setFields} />
      ) : (
        <FileStep
          busyFilename={busy ? filename : null}
          busyPhase={reading ? "reading" : "analysing"}
          error={error}
          onFile={chooseFile}
        />
      )}
    </Drawer>
  );
}
