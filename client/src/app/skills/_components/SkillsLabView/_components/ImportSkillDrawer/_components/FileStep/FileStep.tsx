/* File step: pick a .md/.markdown/.zip. Reading + the preview request happen in the
   parent; this step only reports the chosen file and shows progress / the server's error. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import { ACCEPT } from "../../constants";
import { s } from "./styles";

export interface FileStepProps {
  /** Name of the file being read/analysed, or null when idle. */
  busyFilename: string | null;
  /** "reading" while the bytes load, "analysing" while the preview request is in flight. */
  busyPhase: "reading" | "analysing";
  /** Inline rejection message (the server's, verbatim), or null. */
  error: string | null;
  onFile: (file: File) => void;
}

export function FileStep({ busyFilename, busyPhase, error, onFile }: FileStepProps) {
  const t = useTranslations("skills");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const busy = busyFilename !== null;

  return (
    <div style={s.wrap}>
      <p style={s.intro}>{t("drawer.fileStep.intro")}</p>
      <div style={s.pick}>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          aria-label={t("drawer.fileStep.inputLabel")}
          style={s.hiddenInput}
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            // clear the value so picking the same file again (after a rejection) still fires
            e.target.value = "";
            if (file) onFile(file);
          }}
        />
        <Button kind="primary" icon="Upload" disabled={busy} onClick={() => inputRef.current?.click()}>
          {t("drawer.fileStep.choose")}
        </Button>
        {busy && (
          <span role="status" style={s.busy}>
            {t(busyPhase === "reading" ? "drawer.fileStep.reading" : "drawer.fileStep.analysing", {
              filename: busyFilename,
            })}
          </span>
        )}
      </div>
      <p style={s.hint}>{t("drawer.fileStep.limits")}</p>
      {error && (
        <div role="alert" style={s.errorBox}>
          <div style={s.errorTitle}>{t("drawer.fileStep.rejectedTitle")}</div>
          {error}
        </div>
      )}
    </div>
  );
}
