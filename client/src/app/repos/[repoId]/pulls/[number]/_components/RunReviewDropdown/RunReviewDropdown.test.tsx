import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within, waitFor, fireEvent } from "@testing-library/react";
import {
  MultiAgentTestProviders,
  agent,
  estimate,
  installFetch,
  type Reply,
} from "@/test/multi-agent-intl";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  usePathname: () => "/repos/r1/pulls/7",
}));

import { RunReviewDropdown } from "./RunReviewDropdown";

const AGENTS = [
  agent({ id: "a1", name: "Security" }),
  agent({ id: "a2", name: "Performance" }),
  agent({ id: "a3", name: "Style", enabled: false }),
];

let routes: Record<string, Reply>;

beforeEach(() => {
  nav.push.mockClear();
  routes = {
    "GET /agents": { status: 200, body: AGENTS },
    "GET /run-estimates": { status: 200, body: [estimate("a1", 12_000, 0.05)] },
    "POST /pulls/pr1/multi-agent-run": {
      status: 200,
      body: { multi_agent_run_id: "m1", runs: [{ run_id: "run1" }, { run_id: "run2" }] },
    },
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openPicker() {
  const net = installFetch(routes);
  render(
    <MultiAgentTestProviders>
      <RunReviewDropdown prId="pr1" repoId="r1" />
    </MultiAgentTestProviders>,
  );
  // let the agent list load first (the AC-2 test below covers opening before it arrives)
  await net.settled();
  fireEvent.click(screen.getByRole("button", { name: "Run Review" }));
  const dialog = await screen.findByRole("dialog", { name: "Pick agents to run" });
  return { net, dialog };
}

describe("RunReviewDropdown picker", () => {
  it("AC-1/AC-2/AC-3: lists every agent with its estimate, checks only enabled ones, Clear disables Run", async () => {
    const { dialog } = await openPicker();

    expect(within(dialog).getByRole("heading", { name: "Pick agents to run" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Clear" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Configure agents…" })).toBeInTheDocument();

    expect(within(dialog).getAllByRole("checkbox")).toHaveLength(3);
    expect(within(dialog).getByRole("checkbox", { name: "Security" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "Performance" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "Style" })).not.toBeChecked();
    // the estimate seconds of the one agent that has a sample, "—" for the other two
    expect(within(dialog).getByText("~12s")).toBeInTheDocument();
    expect(within(dialog).getAllByText("—")).toHaveLength(2);

    expect(within(dialog).getByRole("button", { name: "Run multi-agent review (2)" })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear" }));
    for (const box of within(dialog).getAllByRole("checkbox")) expect(box).not.toBeChecked();
    expect(within(dialog).getByRole("button", { name: "Run multi-agent review (0)" })).toBeDisabled();
  });

  it("AC-2: a picker opened before the agent list loads preselects the enabled agents once it arrives", async () => {
    installFetch(routes);
    render(
      <MultiAgentTestProviders>
        <RunReviewDropdown prId="pr1" repoId="r1" />
      </MultiAgentTestProviders>,
    );
    // open immediately — GET /agents has not resolved yet
    fireEvent.click(screen.getByRole("button", { name: "Run Review" }));
    const dialog = await screen.findByRole("dialog", { name: "Pick agents to run" });

    expect(await within(dialog).findByRole("checkbox", { name: "Security" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "Performance" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "Style" })).not.toBeChecked();
    expect(within(dialog).getByRole("button", { name: "Run multi-agent review (2)" })).toBeEnabled();
  });

  it("AC-4: Run starts the multi-run with the checked agents and opens its results page", async () => {
    const { net, dialog } = await openPicker();

    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Performance" })); // uncheck
    fireEvent.click(within(dialog).getByRole("button", { name: "Run multi-agent review (1)" }));

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/repos/r1/multi-agent/m1"));
    const start = net.calls().find((c) => c.method === "POST" && c.path === "/pulls/pr1/multi-agent-run");
    expect(start?.body).toEqual({ agent_ids: ["a1"] });
  });

  it("AC-5: Configure agents… opens the Agents page", async () => {
    const { dialog } = await openPicker();
    fireEvent.click(within(dialog).getByRole("button", { name: "Configure agents…" }));
    expect(nav.push).toHaveBeenCalledWith("/agents");
  });

  it("AC-14: with no enabled agent the picker shows the empty state and Go to Agents opens /agents", async () => {
    routes["GET /agents"] = { status: 200, body: AGENTS.map((a) => ({ ...a, enabled: false })) };
    const { dialog } = await openPicker();

    expect(within(dialog).getByText("Enable agents to run reviews")).toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Go to Agents" }));
    expect(nav.push).toHaveBeenCalledWith("/agents");
  });

  it("AC-19: a failed start toasts the API message and keeps the picker open with its checks", async () => {
    routes["POST /pulls/pr1/multi-agent-run"] = {
      status: 409,
      body: { error: { code: "conflict", message: "A run is already in progress" } },
    };
    const { dialog } = await openPicker();

    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Performance" })); // uncheck
    fireEvent.click(within(dialog).getByRole("button", { name: "Run multi-agent review (1)" }));

    expect(await screen.findByText("A run is already in progress")).toBeInTheDocument();
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Pick agents to run" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Security" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Performance" })).not.toBeChecked();
  });
});
