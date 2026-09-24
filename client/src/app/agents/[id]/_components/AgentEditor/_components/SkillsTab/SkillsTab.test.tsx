import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AgentLinkedSkill } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/agents.json";
import { SkillsTab } from "./SkillsTab";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const link = (id: string, order: number, over: Partial<AgentLinkedSkill> = {}): AgentLinkedSkill => ({
  agent_id: "ag1",
  skill_id: id,
  order,
  enabled: true,
  name: `skill-${id}`,
  description: `${id} description`,
  type: "rubric",
  version: 1,
  skill_enabled: true,
  ...over,
});

const WORKSPACE = ["a", "b", "c", "x", "y"].map((id) => ({
  id,
  name: `skill-${id}`,
  description: "",
  type: "rubric",
  enabled: true,
}));

interface Call {
  method: string;
  path: string;
  body: unknown;
}

let linked: AgentLinkedSkill[];
let calls: Call[];

function installFetch() {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path, body });
      // A stateful server: the POST replaces the set, the PUT patches one link.
      if (method === "POST" && path === "/agents/ag1/skills") {
        const items = body.items as { skill_id: string; enabled: boolean }[];
        linked = items.map((it, order) => ({
          ...(linked.find((l) => l.skill_id === it.skill_id) ?? link(it.skill_id, order)),
          order,
          enabled: it.enabled,
        }));
      }
      if (method === "PUT") {
        const id = path.split("/").pop();
        linked = linked.map((l) => (l.skill_id === id ? { ...l, ...body } : l));
      }
      // GET, POST and PUT on the agent's skills all answer with the whole ordered set.
      const data = path.startsWith("/agents/ag1/skills") ? linked : path === "/skills" ? WORKSPACE : [];
      return { ok: true, status: 200, json: async () => data } as Response;
    }),
  );
}

const writes = () => calls.filter((c) => c.method !== "GET");

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
        <SkillsTab agentId="ag1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  push.mockClear();
  linked = [link("a", 0), link("b", 1, { enabled: false }), link("c", 2, { skill_enabled: false })];
  installFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SkillsTab", () => {
  it("counts links (not workspace skills), mutes a globally disabled skill, and patches one link from the checkbox", async () => {
    renderTab();

    // 2 of the 3 LINKS are enabled; the workspace holds 5 skills.
    expect(await screen.findByText("2 of 3 enabled")).toBeInTheDocument();
    expect(screen.getByText(/earlier skills appear earlier in the assembled prompt/i)).toBeInTheDocument();

    // 31a: caption links to the Skills Lab entry, and only for the globally disabled skill.
    const caption = screen.getByRole("link", { name: "disabled globally" });
    expect(caption).toHaveAttribute("href", "/skills?skill=c");
    expect(screen.getAllByRole("link")).toHaveLength(1);

    // ...and its checkbox still works (the per-agent flag is independent).
    fireEvent.click(screen.getByRole("checkbox", { name: "skill-c" }));
    await waitFor(() =>
      expect(writes()).toContainEqual({ method: "PUT", path: "/agents/ag1/skills/c", body: { enabled: false } }),
    );
    expect(await screen.findByText("1 of 3 enabled")).toBeInTheDocument();
  });

  it("Alt+Arrow reorders and POSTs the whole set with every row's CURRENT enabled", async () => {
    renderTab();
    const list = await screen.findByRole("list", { name: "Skills" });
    const rowOf = (name: string) => within(list).getByRole("checkbox", { name }).closest("li")!;

    // b is linked but disabled: moving it must never re-enable it.
    fireEvent.keyDown(rowOf("skill-b"), { key: "ArrowUp", altKey: true });

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "POST",
      path: "/agents/ag1/skills",
      body: {
        items: [
          { skill_id: "b", enabled: false },
          { skill_id: "a", enabled: true },
          { skill_id: "c", enabled: true },
        ],
      },
    });
    await waitFor(() =>
      expect(within(list).getAllByRole("checkbox").map((c) => c.getAttribute("aria-checked"))).toEqual([
        "false",
        "true",
        "true",
      ]),
    );

    // Alt+ArrowUp on the first row is a no-op: nothing more is posted.
    fireEvent.keyDown(rowOf("skill-b"), { key: "ArrowUp", altKey: true });
    // Without Alt the arrow is left alone.
    fireEvent.keyDown(rowOf("skill-a"), { key: "ArrowDown" });
    expect(writes()).toHaveLength(1);
  });

  it("links an unlinked workspace skill, unlinks from the row menu, and filters the list", async () => {
    renderTab();
    await screen.findByText("2 of 3 enabled");

    const filter = screen.getByRole("textbox", { name: "Filter skills…" });
    fireEvent.change(filter, { target: { value: "skill-b" } });
    expect(screen.queryByRole("checkbox", { name: "skill-a" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "skill-b" })).toBeInTheDocument();
    fireEvent.change(filter, { target: { value: "" } });

    // Only the two unlinked skills are offered.
    fireEvent.click(screen.getByText("Add skill…"));
    expect(screen.queryByRole("button", { name: "skill-a" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "skill-x" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]?.body).toEqual({
      items: [
        { skill_id: "a", enabled: true },
        { skill_id: "b", enabled: false },
        { skill_id: "c", enabled: true },
        { skill_id: "x", enabled: true },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Actions for skill-a" }));
    fireEvent.click(screen.getByRole("button", { name: "Unlink from this agent" }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect((writes()[1]?.body as { items: unknown[] }).items).toEqual([
      { skill_id: "b", enabled: false },
      { skill_id: "c", enabled: true },
      { skill_id: "x", enabled: true },
    ]);
  });

  it("renders an empty state that leads to the Skills Lab when nothing is linked", async () => {
    linked = [];
    renderTab();

    expect(await screen.findByText("No skills linked")).toBeInTheDocument();
    expect(screen.getByText("0 of 0 enabled")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Open Skills Lab/ }));
    expect(push).toHaveBeenCalledWith("/skills");
  });
});
