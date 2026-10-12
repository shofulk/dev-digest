import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within, waitFor, fireEvent } from "@testing-library/react";
import {
  MultiAgentTestProviders,
  agent,
  estimate,
  installFetch,
  pull,
  type Reply,
} from "@/test/multi-agent-intl";
import { agentLook } from "@/lib/agent-look";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), query: "" }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1" }),
  usePathname: () => "/repos/r1/multi-agent",
  useSearchParams: () => new URLSearchParams(nav.query),
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ crumb, children }: { crumb?: { label: string }[]; children: React.ReactNode }) => (
    <div>
      <nav aria-label="breadcrumb">{crumb?.map((c) => c.label).join(" › ")}</nav>
      {children}
    </div>
  ),
}));

import { ConfigureRunView } from "./ConfigureRunView";

const AGENTS = [
  agent({ id: "a1", name: "Security", description: "Finds vulnerabilities" }),
  agent({ id: "a2", name: "Performance", description: "Finds slow code" }),
  agent({ id: "a3", name: "Style", description: "Finds nits", enabled: false }),
];

let routes: Record<string, Reply>;

beforeEach(() => {
  nav.push.mockClear();
  nav.query = "";
  routes = {
    "GET /repos": { status: 200, body: [{ id: "r1", full_name: "acme/api", default_branch: "main" }] },
    "GET /repos/r1/pulls": {
      status: 200,
      body: [pull({ number: 7, title: "Add cache" }), pull({ number: 8, title: "Fix bug" })],
    },
    "GET /agents": { status: 200, body: AGENTS },
    "GET /repos/r1/multi-agent-runs": { status: 200, body: [] },
    // a1: 10s / $0.05 · a2: 20s / $0.10 · a3 has no finished run
    "GET /run-estimates": {
      status: 200,
      body: [estimate("a1", 10_000, 0.05), estimate("a2", 20_000, 0.1)],
    },
    "POST /pulls/pr7/multi-agent-run": {
      status: 200,
      body: { multi_agent_run_id: "m9", runs: [{ run_id: "r1" }, { run_id: "r2" }] },
    },
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderView() {
  const net = installFetch(routes);
  render(
    <MultiAgentTestProviders>
      <ConfigureRunView />
    </MultiAgentTestProviders>,
  );
  await net.settled();
  return net;
}

const prSelect = () => screen.getByRole("combobox") as HTMLSelectElement;
const runButton = () => screen.getByRole("button", { name: /^Run multi-agent review \(\d+\)$/ });
const cardOf = (name: string) => screen.getByRole("checkbox", { name }).closest("div[style]")! as HTMLElement;

describe("ConfigureRunView", () => {
  it("AC-6/AC-7: shows both steps; with no PR selected the agent list is replaced by the empty state and Run is disabled", async () => {
    await renderView();

    expect(screen.getByRole("heading", { name: "Pull request" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Agents to run" })).toBeInTheDocument();
    expect(prSelect()).toHaveValue("");
    expect(screen.getByText("Pick a pull request first")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(runButton()).toBeDisabled();
  });

  it("AC-8: ?pr preselects a PR of this repo, an unknown id leaves the selector empty", async () => {
    nav.query = "pr=pr8";
    await renderView();
    expect(prSelect()).toHaveValue("pr8");
    expect(screen.getByRole("checkbox", { name: "Security" })).toBeInTheDocument();

    cleanup();
    vi.unstubAllGlobals();
    nav.query = "pr=nope";
    await renderView();
    expect(prSelect()).toHaveValue("");
    expect(screen.getByText("Pick a pull request first")).toBeInTheDocument();
  });

  it("AC-9/AC-16: a selected PR shows one card per agent with description, estimate and the agentLook accent and icon", async () => {
    await renderView();
    fireEvent.change(prSelect(), { target: { value: "pr7" } });

    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.getByRole("checkbox", { name: "Security" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Style" })).not.toBeChecked();
    expect(screen.getByText("Finds vulnerabilities")).toBeInTheDocument();
    expect(screen.getByText("10s · $0.05")).toBeInTheDocument();
    expect(screen.getByText("20s · $0.1")).toBeInTheDocument();

    for (const a of AGENTS) {
      const card = cardOf(a.name);
      const { accent, icon } = agentLook(a.id);
      // the accent is applied to the icon box; compare through the browser's own colour parsing
      const probe = document.createElement("span");
      probe.style.color = accent;
      // the decorative icon box is the only aria-hidden element of a card (no accessible handle)
      const glyph = card.querySelector("[aria-hidden] > svg")!;
      expect((glyph.parentElement as HTMLElement).style.color).toBe(probe.style.color);
      expect(glyph.getAttribute("class")).toContain(`lucide-${icon.toLowerCase()}`);
    }
  });

  it("AC-10/AC-11/AC-12/AC-13: Select all checks every card; Run (N) and the total follow the checks; an agent without an estimate shows — and marks the total partial", async () => {
    await renderView();
    fireEvent.change(prSelect(), { target: { value: "pr7" } });

    // enabled agents only: max time 20s, summed cost $0.15, nothing partial
    expect(runButton()).toHaveTextContent("Run multi-agent review (2)");
    expect(screen.getByText(/≈ 20s · \$0\.15 · parallel fan-out/)).toBeInTheDocument();
    expect(screen.queryByText("partial")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    for (const box of screen.getAllByRole("checkbox")) expect(box).toBeChecked();
    expect(runButton()).toHaveTextContent("Run multi-agent review (3)");
    // Style has no finished run: its card shows —, the total leaves it out and is flagged partial
    expect(within(cardOf("Style")).getByText("— · —")).toBeInTheDocument();
    expect(screen.getByText(/≈ 20s · \$0\.15 · parallel fan-out/)).toBeInTheDocument();
    expect(screen.getByText("partial")).toBeInTheDocument();

    for (const name of ["Security", "Performance", "Style"]) {
      fireEvent.click(screen.getByRole("checkbox", { name }));
    }
    expect(runButton()).toHaveTextContent("Run multi-agent review (0)");
    expect(runButton()).toBeDisabled();
    expect(screen.queryByText(/parallel fan-out/)).not.toBeInTheDocument();
  });

  it("AC-14: with no enabled agent it shows the empty state and Go to Agents opens /agents", async () => {
    routes["GET /agents"] = { status: 200, body: AGENTS.map((a) => ({ ...a, enabled: false })) };
    await renderView();

    expect(screen.getByText("Enable agents to run reviews")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go to Agents" }));
    expect(nav.push).toHaveBeenCalledWith("/agents");
  });

  it("AC-17: Run starts the multi-run with the checked agents for the selected PR and opens its results page", async () => {
    const net = await renderView();
    fireEvent.change(prSelect(), { target: { value: "pr7" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Performance" })); // uncheck
    fireEvent.click(runButton());

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/repos/r1/multi-agent/m9"));
    const start = net.calls().find((c) => c.method === "POST" && c.path === "/pulls/pr7/multi-agent-run");
    expect(start?.body).toEqual({ agent_ids: ["a1"] });
  });

  it("AC-19: a failed start toasts the API message and keeps the PR and the checked agents", async () => {
    routes["POST /pulls/pr7/multi-agent-run"] = {
      status: 422,
      body: { error: { code: "no_agents", message: "None of the agents can run" } },
    };
    await renderView();
    fireEvent.change(prSelect(), { target: { value: "pr7" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Performance" })); // uncheck
    fireEvent.click(runButton());

    expect(await screen.findByText("None of the agents can run")).toBeInTheDocument();
    expect(nav.push).not.toHaveBeenCalled();
    expect(prSelect()).toHaveValue("pr7");
    expect(screen.getByRole("checkbox", { name: "Security" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Performance" })).not.toBeChecked();
  });
});
