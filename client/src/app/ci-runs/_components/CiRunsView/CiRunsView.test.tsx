/* CiRunsView.test.tsx — T16 (AC-45, AC-47, AC-48). Real `messages/en`; `fetch` is mocked. */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ci from "../../../../../messages/en/ci.json";

vi.mock("../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { CiRunsView } from "./CiRunsView";

const RUN = {
  id: "r1",
  repo: "acme/payments-api",
  pr_number: 7,
  pr_url: "https://github.com/acme/payments-api/pull/7",
  agent_id: "a1",
  agent_name: "Security Reviewer",
  verdict: "blocked",
  findings_count: 3,
  cost_usd: 0.0123,
  duration_ms: 4200,
  github_url: "https://github.com/acme/payments-api/actions/runs/1",
  ran_at: new Date().toISOString(),
};

let paths: string[];
let items: unknown[];
let refreshResult: unknown;

beforeEach(() => {
  paths = [];
  items = [RUN];
  refreshResult = { stored: 0, skipped: 0, degraded: [] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      paths.push(`${init?.method ?? "GET"} ${path}`);
      const body = path === "/ci/refresh" ? refreshResult : { items };
      return { ok: true, status: 200, json: async () => body } as Response;
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <NextIntlClientProvider
      locale="en"
      messages={{ ci }}
      onError={(e) => {
        throw e;
      }}
    >
      <QueryClientProvider client={qc}>
        <CiRunsView />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

const gets = () => paths.filter((p) => p === "GET /ci/runs").length;

describe("CiRunsView", () => {
  it("AC-45: refreshes on open and on the Refresh button, reloading the list each time", async () => {
    renderView();
    await waitFor(() => expect(gets()).toBe(2));
    expect(paths.indexOf("POST /ci/refresh")).toBeLessThan(paths.lastIndexOf("GET /ci/runs"));
    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    await waitFor(() => expect(gets()).toBe(3));
    expect(paths.filter((p) => p === "POST /ci/refresh")).toHaveLength(2);
  });

  it("AC-47: shows the table columns, the GitHub links and View job", async () => {
    renderView();
    const row = await screen.findByTestId("ci-run-row");
    for (const h of ["Repository", "Pull request", "Agent", "Verdict", "Findings", "Cost", "Duration"])
      expect(screen.getByRole("columnheader", { name: h })).toBeInTheDocument();
    expect(within(row).getByText("acme/payments-api")).toBeInTheDocument();
    const pr = within(row).getByRole("link", { name: "#7" });
    expect(pr).toHaveAttribute("href", "https://github.com/acme/payments-api/pull/7");
    expect(pr).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(row).getByText("Security Reviewer")).toBeInTheDocument();
    expect(within(row).getByText("Blocked")).toBeInTheDocument();
    expect(within(row).getByText("3")).toBeInTheDocument();
    expect(within(row).getByText("$0.012")).toBeInTheDocument();
    expect(within(row).getByText("4.2s")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "View job" })).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/actions/runs/1",
    );
  });

  it("AC-47: links only to github.com", async () => {
    items = [{ ...RUN, pr_url: "javascript:alert(1)", github_url: "https://evil.example/x" }];
    renderView();
    const row = await screen.findByTestId("ci-run-row");
    expect(within(row).queryByRole("link")).toBeNull();
  });

  it("AC-47: shows No CI runs yet when the list is empty", async () => {
    items = [];
    renderView();
    expect(await screen.findByText("No CI runs yet")).toBeInTheDocument();
  });

  it("AC-48: a degraded refresh shows the reason and keeps the stored rows", async () => {
    refreshResult = { stored: 0, skipped: 0, degraded: [{ repo: "acme/payments-api", reason: "github_not_configured" }] };
    renderView();
    expect(await screen.findByText(/github_not_configured/)).toBeInTheDocument();
    expect(screen.getByTestId("ci-run-row")).toBeInTheDocument();
  });
});
