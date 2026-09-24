import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Skill } from "@devdigest/shared";
import { SkillsTestProviders } from "@/test/skills-intl";
import { PreviewTab } from "./PreviewTab";

afterEach(cleanup);

const SKILL: Skill = {
  id: "s1",
  name: "flaky-test-patterns",
  description: "d",
  type: "rubric",
  source: "manual",
  body: "# Saved heading\n\nsaved text",
  enabled: true,
  version: 2,
  created_at: "2026-09-01T00:00:00Z",
};

function renderPreview(draftBody: string | null) {
  return render(
    <SkillsTestProviders>
      <PreviewTab skill={SKILL} draftBody={draftBody} />
    </SkillsTestProviders>,
  );
}

describe("PreviewTab", () => {
  it("shows the heading and the reviewing-agent line", () => {
    renderPreview(null);
    expect(screen.getByRole("heading", { name: "Preview" })).toBeInTheDocument();
    expect(screen.getByText("Rendered as the reviewing agent receives it.")).toBeInTheDocument();
  });

  it("renders the saved body as markdown when nothing is being edited", () => {
    renderPreview(null);
    expect(screen.getByText(/saved text/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Saved heading", level: 1 })).toBeInTheDocument();
  });

  // Document typography is CSS on the `.dd-md` wrapper (client/src/app/globals.css), which
  // jsdom never applies — what a test can pin is the DOM contract those rules key off.
  it("emits the heading and list elements the markdown styles key off", () => {
    renderPreview("## Section\n\n- first\n- second");
    expect(screen.getByRole("heading", { name: "Section", level: 2 })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("renders the EDITED body, not the saved one, when the body is dirty", () => {
    renderPreview("**edited** text");
    const panel = screen.getByTestId("skill-preview");
    expect(panel).toHaveTextContent("edited text");
    expect(panel).not.toHaveTextContent("saved text");
    expect(screen.getByText("edited").tagName).toBe("STRONG");
  });

  it("says so when the previewed body is empty", () => {
    renderPreview("");
    expect(screen.getByText("This skill has no body yet.")).toBeInTheDocument();
  });
});
