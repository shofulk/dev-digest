import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BlastRadius } from "@devdigest/shared";
import blastMessages from "../../../../../../../../../../messages/en/blast.json";
import { BlastRadiusCard } from "./BlastRadiusCard";

const HAPPY: BlastRadius = {
  changed_symbols: [{ name: "rateLimit", file: "src/middleware/ratelimit.ts", kind: "function" }],
  downstream: [
    {
      symbol: "rateLimit",
      callers: [
        { name: "dataHandler", file: "src/api/public.ts", line: 23, depth: 1, via: null },
        { name: "adminHandler", file: "src/api/admin.ts", line: 40, depth: 1, via: null },
        { name: "routeHandler", file: "src/api/routes.ts", line: 8, depth: 2, via: "handle" },
      ],
      endpoints_affected: ["GET /public/data"],
      crons_affected: ["job:cleanup"],
    },
  ],
  summary: "1 changed symbol, 3 callers.",
  degraded: false,
  reason: null,
  limits: { max_callers_per_symbol: 20, bfs_depth: 2 },
};

type Reply = { status: number; body: unknown };
let replies: Record<string, Reply>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  replies = { "/pulls/pr1/blast": { status: 200, body: HAPPY } };
  fetchMock = vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    const r = replies[path] ?? { status: 404, body: {} };
    return { ok: r.status < 400, status: r.status, statusText: "", json: async () => r.body } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderCard(props?: { repoFullName?: string | null; headSha?: string }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const repoFullName = props && "repoFullName" in props ? props.repoFullName! : "acme/api";
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ blast: blastMessages }}>
        <BlastRadiusCard prId="pr1" repoFullName={repoFullName} headSha={props?.headSha ?? "abc123"} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("BlastRadiusCard", () => {
  it("shows a loading skeleton first", () => {
    const { container } = renderCard();
    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
  });

  it("shows the summary counts on the happy path", async () => {
    const { container } = renderCard();
    expect(await screen.findByText("rateLimit()")).toBeInTheDocument();
    expect(await screen.findByText("3 callers")).toBeInTheDocument();
    const values = Array.from(container.querySelectorAll(".tnum")).map((el) => el.textContent);
    expect(values).toEqual(["1", "3", "1", "1"]);
  });

  it("renders depth-1 callers before depth-2 even when the fixture lists depth-2 first", async () => {
    replies["/pulls/pr1/blast"] = {
      status: 200,
      body: {
        ...HAPPY,
        downstream: [
          {
            symbol: "rateLimit",
            callers: [
              { name: "routeHandler", file: "src/api/routes.ts", line: 8, depth: 2, via: "handle" },
              { name: "dataHandler", file: "src/api/public.ts", line: 23, depth: 1, via: null },
            ],
            endpoints_affected: [],
            crons_affected: [],
          },
        ],
      },
    };
    renderCard();
    await screen.findByText("rateLimit()");
    const names = screen.getAllByText(/Handler$/).map((el) => el.textContent);
    expect(names).toEqual(["dataHandler", "routeHandler"]);
  });

  it("noSymbols state renders the empty text", async () => {
    replies["/pulls/pr1/blast"] = {
      status: 200,
      body: { ...HAPPY, changed_symbols: [], downstream: [], degraded: false, reason: null },
    };
    renderCard();
    expect(await screen.findByText("No symbols changed in this pull request.")).toBeInTheDocument();
  });

  it("a GitHub link pins to the sha and opens in a new tab", async () => {
    renderCard();
    const link = await screen.findByRole("link", { name: /src\/api\/public\.ts:23/ });
    expect(link).toHaveAttribute("href", "https://github.com/acme/api/blob/abc123/src/api/public.ts#L23");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("a depth-2 caller renders after direct callers with a via label", async () => {
    renderCard();
    await screen.findByText("rateLimit()");
    expect(screen.getByText("via handle()")).toBeInTheDocument();
  });

  it("shows the endpoint chip and the cron chip in separate rows", async () => {
    renderCard();
    const endpointChip = await screen.findByText("GET /public/data");
    const cronChip = await screen.findByText("job:cleanup");
    expect(endpointChip.closest("div")).not.toBe(cronChip.closest("div"));
  });

  it("noCallersFor lists a changed symbol with no callers", async () => {
    replies["/pulls/pr1/blast"] = {
      status: 200,
      body: {
        ...HAPPY,
        changed_symbols: [
          { name: "rateLimit", file: "src/middleware/ratelimit.ts", kind: "function" },
          { name: "orphan", file: "src/util.ts", kind: "function" },
        ],
      },
    };
    renderCard();
    expect(await screen.findByText("No callers found for: orphan")).toBeInTheDocument();
  });

  it("shows the cap hint when a symbol's caller count reaches the limit", async () => {
    replies["/pulls/pr1/blast"] = {
      status: 200,
      body: {
        ...HAPPY,
        downstream: [{ ...HAPPY.downstream[0]!, callers: HAPPY.downstream[0]!.callers.slice(0, 2) }],
        limits: { max_callers_per_symbol: 2, bfs_depth: 2 },
      },
    };
    renderCard();
    expect(await screen.findByText("Showing the top 2 callers by rank.")).toBeInTheDocument();
  });

  it("not degraded, empty downstream -> noDownstream text", async () => {
    replies["/pulls/pr1/blast"] = { status: 200, body: { ...HAPPY, downstream: [] } };
    renderCard();
    expect(await screen.findByText(/no downstream callers found/)).toBeInTheDocument();
  });

  it("degraded + empty -> badge and reason, never noDownstream", async () => {
    replies["/pulls/pr1/blast"] = {
      status: 200,
      body: { ...HAPPY, downstream: [], degraded: true, reason: "no_data" },
    };
    renderCard();
    expect(await screen.findByText("Index incomplete")).toBeInTheDocument();
    expect(screen.getByText(/No index data yet/)).toBeInTheDocument();
    expect(screen.queryByText(/no downstream callers found/)).not.toBeInTheDocument();
  });

  it("repoFullName null -> no link, no button, plain mono text for file:line", async () => {
    renderCard({ repoFullName: null });
    await screen.findByText("rateLimit()");
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: /src\/api\/public\.ts:23/ })).toHaveLength(0);
    expect(screen.getByText("src/api/public.ts:23")).toBeInTheDocument();
  });

  it("indexed_sha (T19) pins caller links, including depth-2 ones, over headSha", async () => {
    replies["/pulls/pr1/blast"] = { status: 200, body: { ...HAPPY, indexed_sha: "c6af1e4" } };
    renderCard();
    const directLink = await screen.findByRole("link", { name: /src\/api\/public\.ts:23/ });
    expect(directLink).toHaveAttribute("href", "https://github.com/acme/api/blob/c6af1e4/src/api/public.ts#L23");
    const depth2Link = screen.getByRole("link", { name: /src\/api\/routes\.ts:8/ });
    expect(depth2Link).toHaveAttribute("href", "https://github.com/acme/api/blob/c6af1e4/src/api/routes.ts#L8");
  });

  it("500 -> loadError and retry issues a second request", async () => {
    replies["/pulls/pr1/blast"] = { status: 500, body: { error: "boom" } };
    renderCard();
    expect(await screen.findByText("Couldn't load the blast radius.")).toBeInTheDocument();
    const callsBefore = fetchMock.mock.calls.length;
    replies["/pulls/pr1/blast"] = { status: 200, body: HAPPY };
    const retryBtn = screen.getByRole("button", { name: /retry/i });
    retryBtn.click();
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore));
  });
});
