/* TraceBody.test.tsx — T13 (after, L10). TraceBody is a pure presentational component
   (trace + findings props, no hooks of its own), so it is mounted directly with the real
   `runs` messages, following the neighbouring `RunTraceDrawer.test.tsx` convention of a
   fixture `RunTrace` object. Covers "Specs read" with tokens (AC-30), "Specs skipped" with
   reasons (AC-31), the "Project context — attached specs (untrusted)" prompt row and its
   exact fullscreen text (AC-32), and the AC-33 no-`context_docs` fallback. */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/runs.json"; // client/messages/en/runs.json
import { TraceBody } from "./TraceBody";

afterEach(cleanup);

function renderBody(trace: RunTrace) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <div data-theme="dark">
        <TraceBody trace={trace} findings={[]} />
      </div>
    </NextIntlClientProvider>,
  );
}

const SPECS_BLOCK =
  '<untrusted source="docs/architecture.md">\n# Payments API architecture\nmodule api/ does not import db/ directly.\n</untrusted>';

function baseTrace(over: Partial<RunTrace> = {}): RunTrace {
  return {
    config: { agent: "Security", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
    stats: { duration_ms: 1200, tokens_in: 400, tokens_out: 120, cost_usd: 0.002, findings: 1, grounding: "1/1 passed" },
    prompt_assembly: {
      system: "You are a reviewer.",
      skills: null,
      memory: null,
      specs: SPECS_BLOCK,
      callers: null,
      user: `## Project context\n${SPECS_BLOCK}`,
    },
    tool_calls: [],
    raw_output: "",
    memory_pulled: [],
    specs_read: ["docs/architecture.md"],
    log: [],
    ...over,
  };
}

describe("TraceBody — Specs read / skipped (AC-30, AC-31)", () => {
  it("AC-30: lists each injected document under 'Specs read' with its token count", () => {
    const trace = baseTrace({
      context_docs: [
        { path: "docs/architecture.md", origin: "agent", tokens: 42, status: "included" },
      ],
    });
    renderBody(trace);
    expect(screen.getByText("Specs read")).toBeInTheDocument();
    expect(screen.getByText("docs/architecture.md (≈ 42 tokens)")).toBeInTheDocument();
  });

  it("AC-31: lists every resolved-but-skipped document under 'Specs skipped' with its reason", () => {
    const trace = baseTrace({
      context_docs: [
        { path: "docs/architecture.md", origin: "agent", tokens: 42, status: "included" },
        { path: "docs/missing.md", origin: "agent", tokens: null, status: "missing" },
        { path: "docs/over-budget.md", origin: "skill:x", tokens: 900, status: "budget" },
      ],
    });
    renderBody(trace);
    expect(screen.getByText("Specs skipped")).toBeInTheDocument();
    expect(screen.getByText("docs/missing.md — not found")).toBeInTheDocument();
    expect(screen.getByText("docs/over-budget.md — over budget")).toBeInTheDocument();
    // the included document is not also listed as skipped.
    expect(screen.queryByText(/docs\/architecture\.md —/)).not.toBeInTheDocument();
  });

  it("no context_docs and nothing skipped: 'Specs skipped' is not rendered at all", () => {
    renderBody(baseTrace());
    expect(screen.queryByText("Specs skipped")).not.toBeInTheDocument();
  });
});

describe("TraceBody — Project context prompt row (AC-32)", () => {
  it("renders the labelled row and the fullscreen view shows the exact prompt_assembly.specs text", () => {
    const trace = baseTrace({
      context_docs: [{ path: "docs/architecture.md", origin: "agent", tokens: 42, status: "included" }],
    });
    renderBody(trace);

    // "Prompt assembly" is collapsed by default — expand it first.
    fireEvent.click(screen.getByText("Prompt assembly"));
    const specsLabel = screen.getByText("Project context — attached specs (untrusted)");
    const header = specsLabel.parentElement!;

    fireEvent.click(within(header).getByRole("button", { name: "Open fullscreen" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Project context — attached specs (untrusted)")).toBeInTheDocument();
    const pre = dialog.querySelector("pre.mono")!;
    expect(pre.textContent).toBe(SPECS_BLOCK);
  });
});

describe("TraceBody — AC-33: a trace with no context_docs renders as before, with no error", () => {
  it("falls back to the plain specs_read path list, with no tokens and no 'Specs skipped'", () => {
    const trace = baseTrace({ context_docs: undefined });
    renderBody(trace);
    expect(screen.getByText("docs/architecture.md")).toBeInTheDocument();
    expect(screen.queryByText(/≈ \d+ tokens\)/)).not.toBeInTheDocument();
    expect(screen.queryByText("Specs skipped")).not.toBeInTheDocument();
  });

  it("an empty specs_read list renders the 'none' placeholder, not an error", () => {
    const trace = baseTrace({ context_docs: undefined, specs_read: [] });
    renderBody(trace);
    expect(screen.getByText("none")).toBeInTheDocument();
  });
});
