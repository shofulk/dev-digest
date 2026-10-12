# No over-mocking

A test must fail when the production behaviour it names breaks. Mock the boundary of the
system, not the system.

## Rules
- Mock only I/O the test cannot run hermetically: network, clock, randomness, third-party
  SDKs. Use the project's existing adapter mocks rather than ad-hoc stubs.
- Never mock the unit under test, and never mock a sibling function whose logic
  determines the result being asserted.
- Prefer a real in-memory or containerised dependency (the DB in `*.it.test.ts`) over a
  hand-written fake of it.
- Assert on outputs and state changes. `expect(mock).toHaveBeenCalledWith(...)` is
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
restores it (mock one layer lower, or use the real dependency).