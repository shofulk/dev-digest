/**
 * Built-in demo skills used by the seed (Skills Lab).
 *
 * A skill's `description` is its interface: imperative, and it says when the skill applies.
 * The bodies are injected into the reviewer's prompt as instructions when the skill is
 * linked to an agent and enabled (see `.spec/skills.spec.md`, section E).
 *
 * `flaky-test-patterns` is deliberately absent — it ships as `docs/skills/flaky-test-patterns.zip`
 * and is imported live through the UI.
 */

export interface SeedSkill {
  name: string;
  description: string;
  type: 'rubric' | 'convention' | 'security' | 'custom';
  body: string;
}

export const TEST_COVERAGE_GAPS_SKILL: SeedSkill = {
  name: 'test-coverage-gaps',
  description:
    'Apply when a PR changes production code, to flag branches of the changed code that no test exercises.',
  type: 'rubric',
  body: `# Test coverage gaps

For every function, route or module the diff changes, find the test that would fail if
that code broke. Then walk the changed code branch by branch.

## Checklist
- Every \`throw\`, \`return err(...)\`, \`catch\`, early \`return\` and failed-validation path
  in the changed code has a test that reaches it and asserts the outcome.
- Every new \`if\` / \`else\` / \`switch\` case / ternary arm is hit by at least one test.
- A new failure mode of a dependency (DB error, HTTP 4xx/5xx, timeout, empty result)
  is simulated at least once, not only the success path.
- A bug fix ships with a test that fails without the fix.
- The assertion checks the result or the state change, not just that a mock was called.

## Severity
- **WARNING** — an error branch or other meaningful branch of the changed code that no
  test exercises. This is the default for an untested branch.
- **CRITICAL** — only when the untested branch guards money, auth, permissions or data
  integrity, or when a test in the diff cannot fail at all.
- **SUGGESTION** — a trivial branch (a log line, a pass-through default).

## How to report
Cite the untested branch (file and lines of the changed code), say which input reaches
it, and give a concrete suggested test: its name, the input, and the expected outcome.
Example: "add a test 'rejects an expired token' that calls verify() with exp in the past
and expects a 401." Do not report a branch that an existing test already covers.`,
};

export const TEST_CORNER_CASES_SKILL: SeedSkill = {
  name: 'test-corner-cases',
  description:
    'Apply when a PR adds or changes logic that takes inputs, to flag missing boundary and unusual-input tests.',
  type: 'rubric',
  body: `# Test corner cases

For each input of the changed code, ask which values sit at the edge of what it handles,
and check that a test exists for them.

## Checklist
- Boundaries: 0, 1, max, max + 1, negative, the exact threshold of every comparison
  (\`<\` vs \`<=\`) the diff introduces.
- Emptiness: empty string, empty array or object, \`null\`, \`undefined\`, missing optional
  fields.
- Size and shape: a single element, many elements, duplicates, unsorted input,
  unicode or very long strings, whitespace-only strings.
- Time and numbers: end of month, timezone or DST edges, floating-point rounding,
  integer overflow, NaN.
- Collections and pagination: the last page, an exactly-full page, an empty result.
- Concurrency and repetition: the same call twice (idempotency), two callers at once
  when the code touches shared state.

## Severity
- **WARNING** — a boundary or unusual input that the code visibly branches on, or
  that would plausibly occur in production, with no test.
- **SUGGESTION** — an exotic input the code does not special-case.
- Never CRITICAL on its own: a missing corner-case test is a risk, not a defect.

## How to report
Name the specific value ("a limit of exactly 100", "an empty items array"), explain what
the changed code does with it, and give the assertion the test should make. Report one
finding per distinct input class, not one per value. Do not demand cases the code cannot
reach.`,
};

export const NO_OVER_MOCKING_SKILL: SeedSkill = {
  name: 'no-over-mocking',
  description:
    'Apply when a PR adds or changes tests, to flag mocks that replace the behaviour under test.',
  type: 'convention',
  body: `# No over-mocking

A test must fail when the production behaviour it names breaks. Mock the boundary of the
system, not the system.

## Rules
- Mock only I/O the test cannot run hermetically: network, clock, randomness, third-party
  SDKs. Use the project's existing adapter mocks rather than ad-hoc stubs.
- Never mock the unit under test, and never mock a sibling function whose logic
  determines the result being asserted.
- Prefer a real in-memory or containerised dependency (the DB in \`*.it.test.ts\`) over a
  hand-written fake of it.
- Assert on outputs and state changes. \`expect(mock).toHaveBeenCalledWith(...)\` is
  acceptable only for a side effect that has no observable result (an email sent).
- If the mock's return value is copied into the expectation, the test proves nothing.
- A mock that re-implements production logic is a second copy of the bug.

## Checklist
- Would the test still pass if the production function body were replaced with a stub?
- Does the test set up more mocks than it makes assertions?
- Is a module mocked wholesale when one function needed replacing?

## Severity
- **WARNING** — the mock hides the behaviour named in the test.
- **CRITICAL** — the assertion is only against the mock's own stubbed value, so the test
  cannot fail.
- **SUGGESTION** — a broader mock than necessary that still leaves real behaviour tested.

Report the mocked symbol, what real behaviour it hides, and the smallest change that
restores it (mock one layer lower, or use the real dependency).`,
};

export const API_CONTRACT_GATE_SKILL: SeedSkill = {
  name: 'api-contract-gate',
  description:
    'Apply when a PR changes an HTTP route, its request or response shape, or a shared contract, to report breaking API changes.',
  type: 'custom',
  body: `# API contract gate

A route's request and response shapes are a contract with every caller: the web client,
other services, CI scripts and stored data. Changing one without updating the callers is
a defect, whatever the tests say.

## Breaking changes to look for
- A response field renamed, removed, retyped or made nullable.
- A status code changed (200 to 201, 404 to 400, 200 to 204) or a new error status that
  callers do not handle.
- A request parameter, query or body field that is newly required, renamed or removed,
  or whose accepted values narrowed.
- A route path or method changed, or a route removed.
- A shared Zod contract or exported type edited so that existing consumers no longer
  type-check or parse.
- An enum value removed or renamed.

## Checklist
- Find every caller in the diff and in the "Callers of changed symbols" section: the
  client hooks that fetch the route, other modules, tests, docs and fixtures.
- Were the callers changed in the same diff? If not, they still assume the old shape.
- Is the old shape kept alongside the new one (deprecated alias, versioned route)?

## Severity
- **CRITICAL** — a breaking change whose callers are untouched by the diff. This blocks
  merge.
- **WARNING** — a breaking change with callers updated but no compatibility window, or a
  change you cannot fully verify from the diff.
- **SUGGESTION** — an additive, backward-compatible change that should be documented.

## How to report
Cite the changed line, state the old and new shape, name the callers that still depend
on the old one (file and symbol), and say what breaks for them. Suggest either updating
those callers in the same PR or keeping the old field or status during a transition.`,
};

export const SEED_SKILLS: SeedSkill[] = [
  TEST_COVERAGE_GAPS_SKILL,
  TEST_CORNER_CASES_SKILL,
  NO_OVER_MOCKING_SKILL,
  API_CONTRACT_GATE_SKILL,
];
