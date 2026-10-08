"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Markdown, Skeleton, ErrorState } from "@devdigest/ui";
import { useContextDoc } from "@/lib/hooks/context";

export interface DocPreviewModalProps {
  repoId: string | null | undefined;
  path: string;
  onClose: () => void;
  /** The row's own Preview button — focus returns there when the overlay closes (AC-37). */
  returnFocusRef: React.RefObject<HTMLElement | null>;
}

/** Read-only Markdown preview of one document, opened from a picker row or the page list.
 *  Closes on Escape and hands focus back to the control that opened it. */
export function DocPreviewModal({ repoId, path, onClose, returnFocusRef }: DocPreviewModalProps) {
  const t = useTranslations("context");
  const { data, isLoading, isError, refetch } = useContextDoc(repoId, path);

  const close = React.useCallback(() => {
    onClose();
    returnFocusRef.current?.focus();
  }, [onClose, returnFocusRef]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  return (
    <Modal
      title={path}
      subtitle={!isLoading && data ? t("picker.previewTokens", { tokens: data.tokens ?? 0 }) : undefined}
      onClose={close}
    >
      <div style={{ padding: "18px 24px" }}>
        {isLoading ? (
          <Skeleton height={14} />
        ) : isError ? (
          <ErrorState body={t("picker.previewError")} onRetry={() => refetch()} />
        ) : (
          <Markdown>{data?.content ?? ""}</Markdown>
        )}
      </div>
    </Modal>
  );
}
