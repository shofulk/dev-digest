# Test coverage gaps

For every function, route or module the diff changes, find the test that would fail if
that code broke. Then walk the changed code branch by branch.

## Checklist
- Every `throw`, `return err(...)`, `catch`, early `return` and failed-validation path
  in the changed code has a test that reaches it and asserts the outcome.
- Every new `if` / `else` / `switch` case / ternary arm is hit by at least one test.
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
and expects a 401." Do not report a branch that an existing test already covers.