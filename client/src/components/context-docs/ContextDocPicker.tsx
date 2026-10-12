"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, IconBtn, Checkbox, Skeleton, ErrorState } from "@devdigest/ui";
import { ApiError } from "@/lib/api";
import { useContextDocs } from "@/lib/hooks/context";
import {
  buildAttachRows,
  attachedTokens,
  filterRows,
  toggleDoc,
  moveDoc,
  reorderAttached,
  type AttachRow,
} from "./helpers";
import { DocTypeBadge } from "./DocTypeBadge";
import { DocPreviewModal } from "./DocPreviewModal";
import { DRAG_MIME } from "./constants";
import { s } from "./styles";

export interface ContextDocPickerProps {
  repoId: string | null | undefined;
  /** The agent's or skill's saved, ordered `context_docs` path list. */
  attached: string[];
  /** Called with the next ordered list on every check, uncheck, detach or reorder — the
   *  caller autosaves it at once (D11), there is no separate Save button here. */
  onChange: (next: string[]) => void;
}

/**
 * Shared document-attach picker used by both the agent and the skill Context tabs
 * (client/.spec/project-context.spec.md, D11/S22). Reads the repo's documents through
 * `useContextDocs`; attachment state and order come entirely from props.
 */
export function ContextDocPicker({ repoId, attached, onChange }: ContextDocPickerProps) {
  const t = useTranslations("context");
  const docs = useContextDocs(repoId);

  const [filter, setFilter] = React.useState("");
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);
  const [dragPath, setDragPath] = React.useState<string | null>(null);
  const [overPath, setOverPath] = React.useState<string | null>(null);
  const previewTriggerRef = React.useRef<HTMLElement | null>(null);
  const rowRefs = React.useRef<Map<string, HTMLButtonElement>>(new Map());

  const files = docs.data?.files ?? [];
  const rows = buildAttachRows(files, attached);
  const visibleRows = filterRows(rows, filter);
  const canReorder = filter.trim() === "";
  const attachedCount = rows.filter((r) => r.attached).length;
  const tokens = attachedTokens(rows);
  // F12: a null/undefined repoId (useActiveRepo before repos resolve, or no active repo)
  // disables the query, so `docs.isLoading` never turns true — it stays `isPending` with
  // no data. Rendering rows in that state showed every attached path as "Missing" with a
  // live Detach button that permanently dropped it on one click.
  const loading = !repoId || docs.isPending;
  const conflict = docs.isError && docs.error instanceof ApiError && docs.error.status === 409;

  const endDrag = () => {
    setDragPath(null);
    setOverPath(null);
  };

  const openPreview = (path: string) => {
    previewTriggerRef.current = rowRefs.current.get(path) ?? null;
    setPreviewPath(path);
  };

  if (conflict) {
    const message = docs.error instanceof ApiError ? docs.error.message : undefined;
    return (
      <div style={s.wrap}>
        <ErrorState body={message} onRetry={() => docs.refetch()} />
      </div>
    );
  }

  if (loading) {
    return (
      <div style={s.wrap}>
        <div style={s.skeletons}>
          <Skeleton height={36} />
          <Skeleton height={36} />
          <Skeleton height={36} />
        </div>
      </div>
    );
  }

  if (docs.isError) {
    return (
      <div style={s.wrap}>
        <ErrorState body={t("picker.loadError")} onRetry={() => docs.refetch()} />
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <span style={s.count}>{t("picker.attachedCount", { attached: attachedCount, total: rows.length })}</span>
        {attachedCount > 0 && <span style={s.tokensNote}>{t("picker.tokens", { tokens })}</span>}
      </div>
      {attachedCount > 0 && <p style={s.untrustedNote}>{t("picker.untrustedNote")}</p>}

      <div style={s.filterWrap}>
        <Icon.Search size={13} style={s.filterIcon} />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("picker.filterPlaceholder")}
          aria-label={t("picker.filterPlaceholder")}
          style={s.filterInput}
        />
      </div>

      <ul style={s.list} aria-label={t("picker.title")}>
        {visibleRows.map((row) => (
          <PickerRow
            key={row.path}
            row={row}
            canReorder={canReorder}
            dragging={dragPath === row.path}
            dropTarget={overPath === row.path && dragPath !== row.path}
            registerPreviewButton={(el) => {
              if (el) rowRefs.current.set(row.path, el);
              else rowRefs.current.delete(row.path);
            }}
            onToggle={() => onChange(toggleDoc(attached, row.path))}
            onDetach={() => onChange(toggleDoc(attached, row.path))}
            onMove={(dir) => onChange(moveDoc(attached, row.path, dir))}
            onPreview={() => openPreview(row.path)}
            onDragStart={() => setDragPath(row.path)}
            onDragEnter={() => dragPath && setOverPath(row.path)}
            onDrop={() => {
              if (dragPath && dragPath !== row.path) {
                const next = reorderAttached(attached, dragPath, row.path);
                // reorderAttached returns the SAME reference (e.g. a drop onto an
                // unattached row) when nothing moved — skip the save call entirely
                // instead of firing a redundant PUT with an unchanged list (F14).
                if (next !== attached) onChange(next);
              }
              endDrag();
            }}
            onDragEnd={endDrag}
          />
        ))}
      </ul>

      {previewPath && (
        <DocPreviewModal
          repoId={repoId}
          path={previewPath}
          onClose={() => setPreviewPath(null)}
          returnFocusRef={previewTriggerRef}
        />
      )}
    </div>
  );
}

function PickerRow({
  row,
  canReorder,
  dragging,
  dropTarget,
  registerPreviewButton,
  onToggle,
  onDetach,
  onMove,
  onPreview,
  onDragStart,
  onDragEnter,
  onDrop,
  onDragEnd,
}: {
  row: AttachRow;
  canReorder: boolean;
  dragging: boolean;
  dropTarget: boolean;
  registerPreviewButton: (el: HTMLButtonElement | null) => void;
  onToggle: () => void;
  onDetach: () => void;
  onMove: (dir: -1 | 1) => void;
  onPreview: () => void;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  const t = useTranslations("context");

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!canReorder || !row.attached || !e.altKey) return;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      onMove(e.key === "ArrowUp" ? -1 : 1);
    }
  };

  return (
    <li
      data-doc-path={row.path}
      tabIndex={0}
      draggable={canReorder && row.attached}
      onKeyDown={onKeyDown}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, row.path);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnter={onDragEnter}
      onDragOver={(e) => {
        if (canReorder) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
      style={s.row({ dragging, over: dropTarget, muted: row.missing })}
    >
      <span
        aria-hidden="true"
        title={canReorder ? t("picker.reorderKeys") : t("picker.reorderPaused")}
        style={s.handle(canReorder && row.attached)}
      >
        ⠿
      </span>
      <div style={s.main}>
        <Checkbox checked={row.attached} onChange={onToggle} label={<span className="mono" style={s.name}>{row.name}</span>} />
        <span style={s.folder}>{row.folder}</span>
        {row.missing ? (
          <span style={s.missingBadge}>{t("picker.missing")}</span>
        ) : (
          <DocTypeBadge type={row.type} />
        )}
      </div>
      {row.attached && canReorder && (
        <div style={s.moveBtns}>
          <IconBtn icon="ArrowUp" label={t("picker.moveUp", { name: row.name })} size={24} onClick={() => onMove(-1)} />
          <IconBtn icon="ArrowDown" label={t("picker.moveDown", { name: row.name })} size={24} onClick={() => onMove(1)} />
        </div>
      )}
      {row.missing ? (
        <IconBtn icon="Trash" label={t("picker.detach", { name: row.name })} onClick={onDetach} />
      ) : (
        // IconBtn is a plain function component (no forwardRef) — wrap it to capture the
        // native <button> it renders, so focus can return to it when the preview closes.
        <span ref={(el) => registerPreviewButton(el?.querySelector("button") ?? null)}>
          <IconBtn icon="Eye" label={t("picker.preview", { name: row.name })} onClick={onPreview} />
        </span>
      )}
    </li>
  );
}
