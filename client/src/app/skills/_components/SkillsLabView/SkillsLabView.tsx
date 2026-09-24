/* /skills — Skills Lab. Two panes inside AppShell: the skill list on the left, the
   four-tab editor on the right. Selection and tab live in `?skill=&tab=` so a reload or a
   shared link restores both; switching skills keeps the tab. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { CreateSkillModal } from "./_components/CreateSkillModal";
import { ImportSkillDrawer } from "./_components/ImportSkillDrawer";
import { SkillEditor, resolveSkillTab, DEFAULT_SKILL_TAB, type SkillTab } from "./_components/SkillEditor";
import { SkillList } from "./_components/SkillList";
import { buildSkillsUrl } from "./helpers";
import { s } from "./styles";

export function SkillsLabView() {
  const t = useTranslations("skills");
  const router = useRouter();
  const search = useSearchParams();
  const [creating, setCreating] = React.useState(false);
  const [importing, setImporting] = React.useState(false);

  const skillId = search.get("skill");
  const tab = resolveSkillTab(search.get("tab"));
  const go = (next: { skill?: string | null; tab?: SkillTab | null }) =>
    router.replace(buildSkillsUrl(search.toString(), next), { scroll: false });

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbSkills") }]}>
      {creating && (
        <CreateSkillModal
          onClose={() => setCreating(false)}
          onCreated={(skill) => {
            setCreating(false);
            go({ skill: skill.id, tab: DEFAULT_SKILL_TAB });
          }}
        />
      )}
      <ImportSkillDrawer
        open={importing}
        onClose={() => setImporting(false)}
        onImported={(skill) => go({ skill: skill.id })}
      />
      <div style={s.panes}>
        <div style={s.left}>
          <SkillList
            selectedId={skillId}
            onSelect={(id) => go({ skill: id })}
            onCreate={() => setCreating(true)}
            onImport={() => setImporting(true)}
          />
        </div>
        <div style={s.right}>
          {skillId ? (
            <SkillEditor
              key={skillId}
              skillId={skillId}
              tab={tab}
              onTab={(next) => go({ tab: next })}
              onDeleted={() => go({ skill: null })}
            />
          ) : (
            <div style={s.prompt}>
              <EmptyState icon="Sparkles" title={t("page.selectPrompt.title")} body={t("page.selectPrompt.body")} />
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
