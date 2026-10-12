import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import {
  ResultsTestProviders,
  installEventSource,
  installFetch,
  multiRun,
  review,
} from "@/test/multi-agent-results-intl";

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1", multiRunId: "mr1" }),
  usePathname: () => "/repos/r1/multi-agent/mr1",
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    activeRepo: { id: "r1", full_name: "acme/api", default_branch: "main" },
    repos: [],
    repoId: "r1",
    setRepoId: () => {},
    reposLoaded: true,
  }),
  useRepoNotFound: () => false,
  RepoProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

/* The real AppShell is mocked; this one renders each crumb, a link when it has an href. */
vi.mock("@/components/app-shell", () => ({
  AppShell: ({
    crumb,
    children,
  }: {
    crumb?: { label: string; href?: string }[];
    children: React.ReactNode;
  }) => (
    <div>
      <nav aria-label="Breadcrumb">
        {crumb?.map((c) =>
          c.href ? (
            <a key={c.label} href={c.href}>
              {c.label}
            </a>
          ) : (
            <span key={c.label}>{c.label}</span>
          ),
        )}
      </nav>
      {children}
    </div>
  ),
}));

import { MultiRunView } from "@/app/repos/[repoId]/multi-agent/[multiRunId]/_components/MultiRunView";

beforeEach(() => {
  installEventSource();
  installFetch({
    "GET /multi-agent-runs/mr1": { status: 200, body: multiRun() },
    "GET /pulls/pr1": { status: 200, body: { id: "pr1", number: 482, title: "Harden the auth middleware" } },
    "GET /pulls/pr1/reviews": { status: 200, body: [review("a1", []), review("a2", [])] },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MultiRunView breadcrumb", () => {
  it("AC-101: the first crumb reads 'Multi-Agent Review' and links to the Configure run page; the second is the PR number", async () => {
    render(
      <ResultsTestProviders>
        <MultiRunView />
      </ResultsTestProviders>,
    );
    // wait for the run to load, so the second crumb has its PR number
    await screen.findByText("2 agents · parallel · 14s total · $0.025");

    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    const first = within(nav).getByRole("link", { name: "Multi-Agent Review" });
    expect(first).toHaveAttribute("href", "/repos/r1/multi-agent");
    expect(within(nav).getByText("#482")).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "#482" })).toBeNull();
    expect(nav.textContent).toBe("Multi-Agent Review#482");
  });
});
