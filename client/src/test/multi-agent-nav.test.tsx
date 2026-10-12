import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MultiAgentTestProviders, installFetch } from "@/test/multi-agent-intl";
import { NAV } from "@/vendor/ui/nav";
import { activeKeyFor } from "@/components/app-shell/helpers";

const nav = vi.hoisted(() => ({ path: "/repos/r1/pulls" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.path,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ repoId: "r1" }),
  useSearchParams: () => new URLSearchParams(),
}));

import { AppShell } from "@/components/app-shell";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderShell() {
  const net = installFetch({
    "GET /repos": { status: 200, body: [{ id: "r1", full_name: "acme/api", default_branch: "main", last_polled_at: null }] },
    "GET /repos/r1/pulls": { status: 200, body: [] },
  });
  render(
    <MultiAgentTestProviders>
      <AppShell>
        <p>page body</p>
      </AppShell>
    </MultiAgentTestProviders>,
  );
  await net.settled();
}

describe("Multi-Agent Review sidebar entry", () => {
  it("AC-18: the shell of an active repo links 'Multi-Agent Review' to that repo's Configure run screen", async () => {
    await renderShell();
    const link = screen.getByRole("link", { name: /Multi-Agent Review/ });
    expect(link).toHaveAttribute("href", "/repos/r1/multi-agent");
  });

  it("AC-18: the entry sits in the GLOBAL group, not WORKSPACE", () => {
    const groupOf = (key: string) => NAV.find((g) => g.items.some((i) => i.key === key))?.section;
    expect(groupOf("multi-agent")).toBe("GLOBAL");
    expect(groupOf("pulls")).toBe("WORKSPACE");
  });

  it("AC-18: activeKeyFor highlights the entry on Configure run and on a results page", () => {
    expect(activeKeyFor("/repos/r1/multi-agent")).toBe("multi-agent");
    expect(activeKeyFor("/repos/r1/multi-agent/m1")).toBe("multi-agent");
    expect(activeKeyFor("/repos/r1/pulls/7")).toBe("pulls");
  });
});
