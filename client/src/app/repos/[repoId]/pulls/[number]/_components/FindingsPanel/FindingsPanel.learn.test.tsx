import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { FindingRecord } from "@devdigest/shared";
import { MultiAgentTestProviders, installFetch, type Reply } from "@/test/multi-agent-intl";

vi.mock("next/navigation", () => ({
  usePathname: () => "/repos/r1/pulls/7",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded secret",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A secret is committed.",
  suggestion: null,
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

async function renderPanel(routes: Record<string, Reply>) {
  const net = installFetch(routes);
  render(
    <MultiAgentTestProviders>
      <FindingsPanel findings={[FINDING]} prId="pr1" />
    </MultiAgentTestProviders>,
  );
  await net.settled();
  return net;
}

describe("FindingsPanel Learn and action failures", () => {
  it("AC-74: the Findings tab card shows Learn and posts to /findings/<id>/learn", async () => {
    const net = await renderPanel({
      "POST /findings/f1/learn": { status: 200, body: { memory_id: "m1", created: true } },
    });
    fireEvent.click(screen.getByRole("button", { name: "Learn" }));

    await waitFor(() =>
      expect(net.calls().some((c) => c.method === "POST" && c.path === "/findings/f1/learn")).toBe(true),
    );
  });

  it("AC-61: a failing Learn toasts the API message and leaves the card unchanged", async () => {
    await renderPanel({
      "POST /findings/f1/learn": {
        status: 502,
        body: { error: { code: "llm_failed", message: "Could not distil a learning" } },
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Learn" }));

    expect(await screen.findByText("Could not distil a learning")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Learn" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Learned" })).not.toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("AC-61: a failing Accept toasts the API message and the finding stays untriaged", async () => {
    await renderPanel({
      "POST /findings/f1/accept": {
        status: 500,
        body: { error: { code: "internal", message: "Could not save the decision" } },
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    expect(await screen.findByText("Could not save the decision")).toBeInTheDocument();
    expect(screen.queryByText("accepted")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept" })).toBeEnabled();
  });
});
