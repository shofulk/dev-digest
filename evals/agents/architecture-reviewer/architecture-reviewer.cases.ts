import type { AgentCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

// One prompt shape for every case and both variants. The fixture diffs describe files that are
// not on disk, and the eval hands the agent no Bash (see agentTools), so the prompt pins the
// change set explicitly — otherwise Step 0's review gate would stop on a missing base ref.
const reviewPrompt = (fixture: string) => `Review this change set for architecture violations.

The diff below is the complete change set (an explicit file list for Step 0). Its files are not
checked out on disk — review the diff as given; you may read the repo's skills and docs for the
rules. The deterministic commands cannot run in this session: record them under Limits.

${fx(fixture)}`;

// Two deliberate violations, no hints in the fixture:
//   - server/src/modules/checkout/domain/checkout.ts:1 imports `FastifyReply` below the edge →
//     depcruise `no-fastify-below-edge` (severity error → critical), onion-architecture
//     § "Fastify — only ring 3 knows it exists".
//   - server/src/modules/checkout/service.ts:10 `new PgCheckoutRepository(...)` in a ring-1
//     service → onion-architecture § "The DI container" / Anti-patterns row "`new <Concrete>()`
//     in a service" (judged; critical or major).
const CHECKOUT_PROMPT = reviewPrompt("checkout-service.diff");

// A new reviewer-core file that breaks the package's purity twice:
//   - reviewer-core/src/review/history.ts:1-2 import `drizzle-orm` → `reviewer-core-stays-pure`,
//     onion-architecture § "reviewer-core — the purity guard" (critical).
//   - reviewer-core/src/review/history.ts:13 reads `process.env` → reviewer-core/AGENTS.md "Keep
//     the package pure … `process.env` belongs in the server" (judged; critical or major).
// The second rule lives outside the preloaded skill, so citing it means reading the doc.
const REVIEWER_CORE_PROMPT = reviewPrompt("reviewer-core-purity.diff");

// Violates no documented rule. Surfaces the cost of relaxing the citation rule: freed from
// naming a rule, the lite variant is more prone to inventing a judgment finding.
const BENIGN_PROMPT = reviewPrompt("benign-refactor.diff");

// Shared by architecture-reviewer and architecture-reviewer-lite: same prompts, fixtures,
// practices, thresholds and turn budgets. Only the injected agent definition differs.
export const cases: AgentCase[] = [
  {
    name: "flags both checkout violations with severity and a documented rule each",
    kind: "quality",
    prompt: CHECKOUT_PROMPT,
    grounding: ["FastifyReply", "PgCheckoutRepository"],
    practices: [
      "flags `import type { FastifyReply } from \"fastify\"` in server/src/modules/checkout/domain/checkout.ts as a finding: Fastify leaking into the domain/inner ring below the composition-root edge",
      "flags `new PgCheckoutRepository(container.db)` in server/src/modules/checkout/service.ts as a finding: a service constructing a concrete repository instead of having it built in platform/container.ts (the DI container / composition root)",
      "rates the FastifyReply-in-domain finding `critical`",
      "rates the `new PgCheckoutRepository` finding `critical` or `major` (not `minor`)",
      "for the FastifyReply finding, names a specific documented rule — the dependency-cruiser rule `no-fastify-below-edge` or an onion-architecture section/anti-pattern row (e.g. \"Fastify — only ring 3 knows it exists\", \"`req` / `reply` / `app.log` below `routes.ts`\") — not only a prose description",
      "for the `new PgCheckoutRepository` finding, names a specific documented rule — an onion-architecture section/anti-pattern row (e.g. \"The DI container — resolve at construction\", \"`new <Concrete>()` in a service\", Review checklist item 2) — not only a prose description",
      "cites a `file:line` for each finding (checkout.ts line 1 or the FastifyReply parameter line; service.ts line 4 or 10)",
      "ends with a `**Review status:**` line reporting Findings with at least one critical",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "stays in architecture scope on the checkout diff",
    kind: "quality",
    prompt: CHECKOUT_PROMPT,
    practices: [
      "does not report the coupon/discount arithmetic or rounding in priceOrder as a finding",
      "does not report naming, style, test-coverage, performance or security issues as findings",
      "every finding rated `critical` concerns one of the two checkout violations — the Fastify import/usage in domain/checkout.ts (the import, the `reply` parameter or the `reply.header` call) or `new PgCheckoutRepository` in service.ts; splitting one violation into several rows is fine",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "cites the documented rule for both reviewer-core purity breaks",
    kind: "quality",
    prompt: REVIEWER_CORE_PROMPT,
    grounding: ["drizzle-orm", "process.env"],
    practices: [
      "flags the `drizzle-orm` imports in reviewer-core/src/review/history.ts as a finding (reviewer-core may not depend on the ORM / database)",
      "flags the `process.env.REVIEW_HISTORY_LIMIT` read in reviewer-core/src/review/history.ts as a finding (reviewer-core may not read the environment)",
      "for the drizzle-orm finding, names a specific documented rule — `reviewer-core-stays-pure` or onion-architecture § \"reviewer-core — the purity guard\" — not only a prose description",
      "for the process.env finding, names a specific documented source — reviewer-core/AGENTS.md (\"Keep the package pure\" / `process.env` belongs in the server) or onion-architecture § \"reviewer-core — the purity guard\" — not only a prose description",
      "rates the drizzle-orm finding `critical`",
      "rates the process.env finding `critical` or `major` (not `minor`)",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "does not fabricate a finding for a benign rename",
    kind: "quality",
    prompt: BENIGN_PROMPT,
    practices: [
      "reports no critical or major finding for the local-variable rename",
      "does not fabricate a documented-rule violation where the diff violates none",
      "the `**Review status:**` line is Clean (or Findings with zero critical and zero major)",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
];
