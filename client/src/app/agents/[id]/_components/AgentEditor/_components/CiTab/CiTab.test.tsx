/* CiTab.test.tsx — T13 (AC-32..AC-37, AC-45, AC-48, NFR-7). Real `messages/en`; a missing
   key throws through `onError`. `fetch` is mocked; the wizard is a stub that echoes its props. */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent } from "@devdigest/shared";
import ci from "../../../../../../../../messages/en/ci.json";
import agents from "../../../../../../../../messages/en/agents.json";

vi.mock("./ExportWizard", () => ({
  ExportWizard: (p: { mode: string; installedRepos: string[]; onClose: () => void }) => (
    <div data-testid="wizard">
      {p.mode}:{p.installedRepos.join(",")}
    </div>
  ),
}));

import { CiTab } from "./CiTab";

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

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const inst = (over: Record<string, unknown>) => ({
  id: "i",
  agent_id: "a1",
  repo: "acme/x",
  target_type: "gha",
  installed_at: ago(100),
  status: "manual",
  installed_agent_version: 3,
  pr_url: null,
  triggers: ["opened", "synchronize"],
  post_as: "github_review",
  last_run: null,
  ...over,
});
const run = (over: Record<string, unknown>) => ({
  id: "r",
  repo: "acme/payments-api",
  pr_number: 7,
  pr_url: "https://github.com/acme/payments-api/pull/7",
  agent_id: "a1",
  agent_name: "Security Reviewer",
  verdict: "passed",
  findings_count: 2,
  cost_usd: 0.01,
  duration_ms: 4200,
  github_url: "https://github.com/acme/payments-api/actions/runs/1",
  ran_at: ago(4),
  ...over,
});

let calls: { method: string; path: string; body: unknown }[];
let data: unknown;
let refreshResult: unknown;
let agentFails: boolean;

beforeEach(() => {
  calls = [];
  agentFails = false;
  refreshResult = { stored: 0, skipped: 0, degraded: [] };
  data = {
    installations: [
      inst({ id: "i1", repo: "acme/payments-api", status: "active", installed_agent_version: 3, last_run: { verdict: "blocked", ran_at: ago(4) } }),
      inst({ id: "i2", repo: "acme/billing", status: "pr_open", pr_url: "https://github.com/acme/billing/pull/9" }),
      inst({ id: "i3", repo: "acme/worker", status: "manual" }),
    ],
    runs: [run({ id: "r1" }), run({ id: "r2", repo: "acme/billing", verdict: "failed", duration_ms: null })],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      const method = init?.method ?? "GET";
      calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const ok = (b: unknown) => ({ ok: true, status: 200, json: async () => b }) as Response;
      if (path === "/ci/refresh") return ok(refreshResult);
      if (path === "/agents/a1/ci") {
        if (agentFails)
          return { ok: false, status: 500, statusText: "x", json: async () => ({ error: { code: "e", message: "CI exploded" } }) } as Response;
        return ok(data);
      }
      return ok({ ...AGENT, version: 4 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderTab(agent: Agent = AGENT) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ ci, agents }}
      onError={(e) => {
        throw e;
      }}
    >
      <QueryClientProvider client={qc}>
        <CiTab agent={agent} />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

describe("CiTab", () => {
  it("AC-32: shows the heading, the active badge, both buttons and the Add repository row", async () => {
    renderTab();
    expect(await screen.findByText("CI deployment")).toBeInTheDocument();
    expect(await screen.findByText("Active in 1 repos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Update CI config/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^Add to CI/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add repository/ })).toBeInTheDocument();
  });

  it("AC-32: hides the badge when no installation is active", async () => {
    data = { installations: [inst({ id: "i3", repo: "acme/worker" })], runs: [] };
    renderTab();
    await screen.findByText("acme/worker");
    expect(screen.queryByText(/Active in/)).toBeNull();
  });

  it("AC-33: each row shows repo, chip, version and verdict / PR open link / Manual install", async () => {
    renderTab();
    const rows = await screen.findAllByTestId("ci-installation");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText("acme/payments-api")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("GitHub Actions")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("v3")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Blocked")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("4m ago")).toBeInTheDocument();
    const pr = within(rows[1]!).getByRole("link", { name: "PR open" });
    expect(pr).toHaveAttribute("href", "https://github.com/acme/billing/pull/9");
    expect(within(rows[2]!).getByText("Manual install")).toBeInTheDocument();
  });

  it("AC-34: Update CI config opens the wizard limited to the installed repositories", async () => {
    renderTab();
    await screen.findAllByTestId("ci-installation");
    fireEvent.click(screen.getByRole("button", { name: /Update CI config/ }));
    expect(screen.getByTestId("wizard")).toHaveTextContent("update:acme/payments-api,acme/billing,acme/worker");
  });

  it("AC-34: Update CI config is disabled without an installation", async () => {
    data = { installations: [], runs: [] };
    renderTab();
    await screen.findByText("CI deployment");
    await waitFor(() => expect(screen.getByRole("button", { name: /Update CI config/ })).toBeDisabled());
  });

  it("AC-38: Add to CI and Add repository open the wizard in add mode", async () => {
    renderTab();
    await screen.findAllByTestId("ci-installation");
    fireEvent.click(screen.getByRole("button", { name: /^Add to CI/ }));
    expect(screen.getByTestId("wizard")).toHaveTextContent(/^add:/);
    cleanup();
    renderTab();
    await screen.findAllByTestId("ci-installation");
    fireEvent.click(screen.getByRole("button", { name: /Add repository/ }));
    expect(screen.getByTestId("wizard")).toHaveTextContent(/^add:/);
  });

  it("AC-35: Fail CI on saves ci_fail_on through PUT /agents/:id", async () => {
    renderTab();
    await screen.findAllByTestId("ci-installation");
    expect(screen.getByText("Fail CI on")).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("Block on critical (recommended)"), { target: { value: "warning" } });
    await waitFor(() =>
      expect(calls).toContainEqual({ method: "PUT", path: "/agents/a1", body: { ci_fail_on: "warning" } }),
    );
  });

  it("AC-35: Fail CI on offers exactly never, critical, warning and any, and each choice is saved", async () => {
    renderTab();
    await screen.findAllByTestId("ci-installation");
    const select = screen.getByDisplayValue("Block on critical (recommended)");
    expect(within(select).getAllByRole("option").map((o) => (o as HTMLOptionElement).value)).toEqual([
      "never",
      "critical",
      "warning",
      "any",
    ]);
    cleanup();
    for (const value of ["never", "critical", "warning", "any"] as const) {
      calls = [];
      // start from a different value so the change event always fires
      renderTab({ ...AGENT, ci_fail_on: value === "never" ? "any" : "never" });
      await screen.findAllByTestId("ci-installation");
      const sel = document.querySelector("select") as HTMLSelectElement;
      fireEvent.change(sel, { target: { value } });
      await waitFor(() =>
        expect(calls).toContainEqual({ method: "PUT", path: "/agents/a1", body: { ci_fail_on: value } }),
      );
      cleanup();
    }
  });

  it("AC-36: lists the agent's runs and links All runs to /ci-runs", async () => {
    renderTab();
    await screen.findAllByTestId("ci-installation");
    expect(screen.getAllByTestId("ci-run-row")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "All runs" })).toHaveAttribute("href", "/ci-runs");
  });

  it("AC-37: a failed request shows the error text and Retry reloads", async () => {
    agentFails = true;
    renderTab();
    expect(await screen.findByText("CI exploded")).toBeInTheDocument();
    agentFails = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findAllByTestId("ci-installation")).toHaveLength(3);
  });

  it("AC-45: requests a refresh on open, then reloads the data", async () => {
    renderTab();
    await waitFor(() => expect(calls.filter((c) => c.path === "/agents/a1/ci")).toHaveLength(2));
    const refreshAt = calls.findIndex((c) => c.path === "/ci/refresh");
    expect(refreshAt).toBeGreaterThanOrEqual(0);
    const lastGet = calls.map((c) => c.path).lastIndexOf("/agents/a1/ci");
    expect(lastGet).toBeGreaterThan(refreshAt);
  });

  it("AC-48: a degraded refresh shows a notice and keeps the stored data", async () => {
    refreshResult = { stored: 0, skipped: 0, degraded: [{ repo: "acme/billing", reason: "github_error" }] };
    renderTab();
    expect(await screen.findByText(/github_error/)).toBeInTheDocument();
    expect(screen.getAllByTestId("ci-installation")).toHaveLength(3);
  });
});
