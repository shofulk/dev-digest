/* RiskAreas.icon.test.tsx — fix-list F15/F16 (round 2), spec AC-52/AC-17.
   The retro (`pr-brief.retro.md` it.2 #4/#5) flags `RiskAreas.kind.test.tsx`
   as a tautology: its "distinct icon per kind" assertion counts
   `data-risk-kind`, an attribute copied straight from `risk.kind` — any
   implementation renders a different `data-risk-kind` per kind whether or
   not it picks a different icon, so it cannot fail. Its "unrecognised
   kind" test also feeds the real list member `"other"`, never a value
   outside the closed `RiskKind` vocabulary, so the fallback branch is
   never exercised.

   This file is NEW and does not touch RiskAreas.kind.test.tsx. It
   SUPERSEDES two of that file's assertions without removing them:
     - "AC-52: renders a distinct icon per RiskKind …" (RiskAreas.kind.test.tsx:68-92)
       → replaced here by asserting on the rendered icon's own markup/identity,
         not `data-risk-kind`.
     - "falls back to the 'other' label/icon slot for an unrecognised kind
       value" (RiskAreas.kind.test.tsx:101-106) → replaced here by a `kind`
       value cast outside the closed list, which that file never used. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrBrief, Risk } from "@devdigest/shared";
import briefMessages from "../../../../../../../../../../messages/en/brief.json";
import { RiskAreas } from "./RiskAreas";
import { riskKindIcon } from "./helpers";

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

describe("riskKindIcon — pure function (F15)", () => {
  it("AC-52: returns 8 distinct icon names for the 8 closed RiskKind values", () => {
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
    const icons = kinds.map((k) => riskKindIcon(k));
    expect(new Set(icons).size).toBe(8);
  });
});

describe("RiskAreas — icon rendering is kind-driven, not an attribute echo (F15)", () => {
  it("AC-52: two risks of different kinds render icon elements with different inner markup", async () => {
    renderAreas([
      risk({ kind: "auth_surface", title: "Risk A" }),
      risk({ kind: "dependency", title: "Risk B" }),
    ]);
    await screen.findByText("Risk A");
    await screen.findByText("Risk B");

    const icons = Array.from(document.querySelectorAll('[role="img"]'));
    expect(icons).toHaveLength(2);
    // Each lucide icon renders its own distinct set of <path>/<svg> children —
    // if the implementation picked the same icon component for both kinds,
    // this would be identical.
    expect(icons[0]!.innerHTML).not.toBe(icons[1]!.innerHTML);
  });
});

describe("RiskAreas — unrecognised kind falls back to 'other' (F16)", () => {
  it("AC-17: a kind outside the closed RiskKind vocabulary renders the 'other' icon and the 'risks.kind.other' label, never the raw key", async () => {
    renderAreas([risk({ kind: "brand_new" as Risk["kind"], title: "Freshly invented risk kind" })]);
    await screen.findByText("Freshly invented risk kind");

    // Icon: same markup as a real "other"-kind risk would render.
    const unknownIconHtml = document.querySelector('[role="img"]')!.innerHTML;

    // Label: the fallback translation, never the raw "risks.kind.brand_new" key —
    // asserted against THIS render (the unknown kind), not a second one.
    expect(screen.getByText(briefMessages.risks.kind.other)).toBeInTheDocument();
    expect(screen.queryByText(/risks\.kind\.brand_new/)).not.toBeInTheDocument();

    cleanup();
    renderAreas([risk({ kind: "other", title: "A real 'other'-kind risk" })]);
    await screen.findByText("A real 'other'-kind risk");
    const otherIconHtml = document.querySelector('[role="img"]')!.innerHTML;
    expect(unknownIconHtml).toBe(otherIconHtml);
  });
});
