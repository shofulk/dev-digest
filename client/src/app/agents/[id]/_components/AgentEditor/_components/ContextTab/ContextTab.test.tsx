/* ContextTab.test.tsx — T11 (after, L10). The agent Context tab is wiring: it reads
   `agent.context_docs` and the active repo, mounts the shared ContextDocPicker, and
   autosaves every attach/detach/reorder through `useSetAgentContextDocs` (AC-10, AC-11,
   AC-12, AC-14) with no Save button. `@/lib/repo-context` is mocked (the active repo);
   `fetch` is mocked (the one real boundary this tab's save hook reaches), following
   `context.test.ts`'s convention for the save hooks. */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent } from "@devdigest/shared";
import context from "../../../../../../../../messages/en/context.json"; // client/messages/en/context.json

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    repoId: "r1",
    activeRepo: { id: "r1", full_name: "acme/payments-api", default_branch: "main" },
    repos: [],
    setRepoId: () => {},
    reposLoaded: true,
  }),
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/toast", () => ({ notify: toast }));

import { ContextTab } from "./ContextTab";

interface Call {
  method: string;
  path: string;
  body: unknown;
}
let calls: Call[];

function installFetch(onCall?: (c: Call) => Response | null) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      const call: Call = { method, path, body };
      calls.push(call);
      const custom = onCall?.(call);
      if (custom) return custom;
      if (path === "/repos/r1/context") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            files: [
              { path: "docs/architecture.md", type: "docs", tokens: 10, used_by: 1 },
              { path: "specs/rate-limiting.spec.md", type: "specs", tokens: 20, used_by: 0 },
            ],
            roots: ["**/{specs,docs,insights}/**/*.md"],
            count: 2,
            total_tokens: 30,
            scanned_at: "2026-10-03T12:00:00Z",
            truncated: false,
          }),
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }),
  );
}

const AGENT: Agent = {
  id: "a1",
  name: "Security Reviewer",
  description: "",
  provider: "openrouter",
  model: "m",
  system_prompt: "p",
  output_schema: null,
  enabled: true,
  version: 3,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  context_docs: ["docs/architecture.md"],
};

function renderTab(agent: Agent = AGENT) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ context }}>
        <ContextTab agent={agent} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => installFetch());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("agent ContextTab", () => {
  it("AC-10, AC-11, AC-12: wires the picker to the current repo's documents and the agent's saved attachments", async () => {
    renderTab();
    await screen.findByText("1 of 2 attached");
    expect(screen.getByText("≈ 10 tokens")).toBeInTheDocument();
    const row = screen.getByText("architecture.md").closest("li")!;
    expect(within(row).getByRole("checkbox")).toBeChecked();
  });

  it("AC-14: checking a new document sends the agent's PUT with the full ordered list, no Save button", async () => {
    renderTab();
    await screen.findByText("1 of 2 attached");
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("rate-limiting.spec.md").closest("li")!.querySelector("[role='checkbox']")!);

    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "PUT",
        path: "/agents/a1/context-docs",
        body: { context_docs: ["docs/architecture.md", "specs/rate-limiting.spec.md"] },
      }),
    );
  });

  it("AC-16: a failed save still sends the PUT and surfaces the API error message as a toast", async () => {
    installFetch((c) => {
      if (c.method === "PUT" && c.path === "/agents/a1/context-docs") {
        return {
          ok: false,
          status: 400,
          statusText: "Bad Request",
          json: async () => ({ error: { message: "invalid path" } }),
        } as Response;
      }
      return null;
    });
    renderTab();
    await screen.findByText("1 of 2 attached");

    fireEvent.click(screen.getByText("architecture.md").closest("li")!.querySelector("[role='checkbox']")!);

    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "PUT",
        path: "/agents/a1/context-docs",
        body: { context_docs: [] },
      }),
    );
    await waitFor(() => expect(toast.toast).toHaveBeenCalledWith("invalid path", "error"));
  });
});
