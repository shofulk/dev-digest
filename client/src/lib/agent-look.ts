/* agent-look.ts — a deterministic accent colour + icon per agent, derived from
   the agent id only (no name, index or randomness), so one agent looks the same
   on every screen and after every reload. */
import type { IconName } from "@/vendor/ui/icons";

/** CSS colour values an agent accent is picked from. */
export const AGENT_ACCENTS: readonly string[] = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
];

/** Existing icon names an agent icon is picked from. */
export const AGENT_ICONS: readonly IconName[] = [
  "Shield",
  "Zap",
  "Bug",
  "Cpu",
  "Target",
  "Lightbulb",
  "Gauge",
  "Workflow",
];

/** FNV-1a, 32-bit. */
function hash(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function agentLook(agentId: string): { accent: string; icon: IconName } {
  const h = hash(agentId);
  return {
    accent: AGENT_ACCENTS[h % AGENT_ACCENTS.length]!,
    // Shift so accent and icon are not locked together when both lists share a length.
    icon: AGENT_ICONS[(h >>> 8) % AGENT_ICONS.length]!,
  };
}
