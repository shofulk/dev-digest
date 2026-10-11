import React from "react";
import { vi } from "vitest";
import { act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, PrMeta, RunEstimate } from "@devdigest/shared";
import { Providers } from "@/lib/providers";
import common from "../../messages/en/common.json";
import multiAgent from "../../messages/en/multiAgent.json";
import prReview from "../../messages/en/prReview.json";
import runs from "../../messages/en/runs.json";
import shell from "../../messages/en/shell.json";

/**
 * Wraps a multi-agent component in the real client provider stack (React Query with the
 * global MutationCache toast, theme, toasts, repo context) and the real `en` messages of
 * every namespace the picker, Configure run and finding card translate against.
 */
export function MultiAgentTestProviders({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <NextIntlClientProvider locale="en" messages={{ common, multiAgent, prReview, runs, shell }}>
        {children}
      </NextIntlClientProvider>
    </Providers>
  );
}

/* ---- fixtures ---- */

export function agent(over: Partial<Agent> & Pick<Agent, "id" | "name">): Agent {
  return {
    description: `${over.name} reviewer`,
    provider: "openai",
    model: "gpt-4.1",
    system_prompt: "p",
    enabled: true,
    version: 1,
    strategy: "single-pass",
    ci_fail_on: "critical",
    repo_intel: true,
    ...over,
  } as Agent;
}

export function pull(over: Partial<PrMeta> & Pick<PrMeta, "number" | "title">): PrMeta {
  return {
    id: `pr${over.number}`,
    author: "dev",
    branch: "feat",
    base: "main",
    head_sha: "abc123",
    additions: 1,
    deletions: 1,
    files_count: 1,
    status: "needs_review",
    ...over,
  } as PrMeta;
}

export function estimate(agent_id: string, ms: number | null, cost: number | null, n = 3): RunEstimate {
  return { agent_id, median_duration_ms: ms, median_cost_usd: cost, sample_size: n };
}

/* ---- fetch double ---- */

export type Reply = { status: number; body: unknown };
export type FetchCall = { method: string; path: string; body: unknown };

/**
 * Stubs global `fetch`. `routes` is keyed `"<METHOD> <pathname>"`; an unlisted route answers 404.
 * Returns the recorded calls so a test can assert on method, path and JSON body.
 */
export function installFetch(routes: Record<string, Reply>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const method = init?.method ?? "GET";
    const r = routes[`${method} ${path}`] ?? { status: 404, body: { error: { message: "not found" } } };
    return {
      ok: r.status < 400,
      status: r.status,
      statusText: "",
      json: async () => r.body,
    } as Response;
  });
  vi.stubGlobal("fetch", fn);
  const calls = (): FetchCall[] =>
    fn.mock.calls.map(([url, init]) => ({
      method: init?.method ?? "GET",
      path: new URL(url).pathname,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    }));
  /** Resolves once every request fired so far has been answered and React Query has applied it. */
  const settled = async () => {
    // A response can enable a dependent query, so loop until no new request appeared.
    let seen = -1;
    while (seen !== fn.mock.results.length) {
      seen = fn.mock.results.length;
      await Promise.all(fn.mock.results.map((r) => r.value));
      // React Query notifies observers through a zero-delay timer, then React re-renders:
      // yield to the event loop a few times so both have run.
      for (let i = 0; i < 3; i++) {
        await act(async () => {
          await new Promise<void>((r) => setTimeout(r, 0));
        });
      }
    }
  };
  return { fn, calls, settled };
}
