import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SkillsTestProviders } from "@/test/skills-intl";

const hooks = vi.hoisted(() => ({ tokens: vi.fn() }));
vi.mock("@/lib/hooks/skills", () => ({ useSkillTokens: () => ({ mutate: hooks.tokens }) }));

import { BodyEditor } from "./BodyEditor";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderEditor(over: Partial<React.ComponentProps<typeof BodyEditor>> = {}) {
  const props = {
    name: "flaky-test-patterns",
    value: "line one\nline two\nline three",
    onChange: vi.fn(),
    dirty: false,
    saved: { body: "line one\nline two\nline three", tokens: 21 },
    ...over,
  };
  render(
    <SkillsTestProviders>
      <BodyEditor {...props} />
    </SkillsTestProviders>,
  );
  return props;
}

describe("BodyEditor", () => {
  it("shows the file name, the saved token count and one gutter number per line", () => {
    renderEditor();
    expect(screen.getByText("flaky-test-patterns.md")).toBeInTheDocument();
    expect(screen.getByTestId("token-count")).toHaveTextContent("21 tokens");
    expect(screen.getByTestId("line-gutter").textContent).toBe("1\n2\n3");
    expect(hooks.tokens).not.toHaveBeenCalled();
  });

  it("shows the unsaved badge only while dirty", () => {
    renderEditor();
    expect(screen.queryByText("unsaved")).not.toBeInTheDocument();
    cleanup();
    renderEditor({ dirty: true });
    expect(screen.getByText("unsaved")).toBeInTheDocument();
  });

  it("reports edits and grows the gutter with the body", () => {
    const p = renderEditor();
    fireEvent.change(screen.getByRole("textbox", { name: "Skill body (Markdown)" }), {
      target: { value: "a\nb\nc\nd" },
    });
    expect(p.onChange).toHaveBeenCalledWith("a\nb\nc\nd");
    cleanup();
    renderEditor({ value: "a\nb\nc\nd" });
    expect(screen.getByTestId("line-gutter").textContent).toBe("1\n2\n3\n4");
  });

  it("keeps the gutter scroll-synced with the textarea", () => {
    renderEditor();
    const area = screen.getByRole("textbox", { name: "Skill body (Markdown)" });
    area.scrollTop = 120;
    fireEvent.scroll(area);
    expect(screen.getByTestId("line-gutter").scrollTop).toBe(120);
  });

  it("hides the count instead of rendering NaN when there is none", () => {
    renderEditor({ value: "edited", dirty: true });
    expect(screen.queryByTestId("token-count")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN/);
  });
});
