# Test corner cases

For each input of the changed code, ask which values sit at the edge of what it handles,
and check that a test exists for them.

## Checklist
- Boundaries: 0, 1, max, max + 1, negative, the exact threshold of every comparison
  (`<` vs `<=`) the diff introduces.
- Emptiness: empty string, empty array or object, `null`, `undefined`, missing optional
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
reach.