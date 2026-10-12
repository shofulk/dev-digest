/* ExportWizard.test.tsx — T15 (AC-34, AC-38..AC-44). Real `messages/en`; `fetch` is mocked. */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent } from "@devdigest/shared";
import ci from "../../../../../../../../../messages/en/ci.json";

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ repoId: "r1", activeRepo: null, repos: [], setRepoId: () => {}, reposLoaded: true }),
}));

import { ExportWizard } from "./ExportWizard";

const AGENT: Agent = {
  id: "a1",
  name: "Security Reviewer",
  description: "",
  provider: "openrouter",
  model: "m",
  system_prompt: "p",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 3,
};

const WF_PATH = ".github/workflows/devdigest-review.yml";
const workflow = (types: string[]) =>
  `name: DevDigest review\non:\n  pull_request:\n    types: [${types.join(", ")}]\njobs:\n  review:\n    runs-on: ubuntu-latest\n`;

interface Call {
  method: string;
  path: string;
  body: any;
}
let calls: Call[];
let exportResponse: () => Response;

const json = (status: number, b: unknown) =>
  ({ ok: status < 400, status, statusText: "x", json: async () => b }) as Response;

beforeEach(() => {
  calls = [];
  exportResponse = () => json(200, { installation: {}, files: [], pr_url: "https://github.com/acme/payments-api/pull/5" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method: init?.method ?? "GET", path, body });
      if (path === "/repos")
        return json(200, [
          { id: "r1", full_name: "acme/payments-api", default_branch: "main" },
          { id: "r2", full_name: "acme/billing", default_branch: "main" },
        ]);
      if (path === "/agents/a1/ci/preview") {
        const wf = workflow(body.triggers);
        return json(200, {
          files: [
            { path: ".devdigest/agents/security-reviewer-a1.yaml", contents: "name: Security Reviewer\n", editable: false, size_bytes: 24 },
            { path: ".devdigest/runner/index.js", contents: null, editable: false, size_bytes: 1234 },
            { path: WF_PATH, contents: wf, editable: true, size_bytes: wf.length },
          ],
        });
      }
      if (path === "/agents/a1/export-ci") return exportResponse();
      return json(200, {});
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderWizard(props: Partial<{ mode: "add" | "update"; installedRepos: string[] }> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  render(
    <NextIntlClientProvider
      locale="en"
      messages={{ ci }}
      onError={(e) => {
        throw e;
      }}
    >
      <QueryClientProvider client={qc}>
        <ExportWizard agent={AGENT} mode={props.mode ?? "add"} installedRepos={props.installedRepos ?? []} onClose={onClose} />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
  return { onClose };
}

const next = () => fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
const exportCall = () => calls.find((c) => c.path === "/agents/a1/export-ci");

async function toInstall() {
  await screen.findByDisplayValue("acme/payments-api");
  next();
  await screen.findByRole("button", { name: /index\.js/ });
  next();
  next();
}

describe("ExportWizard", () => {
  it("AC-38: starts at Target with only the GitHub Actions card and the repo select preselected", async () => {
    renderWizard();
    expect(await screen.findByDisplayValue("acme/payments-api")).toBeInTheDocument();
    expect(screen.getByText("GitHub Actions")).toBeInTheDocument();
    expect(screen.queryByText("CircleCI")).toBeNull();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["acme/payments-api", "acme/billing"]);
    for (const label of ["Target", "Preview", "Configure", "Install"]) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect(screen.getByRole("radio", { name: /GitHub Actions/ })).toHaveAttribute("aria-checked", "true");
  });

  it("AC-34: update mode lists only repositories with an installation", async () => {
    renderWizard({ mode: "update", installedRepos: ["acme/billing"] });
    expect(await screen.findByDisplayValue("acme/billing")).toBeInTheDocument();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["acme/billing"]);
  });

  it("AC-39: Preview lists the files, shows the selected text, only the workflow is editable", async () => {
    renderWizard();
    await screen.findByDisplayValue("acme/payments-api");
    next();
    const wfButton = await screen.findByRole("button", { name: new RegExp(WF_PATH.replace(/\./g, "\\.")) });
    expect(screen.getByRole("button", { name: /security-reviewer-a1\.yaml/ })).toBeInTheDocument();
    fireEvent.click(wfButton);
    expect(screen.getByLabelText("Workflow")).toHaveValue(workflow(["opened", "synchronize"]));
    fireEvent.click(screen.getByRole("button", { name: /security-reviewer-a1\.yaml/ }));
    expect(screen.queryByLabelText("Workflow")).toBeNull();
    expect(screen.getByText(/name: Security Reviewer/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /runner\/index\.js/ }));
    expect(screen.getByText(/1234 bytes/)).toBeInTheDocument();
  });

  it("AC-40: Configure preselects triggers, gates Continue, offers Post results as and the secrets hint", async () => {
    renderWizard();
    await screen.findByDisplayValue("acme/payments-api");
    next();
    await screen.findByRole("button", { name: /index\.js/ });
    next();
    expect(screen.getByLabelText("opened")).toBeChecked();
    expect(screen.getByLabelText("synchronize")).toBeChecked();
    expect(screen.getByLabelText("reopened")).not.toBeChecked();
    expect(screen.getByLabelText("GitHub review")).toBeChecked();
    expect(screen.getByLabelText("PR comment")).not.toBeChecked();
    expect(screen.getByLabelText("None (exit code only)")).toBeInTheDocument();
    expect(screen.getByText(/OPENROUTER_API_KEY.*GITHUB_TOKEN is provided by Actions/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("opened"));
    fireEvent.click(screen.getByLabelText("synchronize"));
    expect(screen.getByRole("button", { name: /Continue/ })).toBeDisabled();
  });

  it("AC-41: changing triggers after an edit replaces only the types list", async () => {
    renderWizard();
    await screen.findByDisplayValue("acme/payments-api");
    next();
    await screen.findByRole("button", { name: /index\.js/ });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(WF_PATH.replace(/\./g, "\\.")) }));
    const edited = workflow(["opened", "synchronize"]).replace("ubuntu-latest", "ubuntu-latest # my edit");
    fireEvent.change(screen.getByLabelText("Workflow"), { target: { value: edited } });
    next();
    fireEvent.click(screen.getByLabelText("reopened"));
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    const area = (await screen.findByLabelText("Workflow")) as HTMLTextAreaElement;
    expect(area.value).toBe(edited.replace("[opened, synchronize]", "[opened, synchronize, reopened]"));
  });

  it("AC-42: Install opens a PR (preselected), shows the link and sends no workflow when unedited", async () => {
    renderWizard();
    await toInstall();
    expect(screen.getByLabelText("Open a PR with these files")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: /^Install/ }));
    const link = await screen.findByRole("link", { name: /pull request/i });
    expect(link).toHaveAttribute("href", "https://github.com/acme/payments-api/pull/5");
    expect(exportCall()!.body).toMatchObject({ repo: "acme/payments-api", action: "open_pr", post_as: "github_review", triggers: ["opened", "synchronize"] });
    expect(exportCall()!.body.workflow).toBeUndefined();
  });

  it("AC-43: the zip option downloads devdigest-ci-<owner>-<name>.zip and sends action files", async () => {
    const files = [{ path: WF_PATH, contents: workflow(["opened"]), editable: true, size_bytes: 1 }];
    exportResponse = () => json(200, { installation: {}, files, pr_url: null });
    const create = vi.fn((_blob: Blob) => "blob:x");
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
    let name = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      name = this.download;
    });
    renderWizard();
    await toInstall();
    fireEvent.click(screen.getByLabelText("Copy files as a zip"));
    fireEvent.click(screen.getByRole("button", { name: /^Install/ }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![0]).toBeInstanceOf(Blob);
    expect(name).toBe("devdigest-ci-acme-payments-api.zip");
    expect(exportCall()!.body.action).toBe("files");
  });

  it("AC-44: an invalid workflow keeps the wizard on Install with the line and every choice", async () => {
    exportResponse = () => json(422, { error: { code: "invalid_workflow", message: "Workflow is not valid YAML", details: { line: 4 } } });
    renderWizard();
    await screen.findByDisplayValue("acme/payments-api");
    next();
    await screen.findByRole("button", { name: /index\.js/ });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(WF_PATH.replace(/\./g, "\\.")) }));
    fireEvent.change(screen.getByLabelText("Workflow"), { target: { value: "edited: [" } });
    next();
    fireEvent.click(screen.getByLabelText("PR comment"));
    next();
    fireEvent.click(screen.getByLabelText("Copy files as a zip"));
    fireEvent.click(screen.getByRole("button", { name: /^Install/ }));
    expect(await screen.findByText(/Workflow is not valid YAML/)).toBeInTheDocument();
    expect(screen.getByText(/Line 4/)).toBeInTheDocument();
    expect(screen.getByLabelText("Copy files as a zip")).toBeChecked();
    expect(screen.getByRole("button", { name: /^Install/ })).toBeInTheDocument();
    expect(exportCall()!.body).toMatchObject({ workflow: "edited: [", post_as: "pr_comment", action: "files" });
  });

  it("AC-44: after a failed export every choice survives going back through the steps", async () => {
    exportResponse = () => json(422, { error: { code: "invalid_workflow", message: "Workflow is not valid YAML", details: { line: 4 } } });
    renderWizard();
    await screen.findByDisplayValue("acme/payments-api");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "r2" } });
    next();
    await screen.findByRole("button", { name: /index\.js/ });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(WF_PATH.replace(/\./g, "\\.")) }));
    fireEvent.change(screen.getByLabelText("Workflow"), { target: { value: "edited: [" } });
    next();
    fireEvent.click(screen.getByLabelText("reopened"));
    fireEvent.click(screen.getByLabelText("PR comment"));
    next();
    fireEvent.click(screen.getByLabelText("Copy files as a zip"));
    fireEvent.click(screen.getByRole("button", { name: /^Install/ }));
    await screen.findByText(/Workflow is not valid YAML/);
    const first = exportCall()!.body;
    calls = [];

    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByLabelText("reopened")).toBeChecked();
    expect(screen.getByLabelText("PR comment")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect((screen.getByLabelText("Workflow") as HTMLTextAreaElement).value).toContain("edited: [");
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByDisplayValue("acme/billing")).toBeInTheDocument();
    next();
    next();
    next();
    expect(screen.getByLabelText("Copy files as a zip")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: /^Install/ }));
    await waitFor(() => expect(exportCall()).toBeDefined());
    expect(exportCall()!.body).toEqual(first);
    expect(first).toMatchObject({ repo: "acme/billing", post_as: "pr_comment", action: "files" });
    expect(first.triggers).toContain("reopened");
  });

  it("NFR-7: the workflow textarea is found by its translated label", async () => {
    renderWizard();
    await screen.findByDisplayValue("acme/payments-api");
    next();
    await screen.findByRole("button", { name: /index\.js/ });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(WF_PATH.replace(/\./g, "\\.")) }));
    expect(screen.getByLabelText(ci.exportWizard.workflowLabel)).toBeInstanceOf(HTMLTextAreaElement);
  });

  it("AC-44: a permission error lists the permissions", async () => {
    exportResponse = () => json(403, { error: { code: "github_permission", message: "GitHub refused access", details: { permissions: ["contents:write", "pull_requests:write"] } } });
    renderWizard();
    await toInstall();
    fireEvent.click(screen.getByRole("button", { name: /^Install/ }));
    expect(await screen.findByText(/GitHub refused access/)).toBeInTheDocument();
    expect(screen.getByText(/contents:write, pull_requests:write/)).toBeInTheDocument();
  });
});
