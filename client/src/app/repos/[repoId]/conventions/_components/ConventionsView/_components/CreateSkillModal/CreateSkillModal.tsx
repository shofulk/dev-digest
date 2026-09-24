/* CreateSkillModal — the selected conventions, merged into one editable skill. The draft
   comes from the server (POST /repos/:id/conventions/skill) and persists NOTHING until the
   user submits: preview, edit, then confirm, the same flow skill import uses.

   Save and link are two steps on purpose. The skill exists the moment `POST /skills/extracted`
   answers, so a failed LINK must not read as a failed CREATE — it is reported separately and
   the user is told where to finish the job. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  FormField,
  Icon,
  Modal,
  SelectInput,
  Skeleton,
  TextInput,
  Toggle,
} from "@devdigest/ui";
import type { ConventionSkillDraft, SkillType } from "@devdigest/shared";
import { BodyEditor } from "@/app/skills/_components/SkillsLabView/_components/SkillEditor/_components/ConfigTab/_components/BodyEditor";
import { useAgents } from "@/lib/hooks/agents";
import { useLinkAgentSkill } from "@/lib/hooks/agent-skills";
import { useCreateExtractedSkill } from "@/lib/hooks/skills";
import { notify } from "@/lib/toast";
import {
  DEFAULT_TYPE,
  DRAFT_SKELETON_HEIGHT,
  MODAL_WIDTH,
  NO_AGENT,
  TYPE_VALUES,
} from "./constants";
import { canCreate, skillLabHref } from "./helpers";
import { s } from "./styles";

export function CreateSkillModal({
  repoName,
  selectedCount,
  draft,
  onClose,
}: {
  repoName: string;
  /** How many candidates the draft was assembled from — shown in the banner. */
  selectedCount: number;
  /** Undefined while the draft request is in flight. */
  draft: ConventionSkillDraft | undefined;
  onClose: () => void;
}) {
  const t = useTranslations("conventions");
  const router = useRouter();
  const create = useCreateExtractedSkill();
  const link = useLinkAgentSkill();
  const { data: agents } = useAgents();

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>(DEFAULT_TYPE);
  const [enabled, setEnabled] = React.useState(true);
  const [body, setBody] = React.useState("");
  const [agentId, setAgentId] = React.useState<string>(NO_AGENT);

  // The draft lands one round-trip after the modal opens; seed the form the FIRST time it
  // arrives and never again, so a refetch cannot clobber what the user has typed.
  const seeded = React.useRef(false);
  React.useEffect(() => {
    if (!draft || seeded.current) return;
    seeded.current = true;
    setName(draft.name);
    setDescription(draft.description);
    setType(draft.type);
    setBody(draft.body);
  }, [draft]);

  const pending = create.isPending || link.isPending;

  const submit = async () => {
    if (!draft) return;
    let skillId: string;
    try {
      const skill = await create.mutateAsync({
        name: name.trim(),
        description,
        type,
        body,
        evidence_files: draft.evidence_files,
        enabled,
      });
      skillId = skill.id;
    } catch {
      notify.error(t("modal.failed"));
      return; // stay open: nothing was saved
    }

    if (agentId !== NO_AGENT) {
      try {
        await link.mutateAsync({ agentId, skillId });
      } catch {
        // The skill IS saved — say so, and say where to finish linking.
        notify.error(t("modal.linkFailed"));
      }
    }
    notify.success(t("modal.created"));
    onClose();
    router.push(skillLabHref(skillId));
  };

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("modal.title")}
      subtitle={name}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <span style={s.footerHint}>{t("modal.footerHint")}</span>
          <div style={s.footerActions}>
            <Button kind="ghost" onClick={onClose}>
              {t("modal.cancel")}
            </Button>
            <Button
              kind="primary"
              icon="Sparkles"
              onClick={submit}
              disabled={!draft || pending || !canCreate(name, body)}
            >
              {pending ? t("modal.submitting") : t("modal.submit")}
            </Button>
          </div>
        </div>
      }
    >
      <div style={s.body}>
        <div style={s.banner}>
          <Icon.Sparkles size={16} style={s.bannerIcon} />
          {/* Once the draft lands, ITS `convention_ids` are the truth about what the body
              was built from — the selection can drift while the request is in flight. */}
          <span>
            {t("modal.mergedFrom", {
              count: draft ? draft.convention_ids.length : selectedCount,
              repo: repoName,
            })}
          </span>
        </div>

        {!draft ? (
          <Skeleton height={DRAFT_SKELETON_HEIGHT} />
        ) : (
          <>
            <FormField label={t("modal.name")} required>
              <TextInput mono value={name} onChange={setName} aria-label={t("modal.name")} />
            </FormField>
            <FormField label={t("modal.description")}>
              <TextInput
                value={description}
                onChange={setDescription}
                aria-label={t("modal.description")}
              />
            </FormField>

            <div style={s.row}>
              <div style={s.rowItem}>
                <FormField label={t("modal.type")}>
                  <SelectInput
                    mono={false}
                    value={type}
                    onChange={(v) => setType(v as SkillType)}
                    options={TYPE_VALUES.map((v) => ({ value: v, label: v }))}
                  />
                </FormField>
              </div>
              <div style={s.rowItem}>
                <FormField label={t("modal.enabled")} hint={t("modal.enabledHint")}>
                  <Toggle on={enabled} onChange={setEnabled} />
                </FormField>
              </div>
            </div>

            <FormField label={t("modal.linkAgent")} hint={t("modal.linkAgentHint")}>
              <SelectInput
                mono={false}
                value={agentId}
                onChange={setAgentId}
                options={[
                  { value: NO_AGENT, label: t("modal.linkAgentNone") },
                  ...(agents ?? []).map((a) => ({ value: a.id, label: a.name })),
                ]}
              />
            </FormField>

            <FormField
              label={t("modal.body")}
              required
              right={
                <span style={s.evidenceFiles}>
                  {t("modal.evidenceFiles", { count: draft.evidence_files.length })}
                </span>
              }
            >
              <BodyEditor name={name} value={body} onChange={setBody} dirty={body !== draft.body} />
            </FormField>
          </>
        )}
      </div>
    </Modal>
  );
}
