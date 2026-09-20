import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../messages/en/prReview.json";

import { SeverityCounters } from "./SeverityCounters";
import { countBySeverity, parseSeverityParam, isEmptyCounts } from "./helpers";

afterEach(cleanup);

const COUNTS = { CRITICAL: 3, WARNING: 5, SUGGESTION: 2 };

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function finding(id: string, severity: string): FindingRecord {
  return {
    id,
    severity: severity as FindingRecord["severity"],
    category: "security",
    title: id,
    file: "src/config.ts",
    start_line: 1,
    end_line: 1,
    rationale: "Because.",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  };
}

describe("SeverityCounters", () => {
  it("renders one counter per severity with its count", () => {
    renderWithIntl(<SeverityCounters counts={COUNTS} active={null} onSelect={vi.fn()} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toHaveTextContent("3critical");
    expect(buttons[1]).toHaveTextContent("5warning");
    expect(buttons[2]).toHaveTextContent("2suggestion");
  });

  it("marks only the active level as pressed", () => {
    renderWithIntl(<SeverityCounters counts={COUNTS} active="WARNING" onSelect={vi.fn()} />);
    const [crit, warn, sugg] = screen.getAllByRole("button");
    expect(crit).toHaveAttribute("aria-pressed", "false");
    expect(warn).toHaveAttribute("aria-pressed", "true");
    expect(sugg).toHaveAttribute("aria-pressed", "false");
  });

  it("selects an inactive level on click", () => {
    const onSelect = vi.fn();
    renderWithIntl(<SeverityCounters counts={COUNTS} active={null} onSelect={onSelect} />);
    fireEvent.click(screen.getAllByRole("button")[0]!);
    expect(onSelect).toHaveBeenCalledWith("CRITICAL");
  });

  it("clears the filter when the active level is clicked again", () => {
    const onSelect = vi.fn();
    renderWithIntl(<SeverityCounters counts={COUNTS} active="CRITICAL" onSelect={onSelect} />);
    fireEvent.click(screen.getAllByRole("button")[0]!);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("disables a level with no findings", () => {
    renderWithIntl(
      <SeverityCounters
        counts={{ ...COUNTS, SUGGESTION: 0 }}
        active={null}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("button")[2]).toBeDisabled();
  });

  it("keeps an emptied active level clickable, so the filter can be cleared", () => {
    renderWithIntl(
      <SeverityCounters
        counts={{ ...COUNTS, SUGGESTION: 0 }}
        active="SUGGESTION"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("button")[2]).toBeEnabled();
  });

  it("renders nothing when the PR has no findings at all", () => {
    const { container } = renderWithIntl(
      <SeverityCounters
        counts={{ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 }}
        active={null}
        onSelect={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("drops empty levels and labels in compact form", () => {
    renderWithIntl(
      <SeverityCounters
        compact
        counts={{ ...COUNTS, SUGGESTION: 0 }}
        active={null}
        onSelect={vi.fn()}
      />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveTextContent("3");
    expect(buttons[0]).not.toHaveTextContent("critical");
  });

  it("keeps an active level visible in compact form even at zero", () => {
    renderWithIntl(
      <SeverityCounters
        compact
        counts={{ ...COUNTS, SUGGESTION: 0 }}
        active="SUGGESTION"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("names the group for screen readers", () => {
    renderWithIntl(<SeverityCounters counts={COUNTS} active={null} onSelect={vi.fn()} />);
    expect(screen.getByRole("group", { name: "Filter findings by severity" })).toBeInTheDocument();
  });
});

describe("countBySeverity", () => {
  it("counts each level and reports zero for the absent ones", () => {
    const counts = countBySeverity([
      finding("a", "CRITICAL"),
      finding("b", "CRITICAL"),
      finding("c", "WARNING"),
    ]);
    expect(counts).toEqual({ CRITICAL: 2, WARNING: 1, SUGGESTION: 0 });
  });

  it("returns all-zero for an empty list", () => {
    const counts = countBySeverity([]);
    expect(counts).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 });
    expect(isEmptyCounts(counts)).toBe(true);
  });

  it("ignores a severity outside the contract enum", () => {
    expect(countBySeverity([finding("x", "INFO")])).toEqual({
      CRITICAL: 0,
      WARNING: 0,
      SUGGESTION: 0,
    });
  });
});

describe("parseSeverityParam", () => {
  it("accepts a contract severity", () => {
    expect(parseSeverityParam("CRITICAL")).toBe("CRITICAL");
  });

  it("rejects a lowercase or unknown value, and a missing one", () => {
    expect(parseSeverityParam("critical")).toBeNull();
    expect(parseSeverityParam("NOPE")).toBeNull();
    expect(parseSeverityParam(null)).toBeNull();
  });
});
