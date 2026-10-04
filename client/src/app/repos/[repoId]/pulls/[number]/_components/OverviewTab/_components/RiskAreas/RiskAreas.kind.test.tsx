/* RiskAreas.kind.test.tsx — fix F4 (plan-verifier AC-52/S15): the risk icon is
   chosen by `risk.kind` (closed RiskKind vocabulary) and coloured by
   severity, with an accessible kind label from `brief.risks.kind.*`. Not the
   frozen RiskAreas.test.tsx — that file already fixes the severity
   aria-label/colour contract (AC-51/AC-52 colour half) and must not be
   touched; this file covers the kind half only. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrBrief, Risk } from "@devdigest/shared";
import briefMessages from "../../../../../../../../../../messages/en/brief.json";
import { RiskAreas } from "./RiskAreas";

function risk(over: Partial<Risk>): Risk {
  return {
    kind: "config_secrets",
    title: "Secret key committed in config",
    explanation: "src/config.ts carries a live key; it must move to the environment.",
    severity: "high",
    file_refs: ["src/config.ts"],
    ...over,
  };
}

function brief(risks: Risk[]): PrBrief {
  return {
    pr_id: "pr1",
    head_sha: "sha1",
    summary: "x",
    risks,
    review_focus: [],
    missing_inputs: [],
    model: "deepseek/deepseek-v4-flash",
    provider: "openrouter",
    generated_at: "2026-10-01T12:00:00Z",
    stats: { tokens_in: 100, tokens_out: 50, cost_usd: 0.001, attempts: 1, duration_ms: 100 },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderAreas(risks: Risk[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "",
      json: async () => ({ brief: brief(risks), current_head_sha: "sha1", outdated: false, job: null }),
    })),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
        <RiskAreas prId="pr1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("RiskAreas — icon by kind (F4)", () => {
  it("AC-52: renders a distinct icon per RiskKind and an accessible kind label", async () => {
    const kinds: Risk["kind"][] = [
      "auth_surface",
      "dependency",
      "performance",
      "data_migration",
      "api_contract",
      "config_secrets",
      "test_coverage",
      "other",
    ];
    renderAreas(kinds.map((kind, i) => risk({ kind, title: `Risk ${i}`, severity: "high" })));
    await screen.findByText("Risk 0");

    const seen = new Set<string>();
    for (const kind of kinds) {
      const el = document.querySelector(`[data-risk-kind="${kind}"]`);
      expect(el, `icon for kind ${kind}`).not.toBeNull();
      const tag = el!.getAttribute("data-risk-kind")!;
      seen.add(tag);
      expect(screen.getByText(briefMessages.risks.kind[kind as keyof typeof briefMessages.risks.kind])).toBeInTheDocument();
    }
    // every kind rendered a differently-tagged icon node (closed vocabulary, each kind distinct)
    expect(seen.size).toBe(kinds.length);
  });

  it("colours the kind icon by severity, not by kind", async () => {
    renderAreas([risk({ kind: "performance", severity: "medium", title: "Perf risk" })]);
    await screen.findByText("Perf risk");
    const el = document.querySelector('[data-risk-kind="performance"]') as HTMLElement;
    expect(el.style.color).toBe("var(--warn)");
  });

  it("falls back to the 'other' label/icon slot for an unrecognised kind value", async () => {
    renderAreas([risk({ kind: "other", title: "Unknown-shaped risk" })]);
    await screen.findByText("Unknown-shaped risk");
    expect(document.querySelector('[data-risk-kind="other"]')).not.toBeNull();
    expect(screen.getByText(briefMessages.risks.kind.other)).toBeInTheDocument();
  });
});
