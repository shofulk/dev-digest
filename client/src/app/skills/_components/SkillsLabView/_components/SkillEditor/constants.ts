import type React from "react";
import type { IconName } from "@devdigest/ui";
import { ConfigTab, type ConfigTabProps } from "./_components/ConfigTab";
import { PreviewTab, type PreviewTabProps } from "./_components/PreviewTab";
import { StatsTab } from "./_components/StatsTab";
import { VersionsTab, type VersionsTabProps } from "./_components/VersionsTab";

/** Tab keys in display order. Adding the (out-of-scope) evals tab later is one entry here. */
export const SKILL_TABS = ["config", "preview", "stats", "versions"] as const;
export type SkillTab = (typeof SKILL_TABS)[number];

export const DEFAULT_SKILL_TAB: SkillTab = "config";

/** Tab descriptor; `labelKey` resolves under the `skills` namespace. */
export const TAB_DEFS: readonly { key: SkillTab; labelKey: string; icon: IconName }[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "preview", labelKey: "editor.tabs.preview", icon: "Eye" },
  { key: "stats", labelKey: "editor.tabs.stats", icon: "BarChart" },
  { key: "versions", labelKey: "editor.tabs.versions", icon: "History" },
];

/** Everything SkillEditor hands to whichever tab is active; each tab takes the subset it declares. */
export type EditorTabProps = ConfigTabProps & PreviewTabProps & VersionsTabProps;

/** Tab body per key — the seam the second wave fills in by replacing the components. */
export const TAB_COMPONENTS: Record<SkillTab, React.ComponentType<EditorTabProps>> = {
  config: ConfigTab,
  preview: PreviewTab,
  stats: StatsTab,
  versions: VersionsTab,
};
