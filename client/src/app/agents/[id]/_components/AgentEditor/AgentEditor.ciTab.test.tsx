/* AgentEditor.ciTab.test.tsx — T12 (AC-32, AC-35): the CI tab follows Context, `tab="ci"`
   renders it, and the Config tab no longer has the CI gate nor sends `ci_fail_on`. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../messages/en/agents.json";
import { ToastProvider } from "../../../../../lib/toast";

const mutate = vi.hoisted(() => vi.fn());
vi.mock("../../../../../lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate, isPending: false, isSuccess: false, data: undefined }),
  useProviderModels: () => ({ data: [{ id: "gpt-4.1", provider: "openai" }] }),
}));
vi.mock("./_components/CiTab", () => ({ CiTab: () => <div>ci-tab-stub</div> }));

import { AgentEditor } from "./AgentEditor";
import { TABS } from "./constants";

afterEach(cleanup);

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "p",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function renderEditor(tab: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <ToastProvider>
        <AgentEditor agent={AGENT} tab={tab} onTab={() => {}} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("AgentEditor CI tab", () => {
  it("AC-32: CI is the last tab, after Context and Evals", () => {
    expect(TABS.map((t) => t.key).slice(-3)).toEqual(["context", "evals", "ci"]);
  });

  it("AC-32: tab=ci renders the CI tab", () => {
    renderEditor("ci");
    expect(screen.getByText("ci-tab-stub")).toBeInTheDocument();
  });

  it("AC-35: the Config tab has no CI gate and its save omits ci_fail_on", () => {
    renderEditor("config");
    expect(screen.queryByText("CI gate")).toBeNull();
    fireEvent.click(screen.getByText("Save agent"));
    const patch = mutate.mock.calls[0]![0].patch as Record<string, unknown>;
    expect(patch).not.toHaveProperty("ci_fail_on");
  });
});
