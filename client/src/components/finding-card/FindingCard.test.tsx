import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });
});

describe("FindingCard eval-case action", () => {
  const ACCEPTED = { ...FINDING, accepted_at: "2026-10-01T00:00:00Z" };
  const DISMISSED = { ...FINDING, dismissed_at: "2026-10-01T00:00:00Z" };
  const evalButton = () => screen.getByRole("button", { name: /Turn into eval case/ });

  it("is disabled with the triage hint while the finding is untriaged", () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onEvalCase={() => {}} />);
    expect(evalButton()).toBeDisabled();
    expect(evalButton()).toHaveAttribute("title", "Accept or dismiss this finding first");
  });

  it("labels must_find for an accepted finding and must_not_flag for a dismissed one", () => {
    renderWithIntl(<FindingCard f={ACCEPTED} defaultExpanded onEvalCase={() => {}} />);
    expect(evalButton()).toBeEnabled();
    expect(evalButton()).toHaveTextContent("as must_find");
    cleanup();
    renderWithIntl(<FindingCard f={DISMISSED} defaultExpanded onEvalCase={() => {}} />);
    expect(evalButton()).toHaveTextContent("as must_not_flag");
  });

  it("calls onEvalCase once per click and is disabled while evalPending", () => {
    const onEvalCase = vi.fn();
    renderWithIntl(<FindingCard f={ACCEPTED} defaultExpanded onEvalCase={onEvalCase} />);
    fireEvent.click(evalButton());
    expect(onEvalCase).toHaveBeenCalledTimes(1);
    // The parent gets the clicked button, to return focus to it when the modal closes.
    expect(onEvalCase).toHaveBeenCalledWith(evalButton());
    cleanup();
    renderWithIntl(<FindingCard f={ACCEPTED} defaultExpanded onEvalCase={onEvalCase} evalPending />);
    expect(evalButton()).toBeDisabled();
  });

  it("leaves accept/dismiss untouched by the eval action", () => {
    const onAction = vi.fn();
    const onEvalCase = vi.fn();
    renderWithIntl(<FindingCard f={ACCEPTED} defaultExpanded onAction={onAction} onEvalCase={onEvalCase} />);
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
    expect(onEvalCase).not.toHaveBeenCalled();
  });
});

describe("FindingCard keyboard, severity name and title markdown", () => {
  it("the header is operable from the keyboard: Tab reaches the toggle, Enter expands, Space collapses", async () => {
    const user = userEvent.setup();
    renderWithIntl(<FindingCard f={FINDING} onAction={() => {}} />);
    const toggle = screen.getByRole("button", { name: "Show details" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Accept")).not.toBeInTheDocument();

    for (let i = 0; i < 10 && document.activeElement !== toggle; i++) await user.tab();
    expect(toggle).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Accept")).toBeInTheDocument();

    await user.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Accept")).not.toBeInTheDocument();
  });

  it("a click on the header still toggles exactly once", () => {
    renderWithIntl(<FindingCard f={FINDING} onAction={() => {}} />);
    fireEvent.click(screen.getByText("Hardcoded Stripe secret key"));
    expect(screen.getByRole("button", { name: "Show details" })).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByRole("button", { name: "Show details" })).toHaveAttribute("aria-expanded", "false");
  });

  it("the icon-only severity badge has an accessible name", () => {
    renderWithIntl(<FindingCard f={FINDING} />);
    expect(screen.getByRole("img", { name: "Critical" })).toBeInTheDocument();
  });

  it("C10 / AC-67: the title renders through Markdown and never injects raw HTML", () => {
    renderWithIntl(
      <FindingCard f={{ ...FINDING, title: 'Unsafe `eval` of **input** <img src=x onerror=alert(1)>' }} />,
    );
    expect(screen.getByText("eval").tagName).toBe("CODE");
    expect(screen.getByText("input").tagName).toBe("STRONG");
    expect(document.querySelector("img")).toBeNull();
  });
});
