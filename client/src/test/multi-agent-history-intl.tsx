import React from "react";
import { vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import type { MultiAgentRunSummary } from "@devdigest/shared";
import { Providers } from "@/lib/providers";
import common from "../../messages/en/common.json";
import multiAgent from "../../messages/en/multiAgent.json";
import prReview from "../../messages/en/prReview.json";
import runs from "../../messages/en/runs.json";
import shell from "../../messages/en/shell.json";

/** The fixed "now" every relative time in the history tests is measured against (plan R17). */
export const NOW = new Date("2026-10-12T10:05:00Z");

/**
 * The real client provider stack (React Query with the global query/mutation toast, theme,
 * toast host, repo context) plus the real `en` messages, with an explicit time zone and `now`
 * so relative times and the hover date are deterministic (no next-intl ENVIRONMENT_FALLBACK).
 */
export function HistoryTestProviders({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        now={NOW}
        messages={{ common, multiAgent, prReview, runs, shell }}
      >
        {children}
      </NextIntlClientProvider>
    </Providers>
  );
}

/** One row of GET /repos/:id/multi-agent-runs. */
export function runSummary(over: Partial<MultiAgentRunSummary> & Pick<MultiAgentRunSummary, "id">): MultiAgentRunSummary {
  return {
    pr_id: "pr7",
    pr_number: 482,
    pr_title: "Harden the auth middleware",
    ran_at: "2026-10-12T10:00:00Z",
    agent_count: 4,
    status: "done",
    total_duration_ms: 12_000,
    total_cost_usd: 0.0123,
    ...over,
  };
}

/* ---- fetch double ---- */

export type Reply = { status: number; body: unknown };
/** A reply, or a function read at call time (may be async, so a test can hold a request pending). */
export type Route = Reply | (() => Reply | Promise<Reply>);

/**
 * Stubs global `fetch`. `routes` is keyed `"<METHOD> <pathname>"` and read on every call, so a
 * test may reassign a route mid-flow. An unlisted route answers 404. `paths()` lists the
 * `"<METHOD> <pathname>?<search>"` of every request fired.
 */
export function installHistoryFetch(routes: Record<string, Route>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const route = routes[`${init?.method ?? "GET"} ${u.pathname}`];
    const r: Reply = route
      ? typeof route === "function"
        ? await route()
        : route
      : { status: 404, body: { error: { message: "not found" } } };
    return { ok: r.status < 400, status: r.status, statusText: "", json: async () => r.body } as Response;
  });
  vi.stubGlobal("fetch", fn);
  const paths = () =>
    fn.mock.calls.map(([url, init]) => {
      const u = new URL(url);
      return `${init?.method ?? "GET"} ${u.pathname}${u.search}`;
    });
  return { fn, paths };
}
