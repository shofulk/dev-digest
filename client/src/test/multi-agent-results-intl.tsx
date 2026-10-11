import React from "react";
import { vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  AgentColumn,
  AgentColumnFinding,
  Conflict,
  FindingRecord,
  MultiAgentRun,
  ReviewRecord,
} from "@devdigest/shared";
import { configure } from "@testing-library/react";
import common from "../../messages/en/common.json";
import multiAgentResults from "../../messages/en/multiAgentResults.json";
import prReview from "../../messages/en/prReview.json";
import runs from "../../messages/en/runs.json";
import { ToastProvider, notify } from "@/lib/toast";

/* The results page is large: keep a failed query's message short instead of dumping the DOM. */
configure({ getElementError: (message) => new Error((message ?? "element not found").slice(0, 400)) });

/**
 * Wraps the multi-agent results page (or one of its views) in a fresh QueryClient that
 * toasts mutation errors the way the app's global MutationCache does, the toast host, and
 * the real `en` messages of every namespace the page, the finding card and the trace
 * drawer translate against.
 */
export function ResultsTestProviders({ children }: { children: React.ReactNode }) {
  const [qc] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false } },
        mutationCache: new MutationCache({
          onError: (err) => notify.error(err instanceof Error ? err.message : "Something went wrong"),
        }),
      }),
  );
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <NextIntlClientProvider locale="en" messages={{ common, multiAgentResults, prReview, runs }}>
          {children}
        </NextIntlClientProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

/* ---- fixtures ---- */

export function colFinding(over: Partial<AgentColumnFinding> & Pick<AgentColumnFinding, "id">): AgentColumnFinding {
  return {
    severity: "WARNING",
    category: "security",
    title: `Finding ${over.id}`,
    file: "src/a.ts",
    start_line: 10,
    ...over,
  } as AgentColumnFinding;
}

export function column(over: Partial<AgentColumn> & Pick<AgentColumn, "agent_id">): AgentColumn {
  return {
    run_id: `run-${over.agent_id}`,
    agent_name: `Agent ${over.agent_id}`,
    provider: "openai",
    model: "gpt-4.1",
    status: "done",
    verdict: "comment",
    score: 80,
    summary: null,
    duration_ms: 12000,
    cost_usd: 0.0123,
    error: null,
    findings: [],
    ...over,
  };
}

export function conflict(over: Partial<Conflict> = {}): Conflict {
  return { file: "src/a.ts", line: 10, title: "Unsanitised input", takes: [], is_conflict: true, ...over };
}

export function multiRun(over: Partial<MultiAgentRun> = {}): MultiAgentRun {
  const columns = over.columns ?? [column({ agent_id: "a1" }), column({ agent_id: "a2" })];
  return {
    id: "mr1",
    pr_id: "pr1",
    pr_number: 482,
    ran_at: "2026-10-01T10:00:00Z",
    agent_count: columns.length,
    total_duration_ms: 14000,
    total_cost_usd: 0.0246,
    columns,
    conflicts: [],
    head_sha: "abc123",
    stale: false,
    ...over,
  };
}

export function findingRecord(over: Partial<FindingRecord> & Pick<FindingRecord, "id">): FindingRecord {
  return {
    severity: "WARNING",
    category: "security",
    title: `Finding ${over.id}`,
    file: "src/a.ts",
    start_line: 10,
    end_line: 10,
    rationale: `Rationale of ${over.id}`,
    suggestion: null,
    confidence: 0.9,
    review_id: "rev1",
    accepted_at: null,
    dismissed_at: null,
    learned: null,
    ...over,
  } as FindingRecord;
}

export function review(agentId: string, findings: FindingRecord[]): ReviewRecord {
  return {
    id: `rev-${agentId}`,
    pr_id: "pr1",
    agent_id: agentId,
    run_id: `run-${agentId}`,
    agent_name: `Agent ${agentId}`,
    kind: "review",
    verdict: "comment",
    summary: null,
    score: 80,
    model: "gpt-4.1",
    created_at: "2026-10-01T10:00:00Z",
    findings,
  } as ReviewRecord;
}

/* ---- fetch double ---- */

export type Reply = { status: number; body: unknown };
export type FetchCall = { method: string; path: string; body: unknown };
/** A reply, or a function read at call time so a test can change what the server says next. */
export type Route = Reply | (() => Reply);

/**
 * Stubs global `fetch`. `routes` is keyed `"<METHOD> <pathname>"` and read on every call, so
 * a test may reassign a route mid-flow (a refetch then sees the new state). An unlisted
 * route answers 404.
 */
export function installFetch(routes: Record<string, Route>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const method = init?.method ?? "GET";
    const route = routes[`${method} ${path}`];
    const r: Reply = route
      ? typeof route === "function"
        ? route()
        : route
      : { status: 404, body: { error: { message: "not found" } } };
    return { ok: r.status < 400, status: r.status, statusText: "", json: async () => r.body } as Response;
  });
  vi.stubGlobal("fetch", fn);
  const calls = (): FetchCall[] =>
    fn.mock.calls.map(([url, init]) => ({
      method: init?.method ?? "GET",
      path: new URL(url).pathname,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    }));
  return { fn, calls };
}

/* ---- EventSource double ---- */

export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener() {}
  close() {
    this.closed = true;
  }
  /** Deliver one run event the way the SSE stream does. */
  emit(event: { t: string; kind: "info" | "tool" | "result" | "error"; msg: string }) {
    this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent);
  }
}

export function installEventSource() {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  return FakeEventSource;
}
