/* ContextTab.test.tsx — T12 (after, L10). The skill Context tab: title "Project context
   to use" (AC-18), "N attached" and the inheritance note, the shared picker, and the
   "Serializes as" preview with the `## Project context` heading and total tokens (AC-19).
   The save sends the skill PUT (AC-14). `@/lib/repo-context` is mocked; `fetch` is mocked
   (the one real boundary the save hook and `useContextDocs` reach), following
   `context.test.ts`'s convention. */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Skill } from "@devdigest/shared";
import context from "../../../../../../../../../messages/en/context.json"; // client/messages/en/context.json
import skills from "../../../../../../../../../messages/en/skills.json"; // client/messages/en/skills.json

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

const SKILL: Skill = {
  id: "s1",
  name: "no-over-mocking",
  description: "",
  type: "rubric",
  source: "manual",
  body: "",
  enabled: true,
  version: 2,
  evidence_files: null,
  created_at: "2026-01-01T00:00:00Z",
  tokens: 3,
  context_docs: ["docs/architecture.md"],
};

function renderTab(skill: Skill = SKILL) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ context, skills }}>
        <ContextTab skill={skill} />
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

describe("skill ContextTab", () => {
  it("AC-18: shows the title, the attached count and the inheritance note", async () => {
    renderTab();
    expect(screen.getByRole("heading", { name: "Project context to use" })).toBeInTheDocument();
    expect(screen.getByText("1 attached")).toBeInTheDocument();
    expect(screen.getByText("Any agent using this skill inherits these documents.")).toBeInTheDocument();
    await screen.findByText("1 of 2 attached"); // the shared picker also renders, same data
  });

  it("AC-19: 'Serializes as' shows the heading, the attached paths in order and the total tokens", async () => {
    renderTab({ ...SKILL, context_docs: ["specs/rate-limiting.spec.md", "docs/architecture.md"] });
    await screen.findByText("2 of 2 attached");

    expect(screen.getByRole("heading", { name: "Serializes as" })).toBeInTheDocument();
    const pre = document.querySelector("pre.mono")!;
    expect(pre.textContent).toBe(
      ["## Project context", "- specs/rate-limiting.spec.md", "- docs/architecture.md"].join("\n"),
    );
    // the picker's own tokens note and the tab's "Serializes as" tokens note agree.
    expect(screen.getAllByText("≈ 30 tokens")).toHaveLength(2);
  });

  it("AC-14: checking a document sends the skill's PUT with the full ordered list, no Save button", async () => {
    renderTab();
    await screen.findByText("1 of 2 attached");
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("rate-limiting.spec.md").closest("li")!.querySelector("[role='checkbox']")!);

    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "PUT",
        path: "/skills/s1/context-docs",
        body: { context_docs: ["docs/architecture.md", "specs/rate-limiting.spec.md"] },
      }),
    );
  });

  it("AC-16: a failed save still sends the PUT and surfaces the API error message as a toast", async () => {
    installFetch((c) => {
      if (c.method === "PUT" && c.path === "/skills/s1/context-docs") {
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
      expect(calls).toContainEqual({ method: "PUT", path: "/skills/s1/context-docs", body: { context_docs: [] } }),
    );
    await waitFor(() => expect(toast.toast).toHaveBeenCalledWith("invalid path", "error"));
  });
});
