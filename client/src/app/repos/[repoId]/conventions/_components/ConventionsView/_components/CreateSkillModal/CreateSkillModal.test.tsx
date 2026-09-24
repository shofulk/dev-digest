import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { Agent, ConventionSkillDraft, Skill } from "@devdigest/shared";
import { ConventionsTestProviders } from "@/test/conventions-intl";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/toast", () => ({ notify: toast }));

import { CreateSkillModal } from "./CreateSkillModal";

const DRAFT: ConventionSkillDraft = {
  name: "acme-api-conventions",
  description: "House rules extracted from acme/api",
  type: "convention",
  body: "# Conventions\n\n- Hooks are named use*\n",
  evidence_files: ["src/lib/hooks/skills.ts", "src/api/users.ts"],
  convention_ids: ["c1", "c2", "c3"],
};

const CREATED = { id: "sk-77", name: "acme-api-conventions" } as Skill;
const AGENTS = [
  { id: "ag-1", name: "Reviewer" },
  { id: "ag-2", name: "Security" },
] as Agent[];

type Reply = { status: number; body: unknown };
let replies: Record<string, Reply>;
let fetchMock: ReturnType<typeof vi.fn>;

const calls = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    method: (init?.method ?? "GET") as string,
    path: new URL(url as string).pathname,
    body: init?.body ? JSON.parse(init.body as string) : undefined,
  }));
/** Writes only — the agent list and the token count are reads the modal makes anyway. */
const writes = () =>
  calls().filter((c) => c.method !== "GET" && c.path !== "/skills/tokens");

beforeEach(() => {
  replies = {
    "/agents": { status: 200, body: AGENTS },
    "/skills/extracted": { status: 201, body: CREATED },
    "/skills/tokens": { status: 200, body: { tokens: 12 } },
    "/agents/ag-1/skills": { status: 200, body: [] },
  };
  fetchMock = vi.fn(async (url: string) => {
    const r = replies[new URL(url).pathname] ?? { status: 404, body: {} };
    return { ok: r.status < 400, status: r.status, statusText: "", json: async () => r.body } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderModal(over: Partial<React.ComponentProps<typeof CreateSkillModal>> = {}) {
  const onClose = vi.fn();
  render(
    <ConventionsTestProviders>
      <CreateSkillModal
        repoName="acme/api"
        selectedCount={3}
        draft={DRAFT}
        onClose={onClose}
        {...over}
      />
    </ConventionsTestProviders>,
  );
  return { onClose };
}

const submit = () => screen.getByRole("button", { name: "Create skill" });
const selects = () => screen.getAllByRole("combobox");

describe("CreateSkillModal", () => {
  it("shows a skeleton and a disabled submit while the draft is still in flight", () => {
    renderModal({ draft: undefined });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(submit()).toBeDisabled();
  });

  it("prefills every field from the draft response", async () => {
    renderModal();
    expect(screen.getByLabelText("Name")).toHaveValue(DRAFT.name);
    expect(screen.getByLabelText("Description")).toHaveValue(DRAFT.description);
    expect(selects()[0]).toHaveValue("convention");
    expect(screen.getByLabelText("Skill body (Markdown)")).toHaveValue(DRAFT.body);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("reports the draft's own convention count and its evidence files", () => {
    renderModal();
    expect(screen.getByText(/Merged from 3 accepted conventions in acme\/api/)).toBeInTheDocument();
    expect(screen.getByText("2 evidence files")).toBeInTheDocument();
  });

  it("writes nothing while the user edits — only the agent list is fetched", async () => {
    renderModal();
    await screen.findByRole("option", { name: "Reviewer" });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "renamed" } });
    fireEvent.change(screen.getByLabelText("Skill body (Markdown)"), { target: { value: "# Edited" } });
    expect(writes()).toEqual([]);
  });

  it("cancel closes without a single write", () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(writes()).toEqual([]);
  });

  it("submit is disabled while the name or the body is blank", () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  " } });
    expect(submit()).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "ok" } });
    fireEvent.change(screen.getByLabelText("Skill body (Markdown)"), { target: { value: "" } });
    expect(submit()).toBeDisabled();
  });

  it("confirm posts the EDITED fields once, with the draft's evidence files, then closes and deep links", async () => {
    const { onClose } = renderModal();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  renamed-conventions  " } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Edited description" } });
    fireEvent.change(selects()[0]!, { target: { value: "rubric" } });
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.change(screen.getByLabelText("Skill body (Markdown)"), { target: { value: "# Edited body" } });
    fireEvent.click(submit());

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(writes()).toEqual([
      {
        method: "POST",
        path: "/skills/extracted",
        body: {
          name: "renamed-conventions",
          description: "Edited description",
          type: "rubric",
          body: "# Edited body",
          evidence_files: DRAFT.evidence_files,
          enabled: false,
        },
      },
    ]);
    expect(toast.success).toHaveBeenCalledWith("Skill created.");
    expect(nav.push).toHaveBeenCalledWith("/skills?skill=sk-77&tab=config");
  });

  it("with no agent selected the link endpoint is never called", async () => {
    const { onClose } = renderModal();
    await screen.findByRole("option", { name: "Reviewer" });
    fireEvent.click(submit());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(writes().map((c) => c.path)).toEqual(["/skills/extracted"]);
  });

  it("selecting an agent makes a SECOND, additive call after the create", async () => {
    const { onClose } = renderModal();
    await screen.findByRole("option", { name: "Reviewer" });
    fireEvent.change(selects()[1]!, { target: { value: "ag-1" } });
    fireEvent.click(submit());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(writes()).toEqual([
      expect.objectContaining({ path: "/skills/extracted" }),
      { method: "POST", path: "/agents/ag-1/skills", body: { skill_id: "sk-77" } },
    ]);
  });

  it("a FAILED link still leaves the skill reported as created — the create is never rolled back", async () => {
    replies["/agents/ag-1/skills"] = {
      status: 500,
      body: { error: { code: "internal", message: "boom" } },
    };
    const { onClose } = renderModal();
    await screen.findByRole("option", { name: "Reviewer" });
    fireEvent.change(selects()[1]!, { target: { value: "ag-1" } });
    fireEvent.click(submit());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith(
      "The skill was saved, but linking it to the agent failed. Link it from the Skills Lab.",
    );
    expect(toast.success).toHaveBeenCalledWith("Skill created.");
    expect(nav.push).toHaveBeenCalledWith("/skills?skill=sk-77&tab=config");
    expect(writes().map((c) => c.path)).toEqual(["/skills/extracted", "/agents/ag-1/skills"]);
  });

  it("a failed create keeps the modal open, reports it, and never attempts the link", async () => {
    replies["/skills/extracted"] = {
      status: 400,
      body: { error: { code: "bad_request", message: "duplicate name" } },
    };
    const { onClose } = renderModal();
    await screen.findByRole("option", { name: "Reviewer" });
    fireEvent.change(selects()[1]!, { target: { value: "ag-1" } });
    fireEvent.click(submit());

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not create the skill."));
    expect(onClose).not.toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalled();
    expect(writes().map((c) => c.path)).toEqual(["/skills/extracted"]);
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });
});
