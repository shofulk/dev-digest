import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import {
  MultiAgentTestProviders,
  agent,
  estimate,
  installFetch,
  pull,
} from "@/test/multi-agent-intl";

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1" }),
  usePathname: () => "/repos/r1/multi-agent",
  useSearchParams: () => new URLSearchParams("pr=pr7"),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import { RunReviewDropdown } from "@/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown";
import { ConfigureRunView } from "@/app/repos/[repoId]/multi-agent/_components/ConfigureRunView";

const ROUTES = {
  "GET /repos": { status: 200, body: [{ id: "r1", full_name: "acme/api", default_branch: "main" }] },
  "GET /repos/r1/pulls": { status: 200, body: [pull({ number: 7, title: "Add cache" })] },
  "GET /agents": {
    status: 200,
    body: [agent({ id: "a1", name: "Security" }), agent({ id: "a2", name: "Performance" })],
  },
  "GET /run-estimates": { status: 200, body: [estimate("a1", 10_000, 0.05)] },
  "GET /repos/r1/multi-agent-runs": { status: 200, body: [] },
};

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, "error");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  consoleError.mockRestore();
});

/** WCAG 2 A + AA. jsdom has no layout engine, so colour contrast is a manual pass (plan R6). */
async function violations(root: Element) {
  const res = await axe.run(root, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    rules: { "color-contrast": { enabled: false } },
  });
  return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

/** Press Tab until `el` holds focus (real keyboard traversal, not `el.focus()`). */
async function tabTo(user: ReturnType<typeof userEvent.setup>, el: HTMLElement, max = 30) {
  for (let i = 0; i < max && document.activeElement !== el; i++) await user.tab();
  expect(el).toHaveFocus();
}

const missingMessages = () =>
  consoleError.mock.calls.filter((c) => String(c[0] instanceof Error ? c[0].message : c[0]).includes("MISSING_MESSAGE"));

describe("multi-agent accessibility", () => {
  it("AC-1: the open picker has no WCAG A/AA violations, its checkboxes are focusable keyboard controls and no message is missing", async () => {
    const net = installFetch(ROUTES);
    render(
      <MultiAgentTestProviders>
        <RunReviewDropdown prId="pr7" repoId="r1" />
      </MultiAgentTestProviders>,
    );
    await net.settled();
    fireEvent.click(screen.getByRole("button", { name: "Run Review" }));
    const dialog = await screen.findByRole("dialog", { name: "Pick agents to run" });

    expect(await violations(dialog)).toEqual([]);

    const user = userEvent.setup();
    const boxes = within(dialog).getAllByRole("checkbox");
    expect(boxes.length).toBeGreaterThan(1);
    for (const box of boxes) {
      // a native <button>: in the tab order, and Space/Enter activate it
      expect(box.tagName).toBe("BUTTON");
      expect(box.tabIndex).toBeGreaterThanOrEqual(0);
      // reached by pressing Tab, and Space toggles it
      await tabTo(user, box);
      const was = box.getAttribute("aria-checked");
      await user.keyboard(" ");
      expect(box.getAttribute("aria-checked")).not.toBe(was);
      await user.keyboard(" ");
      expect(box.getAttribute("aria-checked")).toBe(was);
    }
    const first = within(dialog).getByRole("checkbox", { name: "Security" });
    expect(first).toBeChecked();
    await tabTo(user, first);
    await user.keyboard(" ");
    expect(first).not.toBeChecked();
    expect(missingMessages()).toEqual([]);
  });

  it("AC-9: Configure run with a PR selected has no WCAG A/AA violations, focusable checkboxes and no missing message", async () => {
    const net = installFetch(ROUTES);
    const { container } = render(
      <MultiAgentTestProviders>
        <ConfigureRunView />
      </MultiAgentTestProviders>,
    );
    await net.settled();
    expect(await screen.findByRole("checkbox", { name: "Security" })).toBeChecked();

    expect(await violations(container)).toEqual([]);

    const user = userEvent.setup();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.length).toBeGreaterThan(1);
    for (const box of boxes) {
      expect(box.tagName).toBe("BUTTON");
      expect(box.tabIndex).toBeGreaterThanOrEqual(0);
      await tabTo(user, box);
      const was = box.getAttribute("aria-checked");
      await user.keyboard(" ");
      expect(box.getAttribute("aria-checked")).not.toBe(was);
    }
    expect(missingMessages()).toEqual([]);
  });
});
