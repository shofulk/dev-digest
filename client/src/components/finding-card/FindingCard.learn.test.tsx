import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../messages/en/prReview.json";
import { FindingCard } from "./FindingCard";

afterEach(cleanup);

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A live key is committed.",
  suggestion: null,
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderCard(f: FindingRecord, props: Partial<React.ComponentProps<typeof FindingCard>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <FindingCard f={f} defaultExpanded onLearn={() => {}} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("FindingCard Learn action", () => {
  it("AC-73: Learn is enabled for an untriaged, an accepted and a dismissed finding and fires onLearn", () => {
    const onLearn = vi.fn();
    const states: FindingRecord[] = [
      FINDING,
      { ...FINDING, accepted_at: "2026-10-01T00:00:00Z" },
      { ...FINDING, dismissed_at: "2026-10-01T00:00:00Z" },
    ];
    for (const f of states) {
      renderCard(f, { onLearn });
      const learn = screen.getByRole("button", { name: "Learn" });
      expect(learn).toBeEnabled();
      fireEvent.click(learn);
      cleanup();
    }
    expect(onLearn).toHaveBeenCalledTimes(3);
  });

  it("AC-72: a finding that already has a memory row shows Learned instead of Learn", () => {
    renderCard({ ...FINDING, learned: true });
    expect(screen.getByRole("button", { name: "Learned" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Learn" })).not.toBeInTheDocument();
  });

  it("AC-72: a not-yet-learned finding (learned false or absent) shows Learn", () => {
    renderCard({ ...FINDING, learned: false });
    expect(screen.getByRole("button", { name: "Learn" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Learned" })).not.toBeInTheDocument();
  });
});
