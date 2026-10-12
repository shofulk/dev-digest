import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { Providers } from "@/lib/providers";
import common from "@/../messages/en/common.json";
import multiAgent from "@/../messages/en/multiAgent.json";
import { NOW, installHistoryFetch, runSummary } from "@/test/multi-agent-history-intl";
import { RecentRuns } from "./RecentRuns";

/* CH5: the hover title is formatted in the viewer's zone, passed explicitly, so SSR (server
   zone) and the browser agree and never rely on next-intl's environment fallback. */
const REAL_TZ = process.env.TZ;
const VIEWER_ZONE = "America/New_York";

beforeEach(() => {
  process.env.TZ = VIEWER_ZONE;
  installHistoryFetch({
    "GET /repos/r1/multi-agent-runs": { status: 200, body: [runSummary({ id: "m1", ran_at: "2026-10-12T10:00:00Z" })] },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (REAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = REAL_TZ;
});

describe("RecentRuns hover title time zone", () => {
  it("CH5: formats the title in the viewer's resolved zone, whatever zone the provider carries", async () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(VIEWER_ZONE);
    render(
      <Providers>
        <NextIntlClientProvider locale="en" timeZone="Asia/Tokyo" now={NOW} messages={{ common, multiAgent }}>
          <RecentRuns repoId="r1" />
        </NextIntlClientProvider>
      </Providers>,
    );
    const time = (await screen.findByRole("link")).querySelector("time")!;
    const expected = new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }).format(new Date("2026-10-12T10:00:00Z"));
    expect(expected).toMatch(/6:00/); // 10:00Z is 06:00 in New York (EDT), not 19:00 (Tokyo)
    expect(time.getAttribute("title")).toBe(expected);
  });
});
