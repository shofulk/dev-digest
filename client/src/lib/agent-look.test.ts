import { describe, it, expect } from "vitest";
import { AGENT_ACCENTS, AGENT_ICONS, agentLook } from "./agent-look";

const IDS = Array.from({ length: 20 }, (_, i) => `00000000-0000-4000-8000-${String(i * 7919).padStart(12, "0")}`);

describe("agentLook (AC-16)", () => {
  it("AC-16: exposes non-empty accent and icon palettes", () => {
    expect(AGENT_ACCENTS.length).toBeGreaterThan(1);
    expect(AGENT_ICONS.length).toBeGreaterThan(1);
  });

  it("AC-16: is identical across calls for the same id", () => {
    for (const id of IDS) {
      expect(agentLook(id)).toEqual(agentLook(id));
    }
  });

  it("AC-16: is identical after a module reload", async () => {
    const before = IDS.map((id) => agentLook(id));
    const { vi } = await import("vitest");
    vi.resetModules();
    const fresh = await import("./agent-look");
    expect(IDS.map((id) => fresh.agentLook(id))).toEqual(before);
  });

  it("AC-16: picks the accent and icon from the exported palettes", () => {
    for (const id of IDS) {
      const look = agentLook(id);
      expect(AGENT_ACCENTS).toContain(look.accent);
      expect(AGENT_ICONS).toContain(look.icon);
    }
  });

  it("AC-16: depends on the id only, never on a name or position", () => {
    // The signature takes a single id; extra arguments must not change the result.
    const fn = agentLook as unknown as (id: string, extra?: unknown) => unknown;
    for (const id of IDS) {
      expect(fn(id, "Security reviewer")).toEqual(fn(id, "Performance reviewer"));
      expect(fn(id, "x")).toEqual(agentLook(id));
    }
  });

  it("AC-16: spreads 20 distinct ids over at least 2 accents", () => {
    const accents = new Set(IDS.map((id) => agentLook(id).accent));
    expect(accents.size).toBeGreaterThanOrEqual(2);
  });
});
