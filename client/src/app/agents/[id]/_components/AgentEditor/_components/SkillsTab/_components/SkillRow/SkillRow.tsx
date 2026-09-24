"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, Checkbox, Dropdown, IconBtn } from "@devdigest/ui";
import type { AgentLinkedSkill } from "@devdigest/shared";
import { DRAG_MIME, TYPE_COLORS, skillHref } from "../../constants";
import { s } from "./styles";

export interface SkillRowProps {
  link: AgentLinkedSkill;
  /** False while a filter is active: a reorder there would be relative to a partial list. */
  canReorder: boolean;
  dragging: boolean;
  dropTarget: boolean;
  onToggle: (enabled: boolean) => void;
  onUnlink: () => void;
  onMove: (delta: -1 | 1) => void;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
}

/** One linked skill: drag handle, per-agent checkbox, name, type badge, unlink menu. */
export function SkillRow({
  link,
  canReorder,
  dragging,
  dropTarget,
  onToggle,
  onUnlink,
  onMove,
  onDragStart,
  onDragEnter,
  onDrop,
  onDragEnd,
}: SkillRowProps) {
  const t = useTranslations("agents");
  const type = TYPE_COLORS[link.type];
  const globallyOff = !link.skill_enabled;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!canReorder || !e.altKey) return;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      onMove(e.key === "ArrowUp" ? -1 : 1);
    }
  };

  return (
    <li
      data-skill-id={link.skill_id}
      tabIndex={0}
      draggable={canReorder}
      onKeyDown={onKeyDown}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, link.skill_id);
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
      style={s.row({ dragging, over: dropTarget, muted: globallyOff })}
    >
      <span
        aria-hidden="true"
        title={canReorder ? t("skills.reorderKeys") : t("skills.reorderPaused")}
        style={s.handle(canReorder)}
      >
        ⠿
      </span>
      <div style={s.main(globallyOff)}>
        <Checkbox
          checked={link.enabled}
          onChange={onToggle}
          label={
            <span className="mono" style={s.name}>
              {link.name}
            </span>
          }
        />
        <Badge color={type.color} bg={type.bg}>
          {t(`skills.types.${link.type}`)}
        </Badge>
      </div>
      {globallyOff && (
        <Link href={skillHref(link.skill_id)} style={s.caption}>
          {t("skills.disabledGlobally")}
        </Link>
      )}
      <Dropdown
        width={220}
        align="right"
        trigger={<IconBtn icon="ChevronDown" label={t("skills.rowMenu", { name: link.name })} size={26} />}
        items={[{ label: t("skills.unlink"), icon: "Trash", onClick: onUnlink }]}
      />
    </li>
  );
}
