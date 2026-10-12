/* AgentEditor — agent config editor (Config), its linked skills (Skills), its attached docs
   (Context) and its eval suite (Evals). Tab state lives in ?tab=; later lessons add Stats/CI. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Tabs } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { ConfigTab } from "./_components/ConfigTab";
import { EvalsTab } from "./_components/EvalsTab";
import { SkillsTab } from "./_components/SkillsTab";
import { ContextTab } from "./_components/ContextTab";
import { TABS } from "./constants";
import { s } from "./styles";

export function AgentEditor({ agent, tab, onTab }: { agent: Agent; tab: string; onTab: (t: string) => void }) {
  const t = useTranslations("agents");
  const tabs = TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey), icon: tb.icon }));
  return (
    <div style={s.wrap}>
      <div style={s.tabsBar}>
        <Tabs tabs={tabs} value={tab} onChange={onTab} pad="0 24px" />
      </div>
      <div style={s.body}>
        {tab === "skills" ? (
          <SkillsTab agentId={agent.id} />
        ) : tab === "context" ? (
          <ContextTab agent={agent} />
        ) : tab === "evals" ? (
          <EvalsTab agentId={agent.id} />
        ) : (
          <ConfigTab agent={agent} />
        )}
      </div>
    </div>
  );
}
