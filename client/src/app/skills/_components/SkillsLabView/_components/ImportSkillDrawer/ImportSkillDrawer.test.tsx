import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { Skill, SkillImportPreview } from "@devdigest/shared";
import { SkillsTestProviders } from "@/test/skills-intl";
import { ImportSkillDrawer } from "./ImportSkillDrawer";

const PREVIEW: SkillImportPreview = {
  name: "flaky-test-patterns",
  description: "Spot flaky tests",
  type: "rubric",
  body: "# Flaky tests\n\nNever sleep in a test.",
  source: "imported_file",
  truncated: false,
  ignored: [
    { path: "scripts/install.sh", reason: "executable" },
    { path: "assets/logo.png", reason: "binary" },
    { path: "notes.txt", reason: "not-markdown" },
    { path: "vendor/inner.zip", reason: "nested-archive" },
  ],
};

const CREATED = { id: "sk-9", name: "renamed-skill" } as Skill;

type Reply = { status: number; body: unknown };
let replies: Record<string, Reply>;
let fetchMock: ReturnType<typeof vi.fn>;

const calls = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    method: (init?.method ?? "GET") as string,
    path: new URL(url as string).pathname,
    body: init?.body ? JSON.parse(init.body as string) : undefined,
  }));

beforeEach(() => {
  replies = {
    "/skills/import/preview": { status: 200, body: PREVIEW },
    "/skills/import": { status: 201, body: CREATED },
  };
  fetchMock = vi.fn(async (url: string) => {
    const r = replies[new URL(url).pathname] ?? { status: 404, body: {} };
    return {
      ok: r.status < 400,
      status: r.status,
      statusText: "",
      json: async () => r.body,
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderDrawer(props: Partial<React.ComponentProps<typeof ImportSkillDrawer>> = {}) {
  const handlers = { onClose: vi.fn(), onImported: vi.fn() };
  render(
    <SkillsTestProviders>
      <ImportSkillDrawer open {...handlers} {...props} />
    </SkillsTestProviders>,
  );
  return handlers;
}

async function chooseFile(name = "flaky-test-patterns.zip") {
  const input = screen.getByLabelText("Skill file") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["# Flaky"], name)] } });
}

describe("ImportSkillDrawer", () => {
  it("renders nothing while closed", () => {
    renderDrawer({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("accepts only .md, .markdown and .zip", () => {
    renderDrawer();
    expect(screen.getByLabelText("Skill file")).toHaveAttribute("accept", ".md,.markdown,.zip");
  });

  it("choosing a file calls only the preview endpoint, with the file as base64", async () => {
    renderDrawer();
    await chooseFile("flaky.zip");
    await screen.findByDisplayValue("flaky-test-patterns");

    expect(calls()).toEqual([
      {
        method: "POST",
        path: "/skills/import/preview",
        body: { filename: "flaky.zip", content_base64: Buffer.from("# Flaky").toString("base64") },
      },
    ]);
  });

  it("previews the body read-only and states it becomes instructions and arrives disabled", async () => {
    renderDrawer();
    await chooseFile();
    const body = await screen.findByLabelText("Extracted body (read-only)");
    expect(body.tagName).toBe("PRE");
    expect(body).toHaveTextContent("Never sleep in a test.");
    expect(screen.getByRole("note")).toHaveTextContent(/becomes the agent's instructions/);
    expect(screen.getByRole("note")).toHaveTextContent(/arrives disabled/);
  });

  it("renders each ignored entry with its reason; executable ones say not read and not run", async () => {
    renderDrawer();
    await chooseFile();
    await screen.findByText("scripts/install.sh");

    expect(screen.getByText("Executable — not read and not run")).toBeInTheDocument();
    expect(screen.getByText("Binary file — not read")).toBeInTheDocument();
    expect(screen.getByText("Not a Markdown file — not read")).toBeInTheDocument();
    expect(screen.getByText("Nested archive — not opened")).toBeInTheDocument();
    expect(screen.getByText("Ignored archive entries (4)")).toBeInTheDocument();
  });

  it("shows the truncated notice only when the flag is set", async () => {
    replies["/skills/import/preview"] = { status: 200, body: { ...PREVIEW, truncated: true } };
    renderDrawer();
    await chooseFile();
    expect(await screen.findByText(/The body was truncated/)).toBeInTheDocument();
  });

  it("does not show the truncated notice or an ignored list for a clean markdown import", async () => {
    replies["/skills/import/preview"] = { status: 200, body: { ...PREVIEW, ignored: [] } };
    renderDrawer();
    await chooseFile("a.md");
    await screen.findByDisplayValue("flaky-test-patterns");
    expect(screen.queryByText(/The body was truncated/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ignored archive entries/)).not.toBeInTheDocument();
  });

  it("cancel performs no write to /skills/import", async () => {
    const h = renderDrawer();
    await chooseFile();
    await screen.findByDisplayValue("flaky-test-patterns");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(h.onClose).toHaveBeenCalledTimes(1);
    expect(h.onImported).not.toHaveBeenCalled();
    expect(calls().filter((c) => c.path === "/skills/import")).toEqual([]);
  });

  it("resets to the file step when reopened after a preview", async () => {
    const { rerender } = render(
      <SkillsTestProviders>
        <ImportSkillDrawer open onClose={() => {}} />
      </SkillsTestProviders>,
    );
    await chooseFile();
    await screen.findByDisplayValue("flaky-test-patterns");

    rerender(
      <SkillsTestProviders>
        <ImportSkillDrawer open={false} onClose={() => {}} />
      </SkillsTestProviders>,
    );
    rerender(
      <SkillsTestProviders>
        <ImportSkillDrawer open onClose={() => {}} />
      </SkillsTestProviders>,
    );
    expect(screen.getByLabelText("Skill file")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("flaky-test-patterns")).not.toBeInTheDocument();
  });

  it("confirm posts the edited fields with the previewed body, then reports and closes", async () => {
    const h = renderDrawer();
    await chooseFile();
    const name = await screen.findByLabelText("Name");

    fireEvent.change(name, { target: { value: "  renamed-skill  " } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Edited description" } });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "security" } });
    fireEvent.click(screen.getByRole("button", { name: "Import skill" }));

    await waitFor(() => expect(h.onClose).toHaveBeenCalledTimes(1));
    expect(calls().filter((c) => c.path === "/skills/import")).toEqual([
      {
        method: "POST",
        path: "/skills/import",
        body: {
          name: "renamed-skill",
          description: "Edited description",
          type: "security",
          body: PREVIEW.body,
        },
      },
    ]);
    expect(h.onImported).toHaveBeenCalledWith(CREATED);
  });

  it("disables confirm while the name is blank", async () => {
    renderDrawer();
    await chooseFile();
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "  " } });
    expect(screen.getByRole("button", { name: "Import skill" })).toBeDisabled();
  });

  it("a rejected import shows the server's message inline and stays on the file step", async () => {
    replies["/skills/import/preview"] = {
      status: 400,
      body: { error: { code: "bad_request", message: "Archive contains an unsafe path: ../evil.md" } },
    };
    const h = renderDrawer();
    await chooseFile();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Archive contains an unsafe path: ../evil.md");
    expect(screen.getByLabelText("Skill file")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import skill" })).not.toBeInTheDocument();
    expect(h.onClose).not.toHaveBeenCalled();
    expect(calls().map((c) => c.path)).toEqual(["/skills/import/preview"]);
  });

  it("a failed confirm shows the message in the footer and keeps the preview", async () => {
    replies["/skills/import"] = {
      status: 400,
      body: { error: { code: "bad_request", message: "A skill with that name already exists" } },
    };
    const h = renderDrawer();
    await chooseFile();
    await screen.findByDisplayValue("flaky-test-patterns");
    fireEvent.click(screen.getByRole("button", { name: "Import skill" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("A skill with that name already exists");
    expect(screen.getByDisplayValue("flaky-test-patterns")).toBeInTheDocument();
    expect(h.onClose).not.toHaveBeenCalled();
  });
});
